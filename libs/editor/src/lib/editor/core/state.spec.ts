import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
} from './nodes/node-utils';
import {
  EditorState,
  HAS_DIRTY_NODES,
  NO_DIRTY_NODES,
} from './state';

describe('EditorState', () => {
  describe('createEmpty', () => {
    it('produces the v1 baseline: root > paragraph > empty text', () => {
      const state = EditorState.createEmpty();

      const root = state.nodes.get(state.rootKey);
      expect(root).toBeDefined();
      expect($isElementNode(root)).toBe(true);

      expect(state.nodes.size).toBe(3);
      expect(state.getText()).toBe('');
    });
  });

  describe('clone', () => {
    it('produces a separate nodes map and empty dirty set', () => {
      const state = EditorState.createEmpty();
      state.setText('dirty me');

      const clone = state.clone();

      expect(clone).not.toBe(state);
      expect(clone.nodes).not.toBe(state.nodes);
      expect(clone.getDirtyNodeKeys().size).toBe(0);
    });
  });

  describe('setText', () => {
    it('marks the affected text node dirty', () => {
      const state = EditorState.createEmpty();
      expect(state.getDirtyNodeKeys().size).toBe(0);

      state.setText('hello');

      expect(state.getDirtyNodeKeys().size).toBe(1);
      expect(state.getText()).toBe('hello');
    });

    it('does not mark dirty when the text is unchanged', () => {
      const state = EditorState.createEmpty();
      state.setText('same');
      state.clearDirtyNodeKeys();

      state.setText('same');

      expect(state.getDirtyNodeKeys().size).toBe(0);
    });
  });

  describe('dirty tracking lifecycle', () => {
    it('clearDirtyNodeKeys empties the dirty set', () => {
      const state = EditorState.createEmpty();
      state.setText('a');
      expect(state.getDirtyNodeKeys().size).toBe(1);

      state.clearDirtyNodeKeys();

      expect(state.getDirtyNodeKeys().size).toBe(0);
    });

    it('dirtyType is NO_DIRTY_NODES on a fresh state and after clear', () => {
      const state = EditorState.createEmpty();
      expect(state.getDirtyType()).toBe(NO_DIRTY_NODES);

      state.setText('a');
      expect(state.getDirtyType()).toBe(HAS_DIRTY_NODES);

      state.clearDirtyNodeKeys();
      expect(state.getDirtyType()).toBe(NO_DIRTY_NODES);
    });

    it('marking a leaf bubbles dirt up to ancestor elements as false', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      state.markDirty('t1');

      // Leaf entered dirtyLeaves intentionally.
      expect(state.getDirtyLeaves().has('t1')).toBe(true);

      // Ancestors entered dirtyElements as bubble (false).
      const elements = state.getDirtyElements();
      expect(elements.get('p1')).toBe(false);
      expect(elements.get(state.rootKey)).toBe(false);

      // Public payload excludes bubble entries.
      const intentional = state.getDirtyNodeKeys();
      expect(intentional.has('t1')).toBe(true);
      expect(intentional.has('p1')).toBe(false);
      expect(intentional.has(state.rootKey)).toBe(false);
    });

    it('marking an element directly sets its dirtyElements entry to true', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      state.markDirty('p1');

      expect(state.getDirtyElements().get('p1')).toBe(true);
      // Root is the only ancestor; it sits as a bubble entry.
      expect(state.getDirtyElements().get(state.rootKey)).toBe(false);
      // Intentional payload includes p1 but not the bubble root.
      const intentional = state.getDirtyNodeKeys();
      expect(intentional.has('p1')).toBe(true);
      expect(intentional.has(state.rootKey)).toBe(false);
    });

    it('an intentional mark after a bubble mark does not downgrade the entry', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      state.markDirty('t1');                              // bubble p1 with false
      expect(state.getDirtyElements().get('p1')).toBe(false);

      state.markDirty('p1');                              // upgrade p1 to true
      expect(state.getDirtyElements().get('p1')).toBe(true);
      // Public payload now includes p1 as intentional.
      expect(state.getDirtyNodeKeys().has('p1')).toBe(true);
    });

    it('marking the same leaf twice is idempotent', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      state.markDirty('t1');
      const sizeAfterFirst = state.getDirtyElements().size;

      state.markDirty('t1');

      // No new ancestor entries added on the second call (stop-early bubble).
      expect(state.getDirtyElements().size).toBe(sizeAfterFirst);
      expect(state.getDirtyLeaves().size).toBe(1);
    });

    it('marking an unknown key is a no-op', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      state.markDirty('does-not-exist');

      expect(state.getDirtyType()).toBe(NO_DIRTY_NODES);
      expect(state.getDirtyLeaves().size).toBe(0);
      expect(state.getDirtyElements().size).toBe(0);
    });
  });

  describe('structural helpers', () => {
    it('insertAfter registers the node, links it, and marks the parent dirty', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      const firstParagraph = state.nodes.get('p1');
      expect(firstParagraph).toBeDefined();
      const secondParagraph = $createParagraphNode('p2');
      const newText = $createTextNode('t2', 'second');
      secondParagraph.append(state.nodes, newText);

      state.insertAfter(firstParagraph!, secondParagraph);
      state.registerNode(newText);

      expect(state.nodes.get('p2')).toBe(secondParagraph);
      expect(state.getDirtyNodeKeys().has(state.rootKey)).toBe(true);
    });

    it('remove deletes the node from the map and marks the parent dirty', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      const textNode = state.nodes.get('t1');
      expect(textNode).toBeDefined();

      state.remove(textNode!);

      expect(state.nodes.has('t1')).toBe(false);
      expect(state.getDirtyNodeKeys().has('p1')).toBe(true);
    });

    it('replace swaps the node under the parent and marks the parent dirty', () => {
      const state = EditorState.createEmpty();
      state.clearDirtyNodeKeys();

      const original = state.nodes.get('t1');
      const replacement = $createTextNode('t-new', 'replacement');

      state.replace(original!, replacement);

      expect(state.nodes.has('t1')).toBe(false);
      expect(state.nodes.get('t-new')).toBe(replacement);
      expect(state.getDirtyNodeKeys().has('p1')).toBe(true);
      expect(state.getText()).toBe('replacement');
    });
  });

  describe('getLastParagraph / getLastTextNode', () => {
    it('returns the last paragraph and its last text node', () => {
      const state = EditorState.createEmpty();
      expect(state.getLastParagraph()?.key).toBe('p1');
      expect(state.getLastTextNode()?.key).toBe('t1');

      const p2 = $createParagraphNode('p2');
      const t2 = $createTextNode('t2', 'two');
      p2.append(state.nodes, t2);
      state.registerNode(t2);
      state.insertAfter(state.nodes.get('p1')!, p2);

      expect(state.getLastParagraph()?.key).toBe('p2');
      expect(state.getLastTextNode()?.key).toBe('t2');
    });
  });
});
