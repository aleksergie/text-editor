import { NodeBase, NodeKey } from './node';

export class ElementNode extends NodeBase {
  children: NodeKey[] = [];
}
