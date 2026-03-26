export type NodeKey = string;

export type NodeMap = Map<NodeKey, NodeBase>;

export class NodeBase {
  __type: string;
  __key: NodeKey;
  __parent: null | NodeKey;
  __prev: null | NodeKey;
  __next: null | NodeKey;

  constructor(key: NodeKey, parent: NodeKey | null = null) {
    this.__parent = parent;
    this.__prev = null;
    this.__next = null;
    this.__type = this.getType();
    this.__key = key;
  }

  get key(): NodeKey {
    return this.__key;
  }

  get parent(): NodeKey | null {
    return this.__parent;
  }

  get prev(): NodeKey | null {
    return this.__prev;
  }

  get next(): NodeKey | null {
    return this.__next;
  }

  protected getType(): string {
    return 'node';
  }

  createDOM(): HTMLElement {
    throw new Error(`${this.__type} does not implement createDOM`);
  }

  updateDOM(_dom: HTMLElement): boolean {
    return false;
  }
}
