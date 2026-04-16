import { EditorState } from './state';
import { ElementNode } from './nodes/element-node';
import { NodeKey } from './nodes/node';
import { $isElementNode, $isTextNode } from './nodes/node-utils';

export class Reconciler {
  private keyToDom = new Map<string, HTMLElement>();
  private renderOrder: NodeKey[] = [];

  mount(rootEl: HTMLElement, state: EditorState) {
    this.render(rootEl, state);
  }

  update(rootEl: HTMLElement, prev: EditorState, next: EditorState) {
    const nextOrder = this.getRenderOrder(next);
    if (!this.isSameOrder(this.renderOrder, nextOrder)) {
      this.render(rootEl, next);
      return;
    }

    const dirtyNodeKeys = next.getDirtyNodeKeys();
    if (dirtyNodeKeys.size === 0) {
      return;
    }

    for (const key of dirtyNodeKeys) {
      const nextNode = next.nodes.get(key);
      const prevNode = prev.nodes.get(key);
      if (!nextNode || !prevNode || prevNode.__type !== nextNode.__type) {
        this.render(rootEl, next);
        return;
      }

      const dom = this.keyToDom.get(key);
      if (!dom) {
        continue;
      }

      nextNode.updateDOM(dom);
    }
  }

  private render(rootEl: HTMLElement, state: EditorState) {
    rootEl.innerHTML = '';
    this.keyToDom.clear();
    this.renderOrder = [];

    const root = state.nodes.get(state.rootKey);
    if (!root || !$isElementNode(root)) {
      return;
    }

    let childKey = root.__first;
    while (childKey) {
      const child = state.nodes.get(childKey);

      if (child instanceof ElementNode) {
        const p = child.createDOM();
        this.keyToDom.set(childKey, p);
        this.renderOrder.push(childKey);

        let textKey = child.__first;
        while (textKey) {
          const t = state.nodes.get(textKey);
          if ($isTextNode(t)) {
            const span = t.createDOM();
            this.keyToDom.set(textKey, span);
            this.renderOrder.push(textKey);
            p.appendChild(span);
          }

          textKey = t?.__next ?? null;
        }

        rootEl.appendChild(p);
      } else if ($isTextNode(child)) {
        const span = child.createDOM();
        this.keyToDom.set(childKey, span);
        this.renderOrder.push(childKey);
        rootEl.appendChild(span);
      }

      childKey = child?.__next ?? null;
    }
  }

  private getRenderOrder(state: EditorState): NodeKey[] {
    const order: NodeKey[] = [];
    const root = state.nodes.get(state.rootKey);
    if (!root || !$isElementNode(root)) {
      return order;
    }

    let childKey = root.__first;
    while (childKey) {
      const child = state.nodes.get(childKey);
      if (child instanceof ElementNode) {
        order.push(childKey);
        let textKey = child.__first;
        while (textKey) {
          const text = state.nodes.get(textKey);
          if ($isTextNode(text)) {
            order.push(textKey);
          }
          textKey = text?.__next ?? null;
        }
      } else if ($isTextNode(child)) {
        order.push(childKey);
      }
      childKey = child?.__next ?? null;
    }

    return order;
  }

  private isSameOrder(prevOrder: NodeKey[], nextOrder: NodeKey[]): boolean {
    if (prevOrder.length !== nextOrder.length) {
      return false;
    }
    for (let i = 0; i < prevOrder.length; i += 1) {
      if (prevOrder[i] !== nextOrder[i]) {
        return false;
      }
    }
    return true;
  }
}
