import { NodeBase } from './node';
import { SerializedLineBreakNode } from '../snapshot';

export class LineBreakNode extends NodeBase {
  constructor(key: string) {
    super(key);
  }

  static override getType(): string {
    return 'linebreak';
  }

  static override clone(node: unknown): LineBreakNode {
    return new LineBreakNode((node as LineBreakNode).__key);
  }

  override afterCloneFrom(prev: this): void {
    super.afterCloneFrom(prev);
  }

  static override readonly version: number = 1;

  override createDOM(): HTMLElement {
    return document.createElement('br');
  }

  override updateDOM(_dom: HTMLElement): boolean {
    return false;
  }

  exportJSON(): SerializedLineBreakNode {
    return {
      type: 'linebreak',
      version: LineBreakNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
    };
  }

  static importJSON(data: SerializedLineBreakNode): LineBreakNode {
    const node = new LineBreakNode(data.key);
    node.__parent = data.parent;
    node.__prev = data.prev;
    node.__next = data.next;
    return node;
  }
}
