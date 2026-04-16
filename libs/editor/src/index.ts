export * from './lib/editor/feature/components/editor.component';

export { EditorRuntimeService } from './lib/editor/angular/editor-runtime.service';
export { EDITOR_PLUGINS, providePlugin } from './lib/editor/angular/editor-plugins.token';

export { Editor } from './lib/editor/core/editor';
export type { UpdateListener, UpdateListenerPayload } from './lib/editor/core/editor';
export { EditorState } from './lib/editor/core/state';
export type { EditorPlugin, EditorPluginContext } from './lib/editor/core/plugin';

export {
  SNAPSHOT_VERSION,
  InvalidSnapshotError,
} from './lib/editor/core/snapshot';
export type {
  EditorStateSnapshot,
  SerializedNode,
  SerializedRootNode,
  SerializedParagraphNode,
  SerializedTextNode,
} from './lib/editor/core/snapshot';

export { toPlainText, fromPlainText } from './lib/editor/core/plain-text';

export {
  APPLY_EDITOR_STATE,
  CLEAR_EDITOR,
  CommandPriority,
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
  createCommand,
} from './lib/editor/core/commands';
export type {
  CommandHandler,
  CommandPayloadType,
  EditorCommand,
} from './lib/editor/core/commands';
