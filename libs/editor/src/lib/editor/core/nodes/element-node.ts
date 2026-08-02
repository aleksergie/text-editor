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
    const writableChild = child.getWritable();
    writableChild.__parent = this.__key;

    const latestThis = nodeMap.get(this.__key) as ElementNode || this;
    const lastKey = latestThis.__last;
    const writableThis = latestThis.getWritable();
    if (lastKey === null) {
      writableThis.__first = childKey;
      writableThis.__last = childKey;
      writableChild.__prev = null;
      writableChild.__next = null;
      writableThis.__size = 1;
      return;
    }

    const last = nodeMap.get(lastKey);
    if (last) {
      last.getWritable().__next = childKey;
    }
    writableChild.__prev = lastKey;
    writableChild.__next = null;
    writableThis.__last = childKey;
    writableThis.__size += 1;
  }

  static override clone(node: unknown): ElementNode {
    return new ElementNode((node as ElementNode).__key, (node as ElementNode).__parent);
  }

  override afterCloneFrom(prev: this): void {
    super.afterCloneFrom(prev);
    this.__first = prev.__first;
    this.__last = prev.__last;
    this.__size = prev.__size;
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

  static override clone(node: unknown): RootNode {
    return new RootNode((node as RootNode).__key, (node as RootNode).__parent);
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

  static override clone(node: unknown): ParagraphNode {
    return new ParagraphNode((node as ParagraphNode).__key, (node as ParagraphNode).__parent);
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
