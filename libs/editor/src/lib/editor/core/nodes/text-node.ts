import { NodeBase } from './node';
import { SerializedTextNode } from '../snapshot';

export class TextNode extends NodeBase {
  constructor(key: string, public text: string) {
    super(key);
  }

  static override getType(): string {
    return 'text';
  }

  override createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.text;
    return span;
  }

  override updateDOM(dom: HTMLElement): boolean {
    if (dom.textContent !== this.text) {
      dom.textContent = this.text;
      return true;
    }
    return false;
  }

  exportJSON(): SerializedTextNode {
    return {
      type: 'text',
      version: TextNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
      text: this.text,
    };
  }

  static importJSON(data: SerializedTextNode): TextNode {
    const node = new TextNode(data.key, data.text);
    node.__parent = data.parent;
    node.__prev = data.prev;
    node.__next = data.next;
    return node;
  }
}
