import {
  $createParagraphNode,
  $createRootNode,
  $createTextNode,
} from './nodes/node-utils';
import { NodeMap } from './nodes/node';
import { Reconciler } from './reconciler';
import { EditorState } from './state';

function buildState(paragraphs: Array<Array<{ key: string; text: string }>>): EditorState {
  const nodes: NodeMap = new Map();
  const root = $createRootNode('root');
  nodes.set(root.key, root);

  paragraphs.forEach((textNodes, pIdx) => {
    const paragraph = $createParagraphNode(`p${pIdx + 1}`);
    nodes.set(paragraph.key, paragraph);
    root.append(nodes, paragraph);
    for (const { key, text } of textNodes) {
      const textNode = $createTextNode(key, text);
      nodes.set(textNode.key, textNode);
      paragraph.append(nodes, textNode);
    }
  });

  return new EditorState(nodes, root.key);
}

describe('Reconciler', () => {
  let rootEl: HTMLElement;
  let reconciler: Reconciler;

  beforeEach(() => {
    rootEl = document.createElement('div');
    reconciler = new Reconciler();
  });

  describe('mount', () => {
    it('renders paragraphs and text spans for the initial state', () => {
      const state = buildState([[{ key: 't1', text: 'hello' }]]);

      reconciler.mount(rootEl, state);

      expect(rootEl.children).toHaveLength(1);
      const paragraph = rootEl.children[0];
      expect(paragraph.tagName).toBe('P');
      expect(paragraph.children).toHaveLength(1);
      expect(paragraph.textContent).toBe('hello');
    });

    it('clears existing content before rendering', () => {
      rootEl.innerHTML = '<span>stale</span>';
      const state = buildState([[{ key: 't1', text: 'fresh' }]]);

      reconciler.mount(rootEl, state);

      expect(rootEl.textContent).toBe('fresh');
    });
  });

  describe('update - dirty-only path', () => {
    it('updates only the dirty text node DOM when structure is unchanged', () => {
      const prev = buildState([[{ key: 't1', text: 'old' }]]);
      reconciler.mount(rootEl, prev);
      const paragraphBefore = rootEl.children[0];
      const spanBefore = paragraphBefore.children[0];

      const next = buildState([[{ key: 't1', text: 'new' }]]);
      next.markDirty('t1');

      reconciler.update(rootEl, prev, next);

      expect(rootEl.children[0]).toBe(paragraphBefore);
      expect(paragraphBefore.children[0]).toBe(spanBefore);
      expect(spanBefore.textContent).toBe('new');
    });

    it('does nothing when there are no dirty nodes and structure is unchanged', () => {
      const prev = buildState([[{ key: 't1', text: 'same' }]]);
      reconciler.mount(rootEl, prev);
      const spanBefore = rootEl.children[0].children[0];
      const html = rootEl.innerHTML;

      const next = buildState([[{ key: 't1', text: 'same' }]]);
      reconciler.update(rootEl, prev, next);

      expect(rootEl.children[0].children[0]).toBe(spanBefore);
      expect(rootEl.innerHTML).toBe(html);
    });
  });

  describe('update - structural changes', () => {
    it('preserves existing paragraph DOM identity when a sibling is added', () => {
      const prev = buildState([[{ key: 't1', text: 'one' }]]);
      reconciler.mount(rootEl, prev);
      const paragraphBefore = rootEl.children[0];
      const spanBefore = paragraphBefore.children[0];

      const next = buildState([
        [{ key: 't1', text: 'one' }],
        [{ key: 't2', text: 'two' }],
      ]);
      // Mirror what state.insertAfter does: mark the structural parent dirty.
      next.markDirty(next.rootKey);

      reconciler.update(rootEl, prev, next);

      expect(rootEl.children).toHaveLength(2);
      // PR-2's locality win: the original paragraph DOM is reused, not recreated.
      expect(rootEl.children[0]).toBe(paragraphBefore);
      expect(rootEl.children[0].children[0]).toBe(spanBefore);
      expect(rootEl.children[1].textContent).toBe('two');
    });

    it('removes paragraph DOM and clears its keyToDom entry when a sibling is removed', () => {
      const prev = buildState([
        [{ key: 't1', text: 'keep' }],
        [{ key: 't2', text: 'drop' }],
      ]);
      reconciler.mount(rootEl, prev);
      expect(reconciler.getDom('p2')).not.toBeNull();
      expect(reconciler.getDom('t2')).not.toBeNull();

      const next = buildState([[{ key: 't1', text: 'keep' }]]);
      next.markDirty(next.rootKey);

      reconciler.update(rootEl, prev, next);

      expect(rootEl.children).toHaveLength(1);
      expect(rootEl.textContent).toBe('keep');
      // PR-2's keyToDom-leak fix: removed subtree's entries are gone.
      expect(reconciler.getDom('p2')).toBeNull();
      expect(reconciler.getDom('t2')).toBeNull();
    });

    it('tolerates a same-key type change without throwing', () => {
      const prev = buildState([[{ key: 't1', text: 'text' }]]);
      reconciler.mount(rootEl, prev);

      const next = buildState([[{ key: 't1', text: 'text' }]]);
      // Synthetic scenario: a key whose model type changed between states.
      // Not produced by any state.ts helper; documented as supported only
      // insofar as it must not crash.
      const paragraph = $createParagraphNode('t1');
      next.nodes.set('t1', paragraph);
      next.markDirty('t1');

      expect(() => reconciler.update(rootEl, prev, next)).not.toThrow();
    });
  });

  describe('update - locality', () => {
    it('does not call updateDOM on siblings of the dirty leaf', () => {
      const prev = buildState([
        [
          { key: 't1', text: 'first' },
          { key: 't2', text: 'second' },
        ],
      ]);
      reconciler.mount(rootEl, prev);
      expect(reconciler.getDom('t2')).not.toBeNull();

      const next = buildState([
        [
          { key: 't1', text: 'first-edited' },
          { key: 't2', text: 'second' },
        ],
      ]);
      next.markDirty('t1');

      const t2Spy = jest.spyOn(next.nodes.get('t2')!, 'updateDOM');
      const t1Spy = jest.spyOn(next.nodes.get('t1')!, 'updateDOM');

      reconciler.update(rootEl, prev, next);

      // t1 is intentionally dirty -> reconciler runs updateDOM on it.
      expect(t1Spy).toHaveBeenCalledTimes(1);
      // t2 was not dirty -> its updateDOM must not be touched.
      expect(t2Spy).not.toHaveBeenCalled();
    });
  });

  describe('keyForExactDomNode', () => {
    it('returns null for an exact foreign child inside a managed host', () => {
      const state = buildState([[{ key: 't1', text: 'hello' }]]);
      reconciler.mount(rootEl, state);
      const span = rootEl.children[0].children[0];
      const foreign = document.createElement('font');
      span.appendChild(foreign);

      expect(reconciler.keyForExactDomNode(foreign)).toBeNull();
      expect(reconciler.keyForDomNode(foreign)).toBe('t1');
    });

    it('returns the key for an exact registered host', () => {
      const state = buildState([[{ key: 't1', text: 'hello' }]]);
      reconciler.mount(rootEl, state);
      const span = rootEl.children[0].children[0];

      expect(reconciler.keyForExactDomNode(span)).toBe('t1');
      expect(reconciler.isManagedDomNode(span)).toBe(true);
      expect(reconciler.isManagedDomNode(document.createElement('div'))).toBe(false);
    });

    it('nearestManagedDomPair returns the host element for nested text', () => {
      const state = buildState([[{ key: 't1', text: 'hello' }]]);
      reconciler.mount(rootEl, state);
      const span = rootEl.children[0].children[0];
      const textNode = span.firstChild;
      expect(textNode?.nodeType).toBe(Node.TEXT_NODE);

      const pair = reconciler.nearestManagedDomPair(textNode);
      expect(pair).toEqual({ dom: span, key: 't1' });
    });
  });
});
