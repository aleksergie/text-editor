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
  remove as removeUtil,
  replace as replaceUtil,
} from './nodes/node-utils';
import {
  EditorStateSnapshot,
  InvalidSnapshotError,
  SNAPSHOT_VERSION,
  SerializedNode,
  validateSnapshot,
} from './snapshot';

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
    const paragraph = $createParagraphNode(createNodeKey());
    const text = $createTextNode(createNodeKey(), '');
    this.registerNode(paragraph);
    this.registerNode(text);
    paragraph.append(this.nodes, text);

    const root = this.nodes.get(this.rootKey);
    if ($isElementNode(root)) {
      root.append(this.nodes, paragraph);
      this.markDirty(this.rootKey);
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
