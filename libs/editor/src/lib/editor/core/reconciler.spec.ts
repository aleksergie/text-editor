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

  describe('update - structural fallback', () => {
    it('falls back to full re-render when node order changes', () => {
      const prev = buildState([[{ key: 't1', text: 'one' }]]);
      reconciler.mount(rootEl, prev);
      const paragraphBefore = rootEl.children[0];

      const next = buildState([
        [{ key: 't1', text: 'one' }],
        [{ key: 't2', text: 'two' }],
      ]);

      reconciler.update(rootEl, prev, next);

      expect(rootEl.children).toHaveLength(2);
      expect(rootEl.children[0]).not.toBe(paragraphBefore);
      expect(rootEl.children[0].textContent).toBe('one');
      expect(rootEl.children[1].textContent).toBe('two');
    });

    it('falls back to full re-render when a node type changes at the same key', () => {
      const prev = buildState([[{ key: 't1', text: 'text' }]]);
      reconciler.mount(rootEl, prev);

      const next = buildState([[{ key: 't1', text: 'text' }]]);
      // Simulate a key whose type changed between states.
      const paragraph = $createParagraphNode('t1');
      next.nodes.set('t1', paragraph);
      next.markDirty('t1');

      expect(() => reconciler.update(rootEl, prev, next)).not.toThrow();
    });
  });
});
