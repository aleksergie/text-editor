import { EditorState } from './state';
import { ElementNode } from './nodes/element-node';
import { NodeKey } from './nodes/node';
import { $isElementNode, $isTextNode } from './nodes/node-utils';

export class Reconciler {
  private keyToDom = new Map<NodeKey, HTMLElement>();
  private renderOrder: NodeKey[] = [];
  /**
   * Reverse lookup: any DOM element or text node we wrote during `createDOM`
   * maps to the NodeKey that produced it. A WeakMap lets detached subtrees
   * (e.g. after `render` clears innerHTML) get garbage collected without our
   * intervention, and keeps us from polluting the user's DOM with
   * `data-*` attributes.
   */
  private domToKey = new WeakMap<Node, NodeKey>();

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
      // updateDOM may have swapped inner descendants (e.g. a TextNode format
      // change rebuilt its tag stack); re-index the subtree so DOM->key
      // lookups continue to resolve through the new children.
      this.indexSubtree(dom, key);
    }
  }

  /**
   * Return the rendered element for a given NodeKey, or `null` if the node
   * is not currently rendered. Used by the selection bridge to confirm a
   * DOM anchor maps to a still-mounted node.
   */
  getDom(key: NodeKey): HTMLElement | null {
    return this.keyToDom.get(key) ?? null;
  }

  /**
   * Walk from `node` (or any ancestor in the rendered subtree) up to the
   * nearest DOM node we registered during `createDOM`. Returns the NodeKey
   * that produced that DOM, or `null` if none match (e.g. `node` is outside
   * the editor root).
   */
  keyForDomNode(node: Node | null): NodeKey | null {
    let cursor: Node | null = node;
    while (cursor) {
      const key = this.domToKey.get(cursor);
      if (key !== undefined) {
        return key;
      }
      cursor = cursor.parentNode;
    }
    return null;
  }

  private render(rootEl: HTMLElement, state: EditorState) {
    rootEl.innerHTML = '';
    this.keyToDom.clear();
    this.renderOrder = [];
    // WeakMap entries for detached nodes will be GCed; no explicit clear.

    const root = state.nodes.get(state.rootKey);
    if (!root || !$isElementNode(root)) {
      return;
    }

    let childKey = root.__first;
    while (childKey) {
      const child = state.nodes.get(childKey);

      if (child instanceof ElementNode) {
        const p = child.createDOM();
        this.registerDom(childKey, p);
        this.renderOrder.push(childKey);

        let textKey = child.__first;
        while (textKey) {
          const t = state.nodes.get(textKey);
          if ($isTextNode(t)) {
            const span = t.createDOM();
            this.registerDom(textKey, span);
            this.renderOrder.push(textKey);
            p.appendChild(span);
            this.indexSubtree(span, textKey);
          }

          textKey = t?.__next ?? null;
        }

        rootEl.appendChild(p);
      } else if ($isTextNode(child)) {
        const span = child.createDOM();
        this.registerDom(childKey, span);
        this.renderOrder.push(childKey);
        rootEl.appendChild(span);
        this.indexSubtree(span, childKey);
      }

      childKey = child?.__next ?? null;
    }
  }

  private registerDom(key: NodeKey, dom: HTMLElement) {
    this.keyToDom.set(key, dom);
    this.domToKey.set(dom, key);
  }

  /**
   * Map every descendant DOM node under `host` back to `key`. TextNode hosts
   * are wrapped in a nested tag stack (e.g. `<span><strong>hi</strong></span>`
   * for bold text) and without this indexing, a selection anchored on the
   * `<strong>` could not be traced back to its model node.
   */
  private indexSubtree(host: Node, key: NodeKey) {
    this.domToKey.set(host, key);
    if (host.nodeType !== Node.ELEMENT_NODE && host.nodeType !== Node.TEXT_NODE) {
      return;
    }
    const walker = (host as Element).ownerDocument?.createTreeWalker(
      host,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    if (!walker) {
      return;
    }
    let current = walker.nextNode();
    while (current) {
      this.domToKey.set(current, key);
      current = walker.nextNode();
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
