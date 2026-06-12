import type { Editor } from './editor';
import { $isTextNode } from './nodes/node-utils';
import { getInnermostTextHolder } from './nodes/text-node';
import { TextPoint, TextRange } from './selection';

interface DomPoint {
  node: Node;
  offset: number;
}

/**
 * Translate a committed model selection into native DOM selection inside
 * `root`. Runs with the mutation observer paused so the write does not
 * feed back into mutation handling.
 */
export function writeDomSelection(
  editor: Editor,
  root: HTMLElement,
  range: TextRange | null,
): boolean {
  if (!range) {
    return false;
  }

  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection() ?? null;
  if (!selection) {
    return false;
  }

  const anchor = resolveModelPointToDom(editor, range.anchor);
  const focus = resolveModelPointToDom(editor, range.focus);
  if (!anchor || !focus) {
    return false;
  }

  let written = false;
  editor.runWithObserverPaused(() => {
    try {
      selection.setBaseAndExtent(
        anchor.node,
        anchor.offset,
        focus.node,
        focus.offset,
      );
      written = true;
    } catch {
      // Native selection can reject stale DOM points in Firefox-like edge
      // cases. Keep editor state authoritative and skip DOM write.
    }
  });

  return written;
}

function resolveModelPointToDom(editor: Editor, point: TextPoint): DomPoint | null {
  const host = editor.getDomForKey(point.key);
  if (!host) {
    return null;
  }

  const textNode = editor.getEditorState().nodes.get(point.key);
  if (!$isTextNode(textNode)) {
    return null;
  }

  return findDomPointInHost(host, point.offset, textNode.text.length);
}

/**
 * Map a model character offset inside a TextNode host to a concrete DOM
 * text node and offset. Inverse of `normalizeOffsetWithinTextNode`.
 */
export function findDomPointInHost(
  host: HTMLElement,
  modelOffset: number,
  textLength: number,
): DomPoint | null {
  const clampedOffset = Math.min(Math.max(modelOffset, 0), textLength);
  let accumulated = 0;

  const walk = (node: Node): DomPoint | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (clampedOffset <= accumulated + length) {
        return { node, offset: clampedOffset - accumulated };
      }
      accumulated += length;
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i += 1) {
        const found = walk(node.childNodes[i]);
        if (found) {
          return found;
        }
      }
    }

    return null;
  };

  const inner = getInnermostTextHolder(host);
  if (inner?.nodeType === Node.TEXT_NODE) {
    const found = walk(host);
    if (found) {
      return found;
    }
  }

  if (clampedOffset === 0) {
    const firstText = findBoundaryTextNode(host, 'first');
    if (firstText) {
      return { node: firstText, offset: 0 };
    }
  }

  if (clampedOffset === textLength) {
    const lastText = findBoundaryTextNode(host, 'last');
    if (lastText) {
      return { node: lastText, offset: (lastText.textContent ?? '').length };
    }
  }

  return null;
}

function findBoundaryTextNode(root: Node, edge: 'first' | 'last'): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) {
    return null;
  }
  if (edge === 'first') {
    return walker.nextNode() as Text | null;
  }
  let last: Text | null = null;
  let current = walker.nextNode();
  while (current) {
    last = current as Text;
    current = walker.nextNode();
  }
  return last;
}
