import { NodeBase } from './node';
import { SerializedTabNode } from '../snapshot';

export class TabNode extends NodeBase {
  constructor(key: string) {
    super(key);
  }

  static override getType(): string {
    return 'tab';
  }

  static override clone(node: unknown): TabNode {
    return new TabNode((node as TabNode).__key);
  }

  override afterCloneFrom(prev: this): void {
    super.afterCloneFrom(prev);
  }

  static override readonly version: number = 1;

  override createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.whiteSpace = 'pre';
    span.textContent = '\t';
    return span;
  }

  override updateDOM(_dom: HTMLElement): boolean {
    return false;
  }

  exportJSON(): SerializedTabNode {
    return {
      type: 'tab',
      version: TabNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
    };
  }

  static importJSON(data: SerializedTabNode): TabNode {
    const node = new TabNode(data.key);
    node.__parent = data.parent;
    node.__prev = data.prev;
    node.__next = data.next;
    return node;
  }
}
