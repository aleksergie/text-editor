import { NodeBase, NodeKey, NodeMap } from './node';
import {
  SerializedParagraphNode,
  SerializedRootNode,
} from '../snapshot';

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

  static override getType(): string {
    return 'element';
  }

  override createDOM(): HTMLElement {
    return document.createElement('div');
  }

  override updateDOM(_dom: HTMLElement): boolean {
    return false;
  }
}

export class RootNode extends ElementNode {
  static override getType(): string {
    return 'root';
  }

  override createDOM(): HTMLElement {
    throw new Error('root does not create DOM');
  }

  exportJSON(): SerializedRootNode {
    return {
      type: 'root',
      version: RootNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
      first: this.__first,
      last: this.__last,
      size: this.__size,
    };
  }

  static importJSON(data: SerializedRootNode): RootNode {
    const node = new RootNode(data.key, data.parent);
    node.__prev = data.prev;
    node.__next = data.next;
    node.__first = data.first;
    node.__last = data.last;
    node.__size = data.size;
    return node;
  }
}

export class ParagraphNode extends ElementNode {
  static override getType(): string {
    return 'paragraph';
  }

  override createDOM(): HTMLElement {
    return document.createElement('p');
  }

  exportJSON(): SerializedParagraphNode {
    return {
      type: 'paragraph',
      version: ParagraphNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
      first: this.__first,
      last: this.__last,
      size: this.__size,
    };
  }

  static importJSON(data: SerializedParagraphNode): ParagraphNode {
    const node = new ParagraphNode(data.key, data.parent);
    node.__prev = data.prev;
    node.__next = data.next;
    node.__first = data.first;
    node.__last = data.last;
    node.__size = data.size;
    return node;
  }
}
