import {
  BEFORE_INPUT_COMMAND,
  CommandPriority,
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from './commands';
import type { Editor } from './editor';
import { resolveDomSelection, TextRange } from './selection';

export function registerInputCommandHandlers(editor: Editor): void {
  editor.registerCommand(
    BEFORE_INPUT_COMMAND,
    (event) => {
      const range = resolveInputSelection(editor);
      switch (event.inputType) {
        case 'insertText': {
          const text = event.data ?? '';
          if (text.length === 0) {
            return false;
          }
          event.preventDefault();
          return editor.dispatchCommand(INSERT_TEXT, { text, range });
        }
        case 'deleteContentBackward':
          event.preventDefault();
          return editor.dispatchCommand(DELETE_CHARACTER, {
            isBackward: true,
            range,
          });
        case 'deleteContentForward':
          event.preventDefault();
          return editor.dispatchCommand(DELETE_CHARACTER, {
            isBackward: false,
            range,
          });
        case 'insertParagraph':
          event.preventDefault();
          return editor.dispatchCommand(INSERT_PARAGRAPH, { range });
        default:
          return false;
      }
    },
    CommandPriority.Editor,
  );
}

export function bindEditorEvents(editor: Editor, root: HTMLElement): () => void {
  let isComposing = false;

  const onBeforeInput = (event: InputEvent) => {
    if (isComposing || event.isComposing) {
      return;
    }
    editor.dispatchCommand(BEFORE_INPUT_COMMAND, event);
  };

  const onCompositionStart = () => {
    isComposing = true;
  };

  const onCompositionEnd = () => {
    isComposing = false;
    resyncFromDom(editor, root);
  };

  const onInput = () => {
    if (isComposing) {
      return;
    }
    resyncFromDom(editor, root);
  };

  root.addEventListener('beforeinput', onBeforeInput);
  root.addEventListener('compositionstart', onCompositionStart);
  root.addEventListener('compositionend', onCompositionEnd);
  root.addEventListener('input', onInput);

  return () => {
    root.removeEventListener('beforeinput', onBeforeInput);
    root.removeEventListener('compositionstart', onCompositionStart);
    root.removeEventListener('compositionend', onCompositionEnd);
    root.removeEventListener('input', onInput);
  };
}

function resolveInputSelection(editor: Editor): TextRange | null {
  const root = editor.getRootElement();
  if (!root) {
    return editor.getSelection();
  }
  const win = root.ownerDocument?.defaultView;
  if (!win) {
    return editor.getSelection();
  }
  const selection = win.getSelection?.();
  const anchor = selection?.anchorNode ?? null;
  const focus = selection?.focusNode ?? null;
  if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
    return editor.getSelection();
  }
  return resolveDomSelection(editor, win) ?? editor.getSelection();
}

function resyncFromDom(editor: Editor, root: HTMLElement): void {
  const domText = root.innerText ?? '';
  const modelText = editor.read((state) => state.getText());
  if (domText === modelText) {
    return;
  }
  editor.dispatchCommand(SET_TEXT_CONTENT, domText);
}
