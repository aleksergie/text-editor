import { Editor } from '../core/editor';
import { SelectionListener } from '../core/selection';
import { SelectionSyncPlugin } from './selection-sync.plugin';

/**
 * End-to-end tests for the SelectionSyncPlugin. These exercise the plugin
 * against a real Editor mounted in jsdom, stubbing only the parts of
 * `window.getSelection()` that jsdom does not fully model (the actual
 * native selection object). `selectionchange` events are dispatched on the
 * real `document`, so the plugin's subscribe/unsubscribe path runs
 * unmodified.
 */

type StubbedSelection = Partial<Selection> & { rangeCount?: number };

function getInnermostText(container: HTMLElement): Text {
  const paragraph = container.firstElementChild as HTMLElement;
  const span = paragraph.firstElementChild as HTMLElement;
  let cursor: Node = span;
  while (cursor.firstChild && cursor.firstChild.nodeType === Node.ELEMENT_NODE) {
    cursor = cursor.firstChild;
  }
  return cursor.firstChild as Text;
}

describe('SelectionSyncPlugin', () => {
  let editor: Editor;
  let container: HTMLElement;
  let teardown: (() => void) | undefined;
  let originalGetSelection: () => Selection | null;
  let stubbed: StubbedSelection;

  beforeEach(() => {
    editor = new Editor();
    container = document.createElement('div');
    document.body.appendChild(container);
    editor.setRoot(container);
    editor.update((state) => state.setText('helloworld'));

    stubbed = { rangeCount: 0 };
    originalGetSelection = window.getSelection.bind(window);
    Object.defineProperty(window, 'getSelection', {
      value: () => stubbed as Selection,
      configurable: true,
      writable: true,
    });

    const result = SelectionSyncPlugin.setup(editor.getPluginContext());
    teardown = typeof result === 'function' ? result : undefined;
  });

  afterEach(() => {
    teardown?.();
    editor.setRoot(null);
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    Object.defineProperty(window, 'getSelection', {
      value: originalGetSelection,
      configurable: true,
      writable: true,
    });
  });

  function dispatchSelectionChange(selection: StubbedSelection): void {
    stubbed = selection;
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('forwards an in-root selection to editor.setSelection with source=user', () => {
    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);

    const textNode = getInnermostText(container);
    dispatchSelectionChange({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 2,
      focusNode: textNode,
      focusOffset: 7,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const [range, source] = listener.mock.calls[0];
    expect(source).toBe('user');
    expect(range?.anchor.offset).toBe(2);
    expect(range?.focus.offset).toBe(7);
    expect(range?.isCollapsed).toBe(false);
    expect(editor.getSelection()).toEqual(range);
  });

  it('clears the cached selection when anchorNode is outside the root', () => {
    // Seed an in-root selection first so there is something to clear.
    const textNode = getInnermostText(container);
    dispatchSelectionChange({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 1,
    });
    expect(editor.getSelection()).not.toBeNull();

    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);

    const foreign = document.createElement('span');
    foreign.textContent = 'outside';
    document.body.appendChild(foreign);
    const foreignText = foreign.firstChild as Text;
    try {
      dispatchSelectionChange({
        rangeCount: 1,
        anchorNode: foreignText,
        anchorOffset: 0,
        focusNode: foreignText,
        focusOffset: 1,
      });
    } finally {
      document.body.removeChild(foreign);
    }

    expect(editor.getSelection()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null, 'user');
  });

  it('does not re-fire null notifications when the selection is already null and stays outside the root', () => {
    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);

    // Selection has never been inside the editor; cached is already null.
    dispatchSelectionChange({ rangeCount: 0 });
    dispatchSelectionChange({ rangeCount: 0 });
    dispatchSelectionChange({ rangeCount: 0 });

    expect(editor.getSelection()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes from selectionchange when the plugin teardown runs', () => {
    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);
    teardown?.();
    teardown = undefined;

    const textNode = getInnermostText(container);
    dispatchSelectionChange({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 1,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('detaches from the old root and clears selection when the root unmounts', () => {
    const textNode = getInnermostText(container);
    dispatchSelectionChange({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 1,
    });
    expect(editor.getSelection()).not.toBeNull();

    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);

    editor.setRoot(null);

    expect(editor.getSelection()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe('programmatic');
  });

  it('re-attaches to a new root on setRoot swap (Angular HMR path)', () => {
    const listener = jest.fn<void, Parameters<SelectionListener>>();
    editor.registerSelectionListener(listener);

    // Swap to a brand new container.
    const swapped = document.createElement('div');
    document.body.appendChild(swapped);
    try {
      editor.setRoot(swapped);
      editor.update((state) => state.setText('swapped-text'));

      const newText = getInnermostText(swapped);
      dispatchSelectionChange({
        rangeCount: 1,
        anchorNode: newText,
        anchorOffset: 0,
        focusNode: newText,
        focusOffset: 3,
      });

      expect(editor.getSelection()?.anchor.offset).toBe(0);
      expect(editor.getSelection()?.focus.offset).toBe(3);
      expect(listener.mock.calls.at(-1)?.[1]).toBe('user');
    } finally {
      editor.setRoot(null);
      document.body.removeChild(swapped);
    }
  });

  it('multiple editors on the same page filter to their own root', () => {
    // First editor is already wired in beforeEach. Spin up a second.
    const editor2 = new Editor();
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    editor2.setRoot(container2);
    editor2.update((state) => state.setText('second-ed'));
    const teardown2 = SelectionSyncPlugin.setup(editor2.getPluginContext());

    try {
      const listener1 = jest.fn<void, Parameters<SelectionListener>>();
      const listener2 = jest.fn<void, Parameters<SelectionListener>>();
      editor.registerSelectionListener(listener1);
      editor2.registerSelectionListener(listener2);

      // Anchor is inside editor2's root only.
      const text2 = getInnermostText(container2);
      dispatchSelectionChange({
        rangeCount: 1,
        anchorNode: text2,
        anchorOffset: 0,
        focusNode: text2,
        focusOffset: 4,
      });

      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2.mock.calls[0][1]).toBe('user');
      expect(editor2.getSelection()?.focus.offset).toBe(4);

      // Editor 1 had no prior cache, so it should not fire a spurious
      // null notification when the selection is outside its root.
      expect(listener1).not.toHaveBeenCalled();
      expect(editor.getSelection()).toBeNull();
    } finally {
      if (typeof teardown2 === 'function') {
        teardown2();
      }
      editor2.setRoot(null);
      document.body.removeChild(container2);
    }
  });
});
