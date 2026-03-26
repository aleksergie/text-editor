import { NodeBase, NodeKey, NodeMap } from './node';

export class ElementNode extends NodeBase {
  __first: NodeKey | null = null;
  __last: NodeKey | null = null;
  __size = 0;

  append(nodeMap: NodeMap, child: NodeBase) {
    const childKey = child.__key;
    child.__parent = this.__key;

    const lastKey = this.__last;
    if (lastKey === null) {
      this.__first = childKey;
      this.__last = childKey;
      child.__prev = null;
      child.__next = null;
      this.__size = 1;
      return;
    }

    const last = nodeMap.get(lastKey);
    if (last) {
      last.__next = childKey;
    }
    child.__prev = lastKey;
    child.__next = null;
    this.__last = childKey;
    this.__size += 1;
  }

  protected override getType(): string {
    return 'element';
  }

  override createDOM(): HTMLElement {
    return document.createElement('p');
  }

  override updateDOM(_dom: HTMLElement): boolean {
    return false;
  }
}

export class RootNode extends ElementNode {
  protected override getType(): string {
    return 'root';
  }

  override createDOM(): HTMLElement {
    throw new Error('root does not create DOM');
  }
}
