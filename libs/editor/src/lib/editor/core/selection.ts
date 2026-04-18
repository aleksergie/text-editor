import { NodeKey } from './nodes/node';
import { $isTextNode } from './nodes/node-utils';
import { EditorState } from './state';
import { TextFormat, TextFormatBits } from './text-format';

/**
 * The minimal surface `resolveDomSelection` needs. Both `Editor` and
 * `EditorPluginContext` satisfy this shape, so plugins can call the helper
 * without reaching past the plugin context.
 */
export interface SelectionResolverHost {
  keyForDomNode(node: Node | null): NodeKey | null;
  getDomForKey(key: NodeKey): HTMLElement | null;
  getEditorState(): EditorState;
}

/**
 * A single anchor/focus endpoint in the document, expressed in model
 * coordinates. `offset` is a character offset inside the text content of
 * the `TextNode` identified by `key`.
 */
export interface TextPoint {
  key: NodeKey;
  offset: number;
}

/**
 * A transient selection range resolved from the live DOM. V2 does not store
 * selection on `EditorState`; consumers call `resolveDomSelection` when they
 * need a range for a command payload and drop the value afterwards.
 *
 * - `anchor` is where the selection started (native browser semantics).
 * - `focus` is where the selection ends (the movable edge).
 * - `isCollapsed` is `true` when anchor and focus coincide.
 * - `isBackward` is `true` when `focus` precedes `anchor` in document order.
 */
export interface TextRange {
  anchor: TextPoint;
  focus: TextPoint;
  isCollapsed: boolean;
  isBackward: boolean;
}

/**
 * Build a normalized range from anchor/focus points. If the caller passed
 * them in backward order we flip to forward order and set `isBackward` so
 * handlers can iterate left-to-right without ambiguity. Callers that already
 * know the order can construct a `TextRange` literal directly.
 */
export function createTextRange(
  anchor: TextPoint,
  focus: TextPoint,
  isBackward: boolean,
): TextRange {
  return {
    anchor,
    focus,
    isCollapsed:
      anchor.key === focus.key && anchor.offset === focus.offset,
    isBackward,
  };
}

/**
 * Return a forward-order (start, end) pair from a range, regardless of
 * direction. Useful for handlers that want to walk the range left-to-right.
 */
export function getRangeStartEnd(range: TextRange): {
  start: TextPoint;
  end: TextPoint;
} {
  if (range.isBackward) {
    return { start: range.focus, end: range.anchor };
  }
  return { start: range.anchor, end: range.focus };
}

/**
 * Read the native window selection and map it to a `TextRange`. Returns
 * `null` when:
 * - there is no selection or no active ranges,
 * - the selection anchor/focus are not inside the editor's rendered DOM,
 * - the resolved nodes are not `TextNode`s (selections anchored on a
 *   paragraph boundary are rejected in V2 - callers should surface this
 *   to the user as "select some text first").
 */
export function resolveDomSelection(
  host: SelectionResolverHost,
  win: Window & typeof globalThis = globalThis.window,
): TextRange | null {
  if (!win) {
    return null;
  }
  const sel = win.getSelection?.();
  if (!sel || sel.rangeCount === 0 || sel.anchorNode == null || sel.focusNode == null) {
    return null;
  }

  const anchorKey = host.keyForDomNode(sel.anchorNode);
  const focusKey = host.keyForDomNode(sel.focusNode);
  if (!anchorKey || !focusKey) {
    return null;
  }

  const state = host.getEditorState();
  const anchorNode = state.nodes.get(anchorKey);
  const focusNode = state.nodes.get(focusKey);
  if (!$isTextNode(anchorNode) || !$isTextNode(focusNode)) {
    return null;
  }

  const anchorHost = host.getDomForKey(anchorKey);
  const focusHost = host.getDomForKey(focusKey);
  if (!anchorHost || !focusHost) {
    return null;
  }

  const anchorOffset = normalizeOffsetWithinTextNode(
    anchorHost,
    sel.anchorNode,
    sel.anchorOffset,
    anchorNode.text.length,
  );
  const focusOffset = normalizeOffsetWithinTextNode(
    focusHost,
    sel.focusNode,
    sel.focusOffset,
    focusNode.text.length,
  );

  const isBackward = isSelectionBackward(
    sel.anchorNode,
    sel.anchorOffset,
    sel.focusNode,
    sel.focusOffset,
  );

  return createTextRange(
    { key: anchorKey, offset: anchorOffset },
    { key: focusKey, offset: focusOffset },
    isBackward,
  );
}

/**
 * Map a DOM offset (which may be inside a nested formatting element within
 * a TextNode's host) into a character offset relative to the TextNode's
 * full text string. Returns a value clamped to `[0, textLength]`.
 *
 * Strategy: walk the host subtree in document order, accumulating
 * `textContent.length` of text nodes until we reach the DOM node the user's
 * selection is anchored on.
 */
function normalizeOffsetWithinTextNode(
  host: HTMLElement,
  target: Node,
  domOffset: number,
  textLength: number,
): number {
  if (target === host) {
    // Selection anchored on the host itself. Offset counts child nodes; we
    // approximate by mapping 0 -> start, anything else -> end. This is a
    // rare edge case (most browsers anchor on text nodes).
    return domOffset === 0 ? 0 : textLength;
  }

  let accumulated = 0;
  let found = false;

  const walk = (node: Node): boolean => {
    if (found) {
      return true;
    }
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        accumulated += domOffset;
      }
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      accumulated += (node.textContent ?? '').length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i += 1) {
        if (walk(node.childNodes[i])) {
          return true;
        }
      }
    }
    return false;
  };

  walk(host);

  if (!found) {
    return Math.min(Math.max(domOffset, 0), textLength);
  }
  return Math.min(Math.max(accumulated, 0), textLength);
}

/**
 * Intersect the format bitfields of every `TextNode` touched by `range`,
 * returning the set of flags that are active across the entire range.
 *
 * A flag appears in the result only when every `TextNode` in the range
 * carries it. This matches the toggle semantics of `FORMAT_TEXT`, so a
 * toolbar can use the return value to decide whether the next click on a
 * given format button would add or remove that format.
 *
 * Returns `TextFormat.NONE` when:
 * - the range is collapsed (V2 has no caret-level formatting),
 * - either endpoint resolves to a node that is not a `TextNode` in the
 *   current state (e.g. stale keys after a structural mutation),
 * - the endpoints cannot be located in document order.
 *
 * Complexity: O(N) in the number of text nodes in the document, bounded by
 * `state.getTextNodesInDocumentOrder()`. Callers that compute this on every
 * `selectionchange` tick should be aware; a future version may index text
 * nodes by key to make this O(range size).
 */
export function getFormatIntersection(
  state: EditorState,
  range: TextRange,
): TextFormatBits {
  if (range.isCollapsed) {
    return TextFormat.NONE;
  }

  const { start, end } = getRangeStartEnd(range);
  const startNode = state.nodes.get(start.key);
  const endNode = state.nodes.get(end.key);
  if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
    return TextFormat.NONE;
  }

  // Same-node fast path: one lookup, no document walk.
  if (start.key === end.key) {
    return startNode.format;
  }

  const nodes = state.getTextNodesInDocumentOrder();
  const startIdx = nodes.findIndex((n) => n.key === start.key);
  const endIdx = nodes.findIndex((n) => n.key === end.key);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return TextFormat.NONE;
  }

  let bits = nodes[startIdx].format;
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    bits &= nodes[i].format;
  }
  return bits;
}

function isSelectionBackward(
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number,
): boolean {
  if (anchorNode === focusNode) {
    return focusOffset < anchorOffset;
  }
  const position = anchorNode.compareDocumentPosition(focusNode);
  // DOCUMENT_POSITION_PRECEDING === 2
  return (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}
