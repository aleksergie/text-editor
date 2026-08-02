export type NodeKey = string;
import { $getActiveEditor, $getActiveEditorState } from '../active-context';

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

  getWritable(): this {
    const editor = $getActiveEditor();
    const editorState = $getActiveEditorState();
    if (!editor || !editorState) {
      throw new Error('getWritable: no active context');
    }
    const key = this.__key;
    const latest = editorState.nodes.get(key);
    if (editorState._cloneNotNeeded.has(key) && latest) {
      return latest as this;
    }
    const base = latest || this;
    const constructor = base.constructor as typeof NodeBase;
    const clone = constructor.clone(base);
    clone.afterCloneFrom(base);
    
    editorState.nodes.set(key, clone);
    editorState._cloneNotNeeded.add(key);
    
    return clone as this;
  }

  getLatest(): this {
    const state = $getActiveEditorState();
    if (!state) {
      return this;
    }
    const latest = state.nodes.get(this.__key);
    return (latest as this) || this;
  }

  static clone(node: unknown): NodeBase {
    return new NodeBase((node as NodeBase).__key, (node as NodeBase).__parent);
  }

  afterCloneFrom(prev: this): void {
    this.__parent = prev.__parent;
    this.__prev = prev.__prev;
    this.__next = prev.__next;
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
