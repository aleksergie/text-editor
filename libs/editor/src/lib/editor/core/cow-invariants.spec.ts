import { createEditor } from './editor';
import { $clearActiveContext, $setActiveContext } from './active-context';
import { TextNode } from './nodes/text-node';
import { $createTextNode } from './nodes/node-utils';

describe('Copy-on-Write (COW) Invariants', () => {
  afterEach(() => $clearActiveContext());

  it('mutating next does not affect prev', () => {
    const editor = createEditor();
    const prev = editor.getEditorState();
    
    // Perform a mutation to create 'next'
    editor.update((state) => {
      state.setText('mutated text');
    });
    
    const next = editor.getEditorState();
    expect(prev).not.toBe(next);
    
    // Check prev text
    const prevText = prev.getTextNodesInDocumentOrder()[0];
    expect(prevText.getText()).toBe('');
    
    // Check next text
    const nextText = next.getTextNodesInDocumentOrder()[0];
    expect(nextText.getText()).toBe('mutated text');
    
    // Their nodes map instances should be different
    expect(prevText).not.toBe(nextText);
  });

  it('a key is cloned only once per transaction', () => {
    const editor = createEditor();
    
    editor.update((state) => {
      const textNode = state.getTextNodesInDocumentOrder()[0];
      
      const clone1 = textNode.getWritable();
      const clone2 = textNode.getWritable();
      
      // Should return the exact same instance for subsequent getWritable() calls in the same transaction
      expect(clone1).toBe(clone2);
    });
  });

  it('getWritable() outside an active context throws', () => {
    const node = $createTextNode('n1', 'hello');
    expect(() => node.getWritable()).toThrowError('getWritable: no active context');
  });

  it('getLatest() returns the cloned instance after a mutation', () => {
    const editor = createEditor();
    
    // Keep a reference to the initial text node
    const initialTextNode = editor.getEditorState().getTextNodesInDocumentOrder()[0];
    
    editor.update((state) => {
      const activeTextNode = state.getTextNodesInDocumentOrder()[0];
      activeTextNode.setText('updated');
      
      // getLatest on the initial node should now return the cloned instance
      const latest = initialTextNode.getLatest();
      expect(latest).not.toBe(initialTextNode);
      expect(latest).toBe(activeTextNode.getLatest());
      expect((latest as TextNode).getText()).toBe('updated');
    });
  });

  it('GenMap interop: mutating a clone does not affect the original state', () => {
    const editor = createEditor();
    const state = editor.getEditorState();
    
    const clone = state.clone();
    
    // Establish context for the clone to mutate it
    $setActiveContext(editor, clone);
    const textNode = clone.getTextNodesInDocumentOrder()[0];
    textNode.setText('new text');
    $clearActiveContext();
    
    // Original state should be unaffected
    const originalTextNode = state.getTextNodesInDocumentOrder()[0];
    expect(originalTextNode.getText()).toBe('');
    
    // Clone should have the new text
    const cloneTextNode = clone.getTextNodesInDocumentOrder()[0];
    expect(cloneTextNode.getText()).toBe('new text');
  });
});
