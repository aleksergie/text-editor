import { createEditor } from './editor';
import { flushMutations } from './dom-mutations';

describe('dom-mutations (Phase 2)', () => {
  it('handles characterData mutation when DOM text differs', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    // Baseline state is root > p1 > t1
    // Insert some text
    editor.update((state) => {
      state.setText('Hello');
    });

    const t1Dom = editor.getDomForKey('t1');
    expect(t1Dom).not.toBeNull();
    const textNode = t1Dom!.firstChild as Text;
    
    // Spell-check style: change nodeValue directly
    textNode.nodeValue = 'Hello world';
    
    const records = [{
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord];
    
    flushMutations(editor, records);
    
    expect(editor.getEditorState().getText()).toBe('Hello world');
  });

  it('is a no-op when DOM text matches model text', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const updateSpy = jest.spyOn(editor, 'update');

    const t1Dom = editor.getDomForKey('t1');
    const textNode = t1Dom!.firstChild as Text;
    
    const records = [{
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord];
    
    flushMutations(editor, records);
    
    expect(updateSpy).not.toHaveBeenCalled();
    expect(editor.getEditorState().getText()).toBe('Hello');
  });

  it('is a no-op when mutated DOM is outside registered host', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const updateSpy = jest.spyOn(editor, 'update');

    // Create a node outside the editor entirely
    const outsideDiv = document.createElement('div');
    outsideDiv.textContent = 'Outside';
    const textNode = outsideDiv.firstChild as Text;
    
    const records = [{
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord];
    
    flushMutations(editor, records);
    
    expect(updateSpy).not.toHaveBeenCalled();
    expect(editor.getEditorState().getText()).toBe('Hello');
  });

  it('batches multiple mutations on the same node into a single update call', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const updateSpy = jest.spyOn(editor, 'update');

    const t1Dom = editor.getDomForKey('t1');
    const textNode = t1Dom!.firstChild as Text;
    
    textNode.nodeValue = 'Hello world 1';
    
    const record1 = {
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord;
    
    // Simulating multiple mutations happening back-to-back before flush
    textNode.nodeValue = 'Hello world 2';
    
    const record2 = {
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord;
    
    flushMutations(editor, [record1, record2]);
    
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(editor.getEditorState().getText()).toBe('Hello world 2');
  });
});
