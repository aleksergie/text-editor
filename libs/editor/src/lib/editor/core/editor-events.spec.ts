import {
  BEFORE_INPUT_COMMAND,
  CommandPriority,
  DELETE_CHARACTER,
  SET_TEXT_CONTENT,
} from './commands';
import { bindEditorEvents } from './editor-events';
import { createEditor, Editor } from './editor';
import { createTextRange } from './selection';

function createBeforeInput(
  inputType: string,
  init: Partial<{ data: string; isComposing: boolean }> = {},
): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: init.data ?? null,
    isComposing: init.isComposing ?? false,
  });
}

function getRenderedTextNode(root: HTMLElement): Text {
  const text = root.querySelector('span')?.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) {
    throw new Error('expected rendered text node');
  }
  return text as Text;
}

function setCollapsedDomSelection(textNode: Text, offset: number): void {
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function mountEditor(): { editor: Editor; root: HTMLElement } {
  const editor = createEditor();
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRoot(root);
  return { editor, root };
}

describe('editor input events', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('routes insertText through BEFORE_INPUT_COMMAND and prevents default', () => {
    const { editor, root } = mountEditor();
    const beforeInputEvents: InputEvent[] = [];
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      (event) => {
        beforeInputEvents.push(event);
        return false;
      },
      CommandPriority.High,
    );

    const event = createBeforeInput('insertText', { data: 'a' });
    root.dispatchEvent(event);

    expect(beforeInputEvents).toEqual([event]);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.read((state) => state.getText())).toBe('a');
  });

  it('routes deleteContentBackward to DELETE_CHARACTER with isBackward true', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('hello'));
    const payloads: Array<{ isBackward: boolean }> = [];
    editor.registerCommand(
      DELETE_CHARACTER,
      (payload) => {
        payloads.push(payload);
        return false;
      },
      CommandPriority.Normal,
    );

    const event = createBeforeInput('deleteContentBackward');
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(payloads).toEqual([{ isBackward: true, range: null }]);
    expect(editor.read((state) => state.getText())).toBe('hell');
  });

  it('routes deleteContentForward to DELETE_CHARACTER with isBackward false', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('hello'));
    const payloads: Array<{ isBackward: boolean }> = [];
    editor.registerCommand(
      DELETE_CHARACTER,
      (payload) => {
        payloads.push(payload);
        return false;
      },
      CommandPriority.Normal,
    );

    const event = createBeforeInput('deleteContentForward');
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(payloads).toEqual([{ isBackward: false, range: null }]);
    expect(editor.read((state) => state.getText())).toBe('ello');
  });

  it('routes insertParagraph through the default beforeinput handler', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('first'));

    const event = createBeforeInput('insertParagraph');
    root.dispatchEvent(event);
    root.dispatchEvent(createBeforeInput('insertText', { data: 'second' }));

    expect(event.defaultPrevented).toBe(true);
    expect(editor.read((state) => state.getText())).toBe('firstsecond');
  });

  it('dispatches unsupported beforeinput events without preventing default or mutating', () => {
    const { editor, root } = mountEditor();
    const beforeInputEvents: InputEvent[] = [];
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      (event) => {
        beforeInputEvents.push(event);
        return false;
      },
      CommandPriority.High,
    );

    const event = createBeforeInput('insertFromPaste', { data: 'x' });
    root.dispatchEvent(event);

    expect(beforeInputEvents).toEqual([event]);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.read((state) => state.getText())).toBe('');
  });

  it('lets higher-priority BEFORE_INPUT_COMMAND handlers intercept routing', () => {
    const { editor, root } = mountEditor();
    editor.registerCommand(
      BEFORE_INPUT_COMMAND,
      (event) => {
        event.preventDefault();
        editor.dispatchCommand(SET_TEXT_CONTENT, 'intercepted');
        return true;
      },
      CommandPriority.High,
    );

    const event = createBeforeInput('insertText', { data: 'a' });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.read((state) => state.getText())).toBe('intercepted');
  });

  it('blocks beforeinput during composition and resyncs from DOM on compositionend', () => {
    const { editor, root } = mountEditor();

    root.dispatchEvent(new Event('compositionstart'));
    const event = createBeforeInput('insertText', { data: 'x', isComposing: true });
    root.dispatchEvent(event);
    root.innerText = 'composed';
    root.dispatchEvent(new Event('compositionend'));

    expect(event.defaultPrevented).toBe(false);
    expect(editor.read((state) => state.getText())).toBe('composed');
  });

  it('resyncs from DOM on input when browser default behavior already mutated DOM', () => {
    const { editor, root } = mountEditor();

    root.innerText = 'browser text';
    root.dispatchEvent(new Event('input'));

    expect(editor.read((state) => state.getText())).toBe('browser text');
  });

  it('writes the caret after inserted text from the committed model selection', () => {
    const { root } = mountEditor();
    const textNode = getRenderedTextNode(root);
    setCollapsedDomSelection(textNode, 0);

    root.dispatchEvent(createBeforeInput('insertText', { data: 'a' }));

    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.anchorNode).toBe(textNode);
    expect(selection?.anchorOffset).toBe(1);
  });

  it('inserts in the middle of a text node and keeps the caret after the inserted text', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('abcdef'));
    const textNode = getRenderedTextNode(root);
    setCollapsedDomSelection(textNode, 3);

    root.dispatchEvent(createBeforeInput('insertText', { data: 'X' }));

    expect(editor.read((state) => state.getText())).toBe('abcXdef');
    expect(editor.getSelection()?.anchor.offset).toBe(4);
    expect(window.getSelection()?.anchorOffset).toBe(4);
  });

  it('replaces an expanded range and collapses after the replacement', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('hello world'));
    const textNode = getRenderedTextNode(root);
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    root.dispatchEvent(createBeforeInput('insertText', { data: 'there' }));

    expect(editor.read((state) => state.getText())).toBe('hello there');
    expect(editor.getSelection()?.anchor.offset).toBe(11);
  });

  it('does not write DOM selection after programmatic SET_TEXT_CONTENT', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('hello'));
    const textNode = getRenderedTextNode(root);
    const cachedRange = createTextRange(
      { key: 't1', offset: 2 },
      { key: 't1', offset: 2 },
      false,
    );
    editor.setSelection(cachedRange);
    setCollapsedDomSelection(textNode, 2);
    const getSelection = jest.spyOn(window, 'getSelection');

    editor.dispatchCommand(SET_TEXT_CONTENT, 'changed');

    expect(getSelection).not.toHaveBeenCalled();
    expect(editor.getSelection()?.anchor.offset).toBe(2);
  });

  it('uses the root owner document when writing DOM selection', () => {
    const { root } = mountEditor();
    const textNode = getRenderedTextNode(root);
    setCollapsedDomSelection(textNode, 0);
    const ownerDocument = root.ownerDocument;
    const getSelection = jest.spyOn(ownerDocument.defaultView!, 'getSelection');

    root.dispatchEvent(createBeforeInput('insertText', { data: 'a' }));

    expect(getSelection).toHaveBeenCalled();
  });

  it('removes listeners on setRoot(null)', () => {
    const { editor, root } = mountEditor();

    editor.setRoot(null);
    const event = createBeforeInput('insertText', { data: 'a' });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(editor.read((state) => state.getText())).toBe('');
  });

  it('reattaches listeners when the root is swapped', () => {
    const { editor, root } = mountEditor();
    const nextRoot = document.createElement('div');
    document.body.appendChild(nextRoot);

    editor.setRoot(nextRoot);

    root.dispatchEvent(createBeforeInput('insertText', { data: 'old' }));
    nextRoot.dispatchEvent(createBeforeInput('insertText', { data: 'new' }));

    expect(editor.read((state) => state.getText())).toBe('new');
  });

  it('ignores native selection outside the current root during input routing', () => {
    const { editor, root } = mountEditor();
    editor.update((state) => state.setText('abcdef'));
    const staleTextNode = getRenderedTextNode(root);

    const nextRoot = document.createElement('div');
    document.body.appendChild(nextRoot);
    editor.setRoot(nextRoot);
    setCollapsedDomSelection(staleTextNode, 1);

    nextRoot.dispatchEvent(createBeforeInput('insertText', { data: 'X' }));

    expect(editor.read((state) => state.getText())).toBe('abcdefX');
  });
});
