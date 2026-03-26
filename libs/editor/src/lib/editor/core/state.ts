import { NodeKey, NodeMap } from './nodes/node';
import { TextNode } from './nodes/text-node';
import { $createElementNode, $createRootNode, $createTextNode, $isElementNode, $isTextNode } from './nodes/node-utils';

export class EditorState {
  constructor(
    public readonly nodes: NodeMap,
    public readonly rootKey: NodeKey,
  ) { }

  static createEmpty() {
    const nodes: NodeMap = new Map();
    const root = $createRootNode('root');
    const paragraph = $createElementNode('p1');
    const text = $createTextNode('t1', 'default text');

    nodes.set(root.key, root);
    nodes.set(paragraph.key, paragraph);
    nodes.set(text.key, text);

    root.append(nodes, paragraph);
    paragraph.append(nodes, text);

    return new EditorState(nodes, root.key);
  }

  clone() {
    return new EditorState(new Map(this.nodes), this.rootKey);
  }


  setText(nextText: string) {
    const textNode = this.getFirstTextNode();
    if (textNode) {
      textNode.text = nextText;
    }
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
}

// export function cloneEditorState(current: EditorState): EditorState {
//   return new EditorState(new Map(current._nodeMap));
// }

// export function createEmptyEditorState(): EditorState {
//   return new EditorState(new Map([['root', $createRootNode()]]));
// }
