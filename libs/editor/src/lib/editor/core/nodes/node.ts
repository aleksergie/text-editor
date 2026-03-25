export type NodeKey = string;

export abstract class NodeBase {
  constructor(public key: NodeKey, public parent: NodeKey | null) {}
}

export class RootNode extends NodeBase {
  children: NodeKey[] = [];
}
