import { EditorState, NO_DIRTY_NODES } from './state';
import { ElementNode } from './nodes/element-node';
import { NodeBase, NodeKey } from './nodes/node';
import { $isElementNode, $isTextNode } from './nodes/node-utils';

export class Reconciler {
  private keyToDom = new Map<NodeKey, HTMLElement>();
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

  /**
   * Reconcile from the root downwards. Visits only the subtrees that contain
   * dirt (intentional or bubble), per the dirty-element bubble-up invariant
   * maintained by `EditorState.markDirty`. See ADR-004 and CONTEXT.md for the
   * vocabulary.
   *
   * Pre-condition: `mount` has been called on `rootEl` with `prev`.
   */
  update(rootEl: HTMLElement, prev: EditorState, next: EditorState) {
    if (next.getDirtyType() === NO_DIRTY_NODES) {
      return;
    }

    if (next.rootKey !== prev.rootKey) {
      this.render(rootEl, next);
      return;
    }

    const rootNode = next.nodes.get(next.rootKey);
    if (!$isElementNode(rootNode)) {
      this.render(rootEl, next);
      return;
    }

    this.reconcileChildren(rootNode, rootEl, prev, next);
  }

  /**
   * Reconcile a single keyed node whose DOM identity is preserved across this
   * update. The caller guarantees `keyToDom.has(key)`. Applies `updateDOM`
   * only when the node is **intentionally** dirty, then descends into
   * element children when any descendant carries dirt (bubble entry present).
   */
  private reconcileNode(key: NodeKey, prev: EditorState, next: EditorState) {
    const nextNode = next.nodes.get(key);
    const dom = this.keyToDom.get(key);
    if (!nextNode || !dom) {
      return;
    }

    const dirtyLeaves = next.getDirtyLeaves();
    const dirtyElements = next.getDirtyElements();
    const intentional = dirtyLeaves.has(key) || dirtyElements.get(key) === true;

    if (intentional) {
      const subtreeReplaced = nextNode.updateDOM(dom);
      if (subtreeReplaced) {
        this.indexSubtree(dom, key);
      }
    }

    if ($isElementNode(nextNode) && dirtyElements.has(key)) {
      this.reconcileChildren(nextNode, dom, prev, next);
    }
  }

  /**
   * Walk `nextElement`'s child chain (`__first` / `__next`) and reconcile each
   * child against the DOM that is currently in `parentDom`. Existing children
   * are reused (and reordered if the chain order shifted), new children are
   * created, removed children are cleaned up at the end.
   *
   * Source of truth for "what was previously rendered" is `keyToDom`, not
   * `prev`. `prev` is only consulted for the same-key type-change check and
   * to walk the model subtree of a removed key during DOM cleanup. This
   * asymmetry exists because `EditorState.clone` shares `NodeBase` instances
   * between prev and next - the in-memory tree pointers reflect the
   * post-mutation state on both sides.
   */
  private reconcileChildren(
    nextElement: ElementNode,
    parentDom: HTMLElement,
    prev: EditorState,
    next: EditorState,
  ) {
    const visitedKeys = new Set<NodeKey>();
    let domCursor: Node | null = parentDom.firstChild;

    let nextChildKey = nextElement.__first;
    while (nextChildKey) {
      const child = next.nodes.get(nextChildKey);
      if (!child) {
        break;
      }
      visitedKeys.add(nextChildKey);

      const existingDom = this.keyToDom.get(nextChildKey);
      const prevChild = prev.nodes.get(nextChildKey);
      const typeMatches = !prevChild || prevChild.__type === child.__type;

      let childDom: HTMLElement | null;
      if (existingDom && typeMatches) {
        this.reconcileNode(nextChildKey, prev, next);
        childDom = existingDom;
      } else {
        if (existingDom?.parentNode) {
          existingDom.parentNode.removeChild(existingDom);
        }
        if (existingDom) {
          this.keyToDom.delete(nextChildKey);
        }
        childDom = this.createNode(nextChildKey, next);
      }

      if (childDom && domCursor !== childDom) {
        parentDom.insertBefore(childDom, domCursor);
      }
      domCursor = childDom?.nextSibling ?? null;

      nextChildKey = child.__next;
    }

    // Anything left at or after `domCursor` is a child that existed in the
    // previous render but is no longer in `next`. Remove the DOM and drop
    // the keyToDom entries for the entire detached subtree.
    while (domCursor) {
      const sibling: Node | null = domCursor.nextSibling;
      const key = this.domToKey.get(domCursor);
      parentDom.removeChild(domCursor);
      if (key !== undefined) {
        this.deleteKeyToDomSubtree(key, prev);
      }
      domCursor = sibling;
    }
  }

  /**
   * Create the DOM subtree for `key` and register every model-owned host
   * element in `keyToDom` / `domToKey`. Used by both the full-render path
   * and by `reconcileChildren` when inserting new children.
   */
  private createNode(key: NodeKey, state: EditorState): HTMLElement | null {
    const node = state.nodes.get(key);
    if (!node) {
      return null;
    }

    if ($isElementNode(node)) {
      const dom = node.createDOM();
      this.registerDom(key, dom);
      let childKey = node.__first;
      while (childKey) {
        const child = state.nodes.get(childKey);
        if (!child) {
          break;
        }
        const childDom = this.createNode(childKey, state);
        if (childDom) {
          dom.appendChild(childDom);
        }
        childKey = child.__next;
      }
      return dom;
    }

    if ($isTextNode(node)) {
      const dom = node.createDOM();
      this.registerDom(key, dom);
      this.indexSubtree(dom, key);
      return dom;
    }

    return null;
  }

  /**
   * Recursively drop `keyToDom` entries for `key` and its model descendants.
   * Walks via `prev` because the removed subtree's pointers reflect its
   * pre-removal shape there (state mutations unlink the subtree from its
   * parent but do not touch the subtree's own internal pointers, and `prev`
   * still has the removed node in its Map).
   */
  private deleteKeyToDomSubtree(key: NodeKey, prev: EditorState) {
    this.keyToDom.delete(key);
    const node = prev.nodes.get(key);
    if (!$isElementNode(node)) {
      return;
    }
    let childKey: NodeKey | null = node.__first;
    while (childKey) {
      const next: NodeBase | undefined = prev.nodes.get(childKey);
      this.deleteKeyToDomSubtree(childKey, prev);
      childKey = next?.__next ?? null;
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
    return this.nearestManagedDomPair(node)?.key ?? null;
  }

  /** Exact `domToKey` lookup; does not walk ancestors. */
  keyForExactDomNode(node: Node | null): NodeKey | null {
    if (!node) {
      return null;
    }
    return this.domToKey.get(node) ?? null;
  }

  isManagedDomNode(node: Node | null): boolean {
    return this.keyForExactDomNode(node) !== null;
  }

  /**
   * Walk ancestors until a registered DOM node is found, then return the
   * rendered host element for its model key.
   */
  nearestManagedDomPair(node: Node | null): { dom: HTMLElement; key: NodeKey } | null {
    let cursor: Node | null = node;
    while (cursor) {
      const key = this.domToKey.get(cursor);
      if (key !== undefined) {
        const dom = this.keyToDom.get(key);
        if (dom) {
          return { dom, key };
        }
        return null;
      }
      cursor = cursor.parentNode;
    }
    return null;
  }

  private render(rootEl: HTMLElement, state: EditorState) {
    rootEl.innerHTML = '';
    this.keyToDom.clear();
    // WeakMap entries for detached nodes will be GCed; no explicit clear.

    const root = state.nodes.get(state.rootKey);
    if (!root || !$isElementNode(root)) {
      return;
    }

    let childKey = root.__first;
    while (childKey) {
      const child = state.nodes.get(childKey);
      if (!child) {
        break;
      }
      const childDom = this.createNode(childKey, state);
      if (childDom) {
        rootEl.appendChild(childDom);
      }
      childKey = child.__next;
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
}
