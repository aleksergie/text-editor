import { NodeBase } from './node';

export class TextNode extends NodeBase {
  constructor(key: string, parent: string | null, public text: string) {
    super(key, parent);
  }
}
