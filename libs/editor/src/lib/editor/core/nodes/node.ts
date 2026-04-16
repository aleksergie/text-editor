export type NodeKey = string;

export type NodeMap = Map<NodeKey, NodeBase>;

let nodeKeyCounter = 0;

/**
 * Mint a unique NodeKey for runtime-created nodes. Baseline keys
 * (`root`, `p1`, `t1`) are still hand-assigned by `EditorState.createEmpty`;
 * everything created by command handlers or imports gets a generated key.
 */
export function createNodeKey(): NodeKey {
  nodeKeyCounter += 1;
  return `n${nodeKeyCounter}`;
}

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

  static getType(): string {
    return 'node';
  }

  static readonly version: number = 1;

  protected getType(): string {
    return (this.constructor as typeof NodeBase).getType();
  }

  createDOM(): HTMLElement {
    throw new Error(`${this.__type} does not implement createDOM`);
  }

  updateDOM(_dom: HTMLElement): boolean {
    return false;
  }
}
