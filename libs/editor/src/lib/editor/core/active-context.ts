import { Editor } from './editor';
import { EditorState } from './state';

let activeEditor: Editor | null = null;
let activeEditorState: EditorState | null = null;

export function $setActiveContext(editor: Editor, state: EditorState): void {
  activeEditor = editor;
  activeEditorState = state;
}

export function $clearActiveContext(): void {
  activeEditor = null;
  activeEditorState = null;
}

export function $getActiveEditor(): Editor | null {
  return activeEditor;
}

export function $getActiveEditorState(): EditorState | null {
  return activeEditorState;
}
