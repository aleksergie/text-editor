import {
  BEFORE_INPUT_COMMAND,
  CommandPriority,
  DELETE_CHARACTER,
  SET_TEXT_CONTENT,
} from './commands';
import { bindEditorEvents } from './editor-events';
import { createEditor, Editor } from './editor';

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
    expect(payloads).toEqual([{ isBackward: true }]);
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
    expect(payloads).toEqual([{ isBackward: false }]);
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

  it('places the caret at the end after a bridge-originated mutation', () => {
    const { root } = mountEditor();

    root.dispatchEvent(createBeforeInput('insertText', { data: 'a' }));

    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    const range = selection?.getRangeAt(0);
    expect(range?.collapsed).toBe(true);
    expect(range?.endContainer).toBe(root);
    expect(range?.endOffset).toBe(root.childNodes.length);
  });

  it('does not move the caret after an unhandled beforeinput followed by an unrelated update', () => {
    const { editor, root } = mountEditor();
    const getSelection = jest.spyOn(window, 'getSelection');

    root.dispatchEvent(createBeforeInput('insertFromPaste', { data: 'x' }));
    editor.dispatchCommand(SET_TEXT_CONTENT, 'programmatic');

    expect(getSelection).not.toHaveBeenCalled();
  });

  it('uses the root owner document when placing the caret', () => {
    const editor = createEditor();
    const beforeInputListeners: Array<(event: InputEvent) => void> = [];
    const selection = {
      removeAllRanges: jest.fn(),
      addRange: jest.fn(),
    };
    const range = {
      selectNodeContents: jest.fn(),
      collapse: jest.fn(),
    };
    const ownerDocument = {
      defaultView: { getSelection: jest.fn(() => selection) },
      createRange: jest.fn(() => range),
    };
    const root = {
      ownerDocument,
      innerText: '',
      addEventListener: jest.fn((type: string, listener: (event: InputEvent) => void) => {
        if (type === 'beforeinput') {
          beforeInputListeners.push(listener);
        }
      }),
      removeEventListener: jest.fn(),
    } as unknown as HTMLElement;
    const teardown = bindEditorEvents(editor, root);

    beforeInputListeners[0](createBeforeInput('insertText', { data: 'a' }));

    expect(ownerDocument.defaultView.getSelection).toHaveBeenCalled();
    expect(ownerDocument.createRange).toHaveBeenCalled();
    expect(range.selectNodeContents).toHaveBeenCalledWith(root);
    expect(selection.addRange).toHaveBeenCalledWith(range);

    teardown();
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
});
