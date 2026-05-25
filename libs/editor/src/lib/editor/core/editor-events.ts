import {
  BEFORE_INPUT_COMMAND,
  CommandPriority,
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from './commands';
import type { Editor } from './editor';

export function registerInputCommandHandlers(editor: Editor): void {
  editor.registerCommand(
    BEFORE_INPUT_COMMAND,
    (event) => {
      switch (event.inputType) {
        case 'insertText': {
          const text = event.data ?? '';
          if (text.length === 0) {
            return false;
          }
          event.preventDefault();
          return editor.dispatchCommand(INSERT_TEXT, { text });
        }
        case 'deleteContentBackward':
          event.preventDefault();
          return editor.dispatchCommand(DELETE_CHARACTER, { isBackward: true });
        case 'deleteContentForward':
          event.preventDefault();
          return editor.dispatchCommand(DELETE_CHARACTER, { isBackward: false });
        case 'insertParagraph':
          event.preventDefault();
          return editor.dispatchCommand(INSERT_PARAGRAPH, undefined);
        default:
          return false;
      }
    },
    CommandPriority.Editor,
  );
}

export function bindEditorEvents(editor: Editor, root: HTMLElement): () => void {
  let isComposing = false;
  let lastChangeFromBridge = false;

  const onBeforeInput = (event: InputEvent) => {
    if (isComposing || event.isComposing) {
      return;
    }

    lastChangeFromBridge = true;
    if (!editor.dispatchCommand(BEFORE_INPUT_COMMAND, event)) {
      lastChangeFromBridge = false;
    }
  };

  const onCompositionStart = () => {
    isComposing = true;
  };

  const onCompositionEnd = () => {
    isComposing = false;
    lastChangeFromBridge = true;
    if (!resyncFromDom(editor, root)) {
      lastChangeFromBridge = false;
    }
  };

  const onInput = () => {
    if (isComposing) {
      return;
    }
    lastChangeFromBridge = true;
    if (!resyncFromDom(editor, root)) {
      lastChangeFromBridge = false;
    }
  };

  const unregisterUpdateListener = editor.registerUpdateListener(() => {
    if (!lastChangeFromBridge) {
      return;
    }
    lastChangeFromBridge = false;
    placeCursorAtEnd(root);
  });

  root.addEventListener('beforeinput', onBeforeInput);
  root.addEventListener('compositionstart', onCompositionStart);
  root.addEventListener('compositionend', onCompositionEnd);
  root.addEventListener('input', onInput);

  return () => {
    root.removeEventListener('beforeinput', onBeforeInput);
    root.removeEventListener('compositionstart', onCompositionStart);
    root.removeEventListener('compositionend', onCompositionEnd);
    root.removeEventListener('input', onInput);
    unregisterUpdateListener();
  };
}

function resyncFromDom(editor: Editor, root: HTMLElement): boolean {
  const domText = root.innerText ?? '';
  const modelText = editor.read((state) => state.getText());
  if (domText === modelText) {
    return false;
  }
  return editor.dispatchCommand(SET_TEXT_CONTENT, domText);
}

function placeCursorAtEnd(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection() ?? null;
  if (!selection) {
    return;
  }
  // V1 plain-text caret recovery. Selection-aware input commands should
  // replace this with model-to-DOM selection sync.
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
