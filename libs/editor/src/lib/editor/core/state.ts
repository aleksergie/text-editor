import { ElementNode, ParagraphNode, RootNode } from './nodes/element-node';
import { createNodeKey, NodeBase, NodeKey, NodeMap } from './nodes/node';
import { TextNode } from './nodes/text-node';
import {
  $createParagraphNode,
  $createRootNode,
  $createTextNode,
  $isElementNode,
  $isTextNode,
  insertAfter as insertAfterUtil,
  insertBefore as insertBeforeUtil,
  remove as removeUtil,
  replace as replaceUtil,
} from './nodes/node-utils';
import { TextRange, TextPoint, createTextRange, getRangeStartEnd } from './selection';
import {
  EditorStateSnapshot,
  InvalidSnapshotError,
  SNAPSHOT_VERSION,
  SerializedNode,
  validateSnapshot,
} from './snapshot';
import {
  TextFormatBits,
  TextFormatFlag,
  applyFormat,
  hasFormat,
  removeFormat,
} from './text-format';

export class EditorState {
  constructor(
    public readonly nodes: NodeMap,
    public readonly rootKey: NodeKey,
    private readonly dirtyNodes: Set<NodeKey> = new Set(),
  ) {}

  /**
   * Build the v1 baseline document: `root > paragraph > empty text node`.
   * This is the shape produced by `CLEAR_EDITOR` and by a freshly constructed
   * editor.
   */
  static createEmpty(): EditorState {
    const nodes: NodeMap = new Map();
    const root = $createRootNode('root');
    const paragraph = $createParagraphNode('p1');
    const text = $createTextNode('t1', '');

    nodes.set(root.key, root);
    nodes.set(paragraph.key, paragraph);
    nodes.set(text.key, text);

    root.append(nodes, paragraph);
    paragraph.append(nodes, text);

    return new EditorState(nodes, root.key);
  }

  clone(): EditorState {
    // Dirty keys are transaction-scoped and should not leak into the next update.
    return new EditorState(new Map(this.nodes), this.rootKey, new Set());
  }

  setText(nextText: string) {
    const textNode = this.getFirstTextNode();
    if (textNode && textNode.text !== nextText) {
      textNode.text = nextText;
      this.markDirty(textNode.key);
    }
  }

  /**
   * Register a node in the node map so its key resolves during reconciliation
   * and serialization. Safe to call on an already-registered node.
   */
  registerNode(node: NodeBase) {
    this.nodes.set(node.key, node);
  }

  /**
   * Structural helper: insert `node` after `target` under the same parent and
   * mark the parent dirty. The reconciler promotes structural changes to a
   * full re-render via order mismatch, so marking dirty is not strictly
   * required for correctness but makes the transaction introspectable via
   * update listeners.
   */
  insertAfter(target: NodeBase, node: NodeBase) {
    this.registerNode(node);
    insertAfterUtil(this.nodes, target, node);
    if (node.parent) {
      this.markDirty(node.parent);
    }
  }

  /**
   * Structural helper: insert `node` before `target` under the same parent.
   */
  insertBefore(target: NodeBase, node: NodeBase) {
    this.registerNode(node);
    insertBeforeUtil(this.nodes, target, node);
    if (node.parent) {
      this.markDirty(node.parent);
    }
  }

  /**
   * Structural helper: remove `node` from its parent.
   */
  remove(node: NodeBase) {
    const parentKey = node.parent;
    removeUtil(this.nodes, node);
    if (parentKey) {
      this.markDirty(parentKey);
    }
    this.nodes.delete(node.key);
  }

  /** Unlink `node` from its parent without removing it from the node map. */
  private detach(node: NodeBase) {
    const parentKey = node.parent;
    removeUtil(this.nodes, node);
    if (parentKey) {
      this.markDirty(parentKey);
    }
  }

  /**
   * Structural helper: replace `target` with `replacement` under the same
   * parent and mark the parent dirty.
   */
  replace(target: NodeBase, replacement: NodeBase) {
    this.registerNode(replacement);
    const parentKey = target.parent;
    replaceUtil(this.nodes, target, replacement);
    if (parentKey) {
      this.markDirty(parentKey);
    }
    this.nodes.delete(target.key);
  }

  markDirty(nodeKey: NodeKey) {
    this.dirtyNodes.add(nodeKey);
  }

  getDirtyNodeKeys(): ReadonlySet<NodeKey> {
    return this.dirtyNodes;
  }

  clearDirtyNodeKeys() {
    this.dirtyNodes.clear();
  }

  getText(): string {
    const textNodes = this.getTextNodes();
    return textNodes.map((node) => node.text).join('');
  }

  private getTextNodes(): TextNode[] {
    const root = this.nodes.get(this.rootKey);
    if (!root || !$isElementNode(root)) {
      return [];
    }

    const textNodes: TextNode[] = [];
    let blockKey = root.__first;

    while (blockKey) {
      const block = this.nodes.get(blockKey);
      if ($isElementNode(block)) {
        let textKey = block.__first;
        while (textKey) {
          const node = this.nodes.get(textKey);
          if ($isTextNode(node)) {
            textNodes.push(node);
          }
          textKey = node?.__next ?? null;
        }
      } else if ($isTextNode(block)) {
        textNodes.push(block);
      }

      blockKey = block?.__next ?? null;
    }

    return textNodes;
  }

  private getFirstTextNode(): TextNode | null {
    return this.getTextNodes()[0] ?? null;
  }

  getLastParagraph(): ElementNode | null {
    const root = this.nodes.get(this.rootKey);
    if (!root || !$isElementNode(root) || !root.__last) {
      return null;
    }
    const last = this.nodes.get(root.__last);
    return $isElementNode(last) ? last : null;
  }

  getLastTextNode(): TextNode | null {
    const all = this.getTextNodes();
    return all.length === 0 ? null : all[all.length - 1];
  }

  /**
   * Append `text` to the last text node in the document, creating a paragraph
   * and/or text node if the document is empty enough to require it. V1 uses
   * the document tail as the insertion point because DOM-selection-driven
   * insertion arrives in M2-T5.
   */
  insertText(text: string) {
    if (text.length === 0) {
      return;
    }

    let paragraph = this.getLastParagraph();
    if (!paragraph) {
      paragraph = $createParagraphNode(createNodeKey());
      this.registerNode(paragraph);
      const root = this.nodes.get(this.rootKey);
      if ($isElementNode(root)) {
        root.append(this.nodes, paragraph);
        this.markDirty(this.rootKey);
      }
    }

    let textNode = this.getLastTextNode();
    if (!textNode || textNode.parent !== paragraph.key) {
      textNode = $createTextNode(createNodeKey(), '');
      this.registerNode(textNode);
      paragraph.append(this.nodes, textNode);
      this.markDirty(paragraph.key);
    }

    textNode.text = textNode.text + text;
    this.markDirty(textNode.key);
  }

  /**
   * Remove a single character. `isBackward=true` removes the last character of
   * the document tail (backspace); `isBackward=false` removes the first
   * character of the document head (forward delete).
   */
  deleteCharacter(isBackward: boolean) {
    if (isBackward) {
      const textNode = this.getLastTextNode();
      if (textNode && textNode.text.length > 0) {
        textNode.text = textNode.text.slice(0, -1);
        this.markDirty(textNode.key);
      }
    } else {
      const textNode = this.getFirstTextNode();
      if (textNode && textNode.text.length > 0) {
        textNode.text = textNode.text.slice(1);
        this.markDirty(textNode.key);
      }
    }
  }

  /**
   * Append a new empty paragraph at the end of the document (v1 scope: no
   * selection-aware splitting yet).
   */
  insertParagraph() {
    const lastText = this.getLastTextNode();
    if (!lastText) {
      return;
    }
    this.insertParagraphAtRange(
      createTextRange(
        { key: lastText.key, offset: lastText.text.length },
        { key: lastText.key, offset: lastText.text.length },
        false,
      ),
    );
  }

  /**
   * Insert `text` at `range`, replacing an expanded selection when present.
   * Returns the collapsed post-insert selection.
   */
  insertTextAtRange(range: TextRange, text: string): TextRange {
    if (text.length === 0) {
      return range;
    }

    let workingRange = range;
    if (!range.isCollapsed) {
      const collapsePoint = this.deleteTextInRange(range);
      workingRange = createTextRange(collapsePoint, collapsePoint, false);
    }

    const point = workingRange.anchor;
    const node = this.nodes.get(point.key);
    if (!$isTextNode(node)) {
      return workingRange;
    }

    const clampedOffset = Math.min(Math.max(point.offset, 0), node.text.length);
    const before = node.text.slice(0, clampedOffset);
    const after = node.text.slice(clampedOffset);
    node.text = before + text + after;
    this.markDirty(node.key);

    const newOffset = clampedOffset + text.length;
    const nextPoint: TextPoint = { key: node.key, offset: newOffset };
    return createTextRange(nextPoint, nextPoint, false);
  }

  /**
   * Delete one character relative to `range`. Expanded ranges are cleared
   * first; collapsed ranges delete before/after the caret.
   */
  deleteCharacterAtRange(range: TextRange, isBackward: boolean): TextRange | null {
    if (!range.isCollapsed) {
      const collapsePoint = this.deleteTextInRange(range);
      return createTextRange(collapsePoint, collapsePoint, false);
    }

    const point = range.anchor;
    const node = this.nodes.get(point.key);
    if (!$isTextNode(node)) {
      return null;
    }

    const clampedOffset = Math.min(Math.max(point.offset, 0), node.text.length);

    if (isBackward) {
      if (clampedOffset > 0) {
        node.text = node.text.slice(0, clampedOffset - 1) + node.text.slice(clampedOffset);
        this.markDirty(node.key);
        const nextPoint: TextPoint = { key: node.key, offset: clampedOffset - 1 };
        return createTextRange(nextPoint, nextPoint, false);
      }
      const previousText = this.previousTextNodeInBlock(node);
      if (previousText) {
        const nextOffset = Math.max(previousText.text.length - 1, 0);
        if (previousText.text.length > 0) {
          previousText.text = previousText.text.slice(0, -1);
          this.markDirty(previousText.key);
        }
        const nextPoint: TextPoint = { key: previousText.key, offset: nextOffset };
        return createTextRange(nextPoint, nextPoint, false);
      }
      return this.mergeWithPreviousParagraph(node);
    }

    if (clampedOffset < node.text.length) {
      node.text = node.text.slice(0, clampedOffset) + node.text.slice(clampedOffset + 1);
      this.markDirty(node.key);
      const nextPoint: TextPoint = { key: node.key, offset: clampedOffset };
      return createTextRange(nextPoint, nextPoint, false);
    }
    const nextText = this.nextTextNodeInBlock(node);
    if (nextText) {
      if (nextText.text.length > 0) {
        nextText.text = nextText.text.slice(1);
        this.markDirty(nextText.key);
      }
      const nextPoint: TextPoint = { key: node.key, offset: clampedOffset };
      return createTextRange(nextPoint, nextPoint, false);
    }
    return this.mergeWithNextParagraph(node);
  }

  /**
   * Split or insert a paragraph at `range`. Expanded ranges are cleared
   * first. Returns the collapsed selection inside the new paragraph.
   */
  insertParagraphAtRange(range: TextRange): TextRange | null {
    let workingRange = range;
    if (!range.isCollapsed) {
      const collapsePoint = this.deleteTextInRange(range);
      workingRange = createTextRange(collapsePoint, collapsePoint, false);
    }

    const point = workingRange.anchor;
    const textNode = this.nodes.get(point.key);
    if (!$isTextNode(textNode) || !textNode.parent) {
      return null;
    }

    const paragraph = this.nodes.get(textNode.parent);
    if (!$isElementNode(paragraph)) {
      return null;
    }

    const clampedOffset = Math.min(Math.max(point.offset, 0), textNode.text.length);
    const previousText = this.previousTextNodeInBlock(textNode);
    const nextText = this.nextTextNodeInBlock(textNode);

    if (clampedOffset === 0 && previousText) {
      return this.splitParagraphBeforeTextNode(paragraph, textNode);
    }

    if (clampedOffset === 0) {
      const { paragraph: newParagraph, text: newText } = this.createEmptyParagraph();
      this.insertBefore(paragraph, newParagraph);
      this.markDirty(this.rootKey);
      return createTextRange(
        { key: newText.key, offset: 0 },
        { key: newText.key, offset: 0 },
        false,
      );
    }

    if (clampedOffset >= textNode.text.length && nextText) {
      return this.splitParagraphBeforeTextNode(paragraph, nextText);
    }

    if (clampedOffset >= textNode.text.length) {
      const { paragraph: newParagraph, text: newText } = this.createEmptyParagraph();
      this.insertAfter(paragraph, newParagraph);
      this.markDirty(this.rootKey);
      return createTextRange(
        { key: newText.key, offset: 0 },
        { key: newText.key, offset: 0 },
        false,
      );
    }

    const { right } = this.splitTextNodeAt(textNode, clampedOffset);
    const newParagraph = $createParagraphNode(createNodeKey());
    this.registerNode(newParagraph);
    this.insertAfter(paragraph, newParagraph);
    this.markDirty(this.rootKey);

    if (right) {
      this.moveNodeAndFollowingSiblings(right, newParagraph);
      const selectionTarget = this.getFirstTextNodeInBlock(newParagraph);
      if (!selectionTarget) {
        return null;
      }
      return createTextRange(
        { key: selectionTarget.key, offset: 0 },
        { key: selectionTarget.key, offset: 0 },
        false,
      );
    }

    const emptyText = $createTextNode(createNodeKey(), '');
    this.registerNode(emptyText);
    newParagraph.append(this.nodes, emptyText);
    this.markDirty(newParagraph.key);
    return createTextRange(
      { key: emptyText.key, offset: 0 },
      { key: emptyText.key, offset: 0 },
      false,
    );
  }

  /**
   * Delete the text covered by `range` and return the collapse point at the
   * start of the deleted span.
   */
  deleteTextInRange(range: TextRange): TextPoint {
    const { start, end } = getRangeStartEnd(range);
    if (start.key === end.key && start.offset === end.offset) {
      return start;
    }

    const startNode = this.nodes.get(start.key);
    const endNode = this.nodes.get(end.key);
    if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
      return start;
    }

    const startOffset = Math.min(Math.max(start.offset, 0), startNode.text.length);
    const endOffset = Math.min(Math.max(end.offset, 0), endNode.text.length);

    if (startNode === endNode) {
      startNode.text = startNode.text.slice(0, startOffset) + startNode.text.slice(endOffset);
      this.markDirty(startNode.key);
      return { key: startNode.key, offset: startOffset };
    }

    const prefix = startNode.text.slice(0, startOffset);
    const suffix = endNode.text.slice(endOffset);
    const covered = this.collectTextNodesBetween(startNode, endNode);
    const startParentKey = startNode.parent;
    const endParentKey = endNode.parent;
    const nextAfterEnd = this.nextTextNodeInBlock(endNode);

    for (const coveredNode of covered) {
      if (coveredNode !== startNode && coveredNode !== endNode) {
        this.remove(coveredNode);
      }
    }

    startNode.text = prefix;
    this.markDirty(startNode.key);

    let firstMovedAfterRange: TextNode | null = null;
    if (suffix.length > 0) {
      endNode.text = suffix;
      this.markDirty(endNode.key);
      firstMovedAfterRange = endNode;
    } else {
      firstMovedAfterRange = nextAfterEnd;
      this.remove(endNode);
    }

    if (startParentKey && endParentKey && startParentKey !== endParentKey) {
      const startParent = this.nodes.get(startParentKey);
      if (
        $isElementNode(startParent) &&
        firstMovedAfterRange &&
        firstMovedAfterRange.parent === endParentKey
      ) {
        this.moveNodeAndFollowingSiblings(firstMovedAfterRange, startParent);
      }
    }

    this.mergeForwardSameFormatRuns(startNode);
    this.removeEmptyParagraphs();
    return { key: startNode.key, offset: startOffset };
  }

  /**
   * Toggle an inline format bit on every character covered by `range`.
   *
   * Strategy:
   * 1. Skip collapsed ranges entirely (V2 does not support pending/caret
   *    format; toggling Bold with no selection is a no-op).
   * 2. Split the start and end text nodes at the range boundaries so the
   *    range aligns to whole text nodes.
   * 3. Collect the aligned text nodes in document order. They may span
   *    multiple paragraphs; paragraphs themselves are not split or merged.
   * 4. Decide intent: if every aligned node already has `flag`, remove it
   *    from all; otherwise apply it to all.
   * 5. Merge adjacent same-format siblings so the node graph stays compact.
   */
  applyFormatToRange(range: TextRange, flag: TextFormatFlag): void {
    if (range.isCollapsed || flag === 0) {
      return;
    }
    const { start, end } = getRangeStartEnd(range);

    const startNode = this.nodes.get(start.key);
    const endNode = this.nodes.get(end.key);
    if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
      return;
    }

    let alignedStart: TextNode | null;
    let alignedEnd: TextNode | null;

    if (startNode === endNode) {
      // Same node: split off the tail first (so start-side indices survive),
      // then split at the start offset. The "middle" is the aligned range.
      const { right: tail } = this.splitTextNodeAt(startNode, end.offset);
      const { right: middle } = this.splitTextNodeAt(startNode, start.offset);
      void tail;
      alignedStart = middle ?? startNode;
      alignedEnd = alignedStart;
    } else {
      const startSplit = this.splitTextNodeAt(startNode, start.offset);
      alignedStart = startSplit.right;
      if (!alignedStart) {
        alignedStart = this.nextTextNodeInDocument(startNode);
      }

      const endSplit = this.splitTextNodeAt(endNode, end.offset);
      alignedEnd = endSplit.left;
      if (!alignedEnd) {
        alignedEnd = this.previousTextNodeInDocument(endNode);
      }
    }

    if (!alignedStart || !alignedEnd) {
      return;
    }

    const covered = this.collectTextNodesBetween(alignedStart, alignedEnd);
    if (covered.length === 0) {
      return;
    }

    const everyHasFormat = covered.every((node) => hasFormat(node.format, flag));
    const mutator: (bits: TextFormatBits) => TextFormatBits = everyHasFormat
      ? (bits) => removeFormat(bits, flag)
      : (bits) => applyFormat(bits, flag);

    for (const node of covered) {
      const nextFormat = mutator(node.format);
      if (nextFormat !== node.format) {
        node.format = nextFormat;
        this.markDirty(node.key);
      }
    }

    this.mergeAdjacentSameFormatRuns(covered);
  }

  /**
   * Split `node` at character offset `offset` into a left and right text
   * node. The original node keeps its key and becomes the left half; a new
   * runtime-keyed text node is inserted after it and receives the right half.
   * Both halves inherit the original format bitfield.
   *
   * No mutation happens at the endpoints: `offset === 0` returns
   * `{ left: null, right: node }` and `offset === node.text.length` returns
   * `{ left: node, right: null }`.
   */
  splitTextNodeAt(
    node: TextNode,
    offset: number,
  ): { left: TextNode | null; right: TextNode | null } {
    if (offset <= 0) {
      return { left: null, right: node };
    }
    if (offset >= node.text.length) {
      return { left: node, right: null };
    }

    const rightText = node.text.slice(offset);
    const leftText = node.text.slice(0, offset);

    const rightNode = $createTextNode(createNodeKey(), rightText, node.format);
    this.insertAfter(node, rightNode);

    node.text = leftText;
    this.markDirty(node.key);

    return { left: node, right: rightNode };
  }

  /**
   * Enumerate all text nodes in the document in order. Used by range
   * operations that may span across paragraphs.
   */
  getTextNodesInDocumentOrder(): TextNode[] {
    return this.getTextNodes();
  }

  private nextTextNodeInDocument(node: TextNode): TextNode | null {
    const all = this.getTextNodes();
    const idx = all.indexOf(node);
    return idx >= 0 && idx + 1 < all.length ? all[idx + 1] : null;
  }

  private previousTextNodeInDocument(node: TextNode): TextNode | null {
    const all = this.getTextNodes();
    const idx = all.indexOf(node);
    return idx > 0 ? all[idx - 1] : null;
  }

  private previousTextNodeInBlock(node: TextNode): TextNode | null {
    let previousKey = node.__prev;
    while (previousKey) {
      const previous = this.nodes.get(previousKey);
      if ($isTextNode(previous) && previous.parent === node.parent) {
        return previous;
      }
      previousKey = previous?.__prev ?? null;
    }
    return null;
  }

  private nextTextNodeInBlock(node: TextNode): TextNode | null {
    let nextKey = node.__next;
    while (nextKey) {
      const next = this.nodes.get(nextKey);
      if ($isTextNode(next) && next.parent === node.parent) {
        return next;
      }
      nextKey = next?.__next ?? null;
    }
    return null;
  }

  private collectTextNodesBetween(startNode: TextNode, endNode: TextNode): TextNode[] {
    if (startNode === endNode) {
      return [startNode];
    }
    const all = this.getTextNodes();
    const startIdx = all.indexOf(startNode);
    const endIdx = all.indexOf(endNode);
    if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
      return [];
    }
    return all.slice(startIdx, endIdx + 1);
  }

  private createEmptyParagraph(): { paragraph: ElementNode; text: TextNode } {
    const paragraph = $createParagraphNode(createNodeKey());
    const text = $createTextNode(createNodeKey(), '');
    this.registerNode(paragraph);
    this.registerNode(text);
    paragraph.append(this.nodes, text);
    return { paragraph, text };
  }

  private splitParagraphBeforeTextNode(
    paragraph: ElementNode,
    firstNodeInNewParagraph: TextNode,
  ): TextRange | null {
    const newParagraph = $createParagraphNode(createNodeKey());
    this.registerNode(newParagraph);
    this.insertAfter(paragraph, newParagraph);
    this.markDirty(this.rootKey);

    this.moveNodeAndFollowingSiblings(firstNodeInNewParagraph, newParagraph);
    const selectionTarget = this.getFirstTextNodeInBlock(newParagraph);
    if (!selectionTarget) {
      return null;
    }
    return createTextRange(
      { key: selectionTarget.key, offset: 0 },
      { key: selectionTarget.key, offset: 0 },
      false,
    );
  }

  private mergeWithPreviousParagraph(textNode: TextNode): TextRange | null {
    const paragraph = textNode.parent ? this.nodes.get(textNode.parent) : null;
    if (!$isElementNode(paragraph)) {
      return null;
    }

    const previousParagraph = this.getPreviousBlock(paragraph);
    if (!previousParagraph) {
      return createTextRange(
        { key: textNode.key, offset: 0 },
        { key: textNode.key, offset: 0 },
        false,
      );
    }

    const previousLastText = this.getLastTextNodeInBlock(previousParagraph);
    if (!previousLastText) {
      return null;
    }

    const mergeOffset = previousLastText.text.length;
    const movedTextNodes = this.moveAllChildren(paragraph, previousParagraph);
    this.remove(paragraph);
    this.markDirty(this.rootKey);

    if (movedTextNodes.length > 0) {
      this.mergeForwardSameFormatRuns(previousLastText);
    }

    const nextPoint: TextPoint = { key: previousLastText.key, offset: mergeOffset };
    return createTextRange(nextPoint, nextPoint, false);
  }

  private mergeWithNextParagraph(textNode: TextNode): TextRange | null {
    const paragraph = textNode.parent ? this.nodes.get(textNode.parent) : null;
    if (!$isElementNode(paragraph)) {
      return null;
    }

    const nextParagraph = this.getNextBlock(paragraph);
    if (!nextParagraph) {
      return createTextRange(
        { key: textNode.key, offset: textNode.text.length },
        { key: textNode.key, offset: textNode.text.length },
        false,
      );
    }

    const mergeOffset = textNode.text.length;
    const movedTextNodes = this.moveAllChildren(nextParagraph, paragraph);
    this.remove(nextParagraph);
    this.markDirty(this.rootKey);

    if (movedTextNodes.length > 0) {
      this.mergeForwardSameFormatRuns(textNode);
    }

    const nextPoint: TextPoint = { key: textNode.key, offset: mergeOffset };
    return createTextRange(nextPoint, nextPoint, false);
  }

  private getPreviousBlock(block: ElementNode): ElementNode | null {
    if (!block.__prev) {
      return null;
    }
    const previous = this.nodes.get(block.__prev);
    return $isElementNode(previous) ? previous : null;
  }

  private getNextBlock(block: ElementNode): ElementNode | null {
    if (!block.__next) {
      return null;
    }
    const next = this.nodes.get(block.__next);
    return $isElementNode(next) ? next : null;
  }

  private getFirstTextNodeInBlock(block: ElementNode): TextNode | null {
    let textKey = block.__first;
    while (textKey) {
      const node = this.nodes.get(textKey);
      if ($isTextNode(node)) {
        return node;
      }
      textKey = node?.__next ?? null;
    }
    return null;
  }

  private getLastTextNodeInBlock(block: ElementNode): TextNode | null {
    let textKey = block.__last;
    while (textKey) {
      const node = this.nodes.get(textKey);
      if ($isTextNode(node)) {
        return node;
      }
      textKey = node?.__prev ?? null;
    }
    return null;
  }

  private moveNodeAndFollowingSiblings(startNode: NodeBase, destination: ElementNode): TextNode[] {
    const movedTextNodes: TextNode[] = [];
    let cursor: NodeBase | undefined = startNode;

    while (cursor) {
      const nextKey: NodeKey | null = cursor.__next;
      this.detach(cursor);
      destination.append(this.nodes, cursor);
      this.markDirty(destination.key);
      if ($isTextNode(cursor)) {
        movedTextNodes.push(cursor);
      }
      cursor = nextKey ? this.nodes.get(nextKey) : undefined;
    }

    return movedTextNodes;
  }

  private moveAllChildren(source: ElementNode, destination: ElementNode): TextNode[] {
    const firstChild = source.__first ? this.nodes.get(source.__first) : undefined;
    if (!firstChild) {
      return [];
    }
    return this.moveNodeAndFollowingSiblings(firstChild, destination);
  }

  private removeEmptyParagraphs(): void {
    const root = this.nodes.get(this.rootKey);
    if (!$isElementNode(root)) {
      return;
    }

    let blockKey = root.__first;
    while (blockKey) {
      const block = this.nodes.get(blockKey);
      const nextKey = block?.__next ?? null;
      if ($isElementNode(block) && block.__size === 0 && root.__size > 1) {
        this.remove(block);
        this.markDirty(this.rootKey);
      }
      blockKey = nextKey;
    }
  }

  private mergeForwardSameFormatRuns(anchor: TextNode): void {
    while (this.nodes.has(anchor.key)) {
      const next = anchor.next ? this.nodes.get(anchor.next) : null;
      if (
        !$isTextNode(next) ||
        next.parent !== anchor.parent ||
        next.format !== anchor.format
      ) {
        return;
      }
      anchor.text = anchor.text + next.text;
      this.markDirty(anchor.key);
      this.remove(next);
    }
  }

  /**
   * Walk the text nodes just mutated by a formatting operation and merge
   * any pair of adjacent same-parent siblings that ended up with identical
   * format bitfields. Merging preserves the left node's key (so any caret
   * tracking that key stays intact) and removes the right.
   *
   * We extend the scan by one neighbor on each side so we can also merge
   * the new left-aligned run with its predecessor (which may have matched
   * beforehand but is now part of a newly contiguous run).
   */
  private mergeAdjacentSameFormatRuns(covered: TextNode[]) {
    if (covered.length === 0) {
      return;
    }

    const first = covered[0];
    const last = covered[covered.length - 1];

    const predecessor = this.previousTextNodeInDocument(first);
    const successor = this.nextTextNodeInDocument(last);

    const candidates: TextNode[] = [];
    if (predecessor) {
      candidates.push(predecessor);
    }
    candidates.push(...covered);
    if (successor) {
      candidates.push(successor);
    }

    for (let i = 0; i < candidates.length - 1; i += 1) {
      const left = candidates[i];
      const right = candidates[i + 1];
      // Skip entries that may have been removed by an earlier merge in this pass.
      if (!this.nodes.has(left.key) || !this.nodes.has(right.key)) {
        continue;
      }
      if (
        left.parent === right.parent &&
        left.format === right.format &&
        left.next === right.key
      ) {
        left.text = left.text + right.text;
        this.markDirty(left.key);
        this.remove(right);
        candidates[i + 1] = left;
      }
    }
  }

  /**
   * Serialize the current state to a canonical v1 snapshot.
   * Nodes that don't implement `exportJSON` are skipped - v1 only supports
   * root/paragraph/text.
   */
  toJSON(): EditorStateSnapshot {
    const nodes: Record<NodeKey, SerializedNode> = {};
    for (const [key, node] of this.nodes) {
      const serialized = (node as NodeBase & {
        exportJSON?: () => SerializedNode;
      }).exportJSON?.();
      if (serialized) {
        nodes[key] = serialized;
      }
    }
    return {
      version: SNAPSHOT_VERSION,
      rootKey: this.rootKey,
      nodes,
    };
  }

  /**
   * Build a new EditorState from a v1 snapshot. Throws `InvalidSnapshotError`
   * for malformed input without producing a partial state.
   */
  static fromJSON(raw: unknown): EditorState {
    const snapshot = validateSnapshot(raw);

    const nodes: NodeMap = new Map();
    for (const [key, record] of Object.entries(snapshot.nodes)) {
      const node = materializeNode(record);
      nodes.set(key, node);
    }

    return new EditorState(nodes, snapshot.rootKey);
  }
}

function materializeNode(record: SerializedNode): NodeBase {
  switch (record.type) {
    case 'root':
      return RootNode.importJSON(record);
    case 'paragraph':
      return ParagraphNode.importJSON(record);
    case 'text':
      return TextNode.importJSON(record);
    default: {
      const exhaustive: never = record;
      throw new InvalidSnapshotError(
        `cannot materialize unknown node record: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
