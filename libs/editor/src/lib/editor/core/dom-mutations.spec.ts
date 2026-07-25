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

describe('dom-mutations (Phase 3: ChildList Defense)', () => {
  it('removes unknown elements injected by an extension outside a text host', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const p1Dom = editor.getDomForKey('p1');
    const foreignDiv = document.createElement('div');
    p1Dom!.appendChild(foreignDiv);
    
    const records = [{
      type: 'childList',
      target: p1Dom,
      addedNodes: [foreignDiv],
      removedNodes: []
    } as unknown as MutationRecord];
    
    const drainSpy = jest.spyOn(editor, 'drainObserverRecords');
    flushMutations(editor, records);
    
    expect(foreignDiv.parentNode).toBeNull();
    expect(drainSpy).toHaveBeenCalled();
  });

  it('removes an injected <br> at the end of a paragraph (autocorrect)', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const p1Dom = editor.getDomForKey('p1');
    const br = document.createElement('br');
    p1Dom!.appendChild(br);
    
    const records = [{
      type: 'childList',
      target: p1Dom,
      addedNodes: [br],
      removedNodes: []
    } as unknown as MutationRecord];
    
    flushMutations(editor, records);
    expect(br.parentNode).toBeNull();
  });

  it('removes a foreign element injected inside a managed text host', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const t1Dom = editor.getDomForKey('t1');
    const font = document.createElement('font');
    t1Dom!.appendChild(font);
    
    const records = [{
      type: 'childList',
      target: t1Dom,
      addedNodes: [font],
      removedNodes: []
    } as unknown as MutationRecord];
    
    flushMutations(editor, records);
    expect(font.parentNode).toBeNull();
  });

  it('triggers a full re-render when a registered node is removed', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const p1Dom = editor.getDomForKey('p1');
    const t1Dom = editor.getDomForKey('t1');
    
    p1Dom!.removeChild(t1Dom!);
    
    const records = [{
      type: 'childList',
      target: p1Dom,
      addedNodes: [],
      removedNodes: [t1Dom]
    } as unknown as MutationRecord];
    
    const reconcileSpy = jest.spyOn(editor, 'reconcileFromScratch');
    flushMutations(editor, records);
    
    expect(reconcileSpy).toHaveBeenCalled();
    // The DOM should be restored (Note: full re-render creates new DOM elements)
    const newP1Dom = editor.getDomForKey('p1');
    expect(newP1Dom!.contains(editor.getDomForKey('t1'))).toBe(true);
  });

  it('handles removed node when parentNode is already null', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const p1Dom = editor.getDomForKey('p1');
    const t1Dom = editor.getDomForKey('t1');
    
    p1Dom!.removeChild(t1Dom!);
    // t1Dom.parentNode is now null
    
    const records = [{
      type: 'childList',
      target: p1Dom, // target is the parent where it was removed from
      addedNodes: [],
      removedNodes: [t1Dom]
    } as unknown as MutationRecord];
    
    const reconcileSpy = jest.spyOn(editor, 'reconcileFromScratch');
    flushMutations(editor, records);
    
    expect(reconcileSpy).toHaveBeenCalled();
  });

  it('handles a mixed batch of characterData and childList', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    editor.setRoot(root);
    
    editor.update((state) => {
      state.setText('Hello');
    });

    const p1Dom = editor.getDomForKey('p1');
    const t1Dom = editor.getDomForKey('t1');
    const textNode = t1Dom!.firstChild as Text;
    
    textNode.nodeValue = 'Hello world';
    const br = document.createElement('br');
    p1Dom!.appendChild(br);
    
    const charRecord = {
      type: 'characterData',
      target: textNode,
    } as unknown as MutationRecord;

    const childRecord = {
      type: 'childList',
      target: p1Dom,
      addedNodes: [br],
      removedNodes: []
    } as unknown as MutationRecord;
    
    const updateSpy = jest.spyOn(editor, 'update');
    
    flushMutations(editor, [charRecord, childRecord]);
    
    expect(updateSpy).toHaveBeenCalled();
    expect(editor.getEditorState().getText()).toBe('Hello world');
    expect(br.parentNode).toBeNull();
  });
});

