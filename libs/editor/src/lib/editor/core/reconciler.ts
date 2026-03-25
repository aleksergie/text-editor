import { EditorState } from './state';
import { ElementNode } from './nodes/element-node';
import { RootNode } from './nodes/node';
import { TextNode } from './nodes/text-node';

export class Reconciler {
  private keyToDom = new Map<string, HTMLElement>();

  mount(rootEl: HTMLElement, state: EditorState) {
    this.render(rootEl, state);
  }

  update(rootEl: HTMLElement, prev: EditorState, next: EditorState) {
    const prevText = prev.getText();
    const nextText = next.getText();
    const textDom = this.keyToDom.get('t1');

    if (!textDom) {
      this.render(rootEl, next);
      return;
    }

    if (prevText !== nextText) {
      textDom.textContent = nextText;
    }
  }

  private render(rootEl: HTMLElement, state: EditorState) {
    rootEl.innerHTML = '';
    this.keyToDom.clear();

    const root = state.nodes.get(state.rootKey) as RootNode;
    for (const childKey of root.children) {
      const child = state.nodes.get(childKey);

      if (child instanceof ElementNode) {

        const p = document.createElement('p');
        this.keyToDom.set(childKey, p);

        for (const textKey of child.children) {
          const t = state.nodes.get(textKey) as TextNode;
          const span = document.createElement('span');

          span.textContent = t.text;
          this.keyToDom.set(textKey, span);
          p.appendChild(span);
        }

        rootEl.appendChild(p);
      }
    }
  }
}
