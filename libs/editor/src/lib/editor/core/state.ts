import { ElementNode } from './nodes/element-node';
import { NodeKey, RootNode } from './nodes/node';
import { TextNode } from './nodes/text-node';

export class EditorState {
  constructor(
    public readonly nodes: Map<NodeKey, unknown>,
    public readonly rootKey: NodeKey,
  ) { }

  static createEmpty() {
    const nodes = new Map<NodeKey, unknown>();
    const root = new RootNode('root', null);
    const paragraph = new ElementNode('p1', root.key);
    const text = new TextNode('t1', paragraph.key, 'default text');

    root.children.push(paragraph.key);
    paragraph.children.push(text.key);

    nodes.set(root.key, root);
    nodes.set(paragraph.key, paragraph);
    nodes.set(text.key, text);

    return new EditorState(nodes, root.key);
  }

  clone() {
    return new EditorState(new Map(this.nodes), this.rootKey);
  }

  setText(nextText: string) {
    const textNode = this.nodes.get('t1') as TextNode | undefined;
    if (textNode) {
      textNode.text = nextText;
    }
  }

  getText(): string {
    const textNode = this.nodes.get('t1') as TextNode | undefined;
    return textNode?.text ?? '';
  }
}
