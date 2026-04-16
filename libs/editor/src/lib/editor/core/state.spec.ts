import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
} from './nodes/node-utils';
import { EditorState } from './state';

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
