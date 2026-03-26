import { NodeBase } from './node';

export class TextNode extends NodeBase {
  constructor(key: string, public text: string) {
    super(key);
  }

  protected override getType(): string {
    return 'text';
  }

  override createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.text;
    return span;
  }

  override updateDOM(dom: HTMLElement): boolean {
    if (dom.textContent !== this.text) {
      dom.textContent = this.text;
      return true;
    }
    return false;
  }
}
