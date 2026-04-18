export * from './lib/editor/feature/components/editor.component';
export { FormattingToolbarComponent } from './lib/editor/ui/components/formatting-toolbar/formatting-toolbar.component';
export { ContentEditableDirective } from './lib/editor/ui/directives/content-editable/content-editable.directive';

export { EditorRuntimeService } from './lib/editor/angular/editor-runtime.service';
export { EDITOR_PLUGINS, providePlugin } from './lib/editor/angular/editor-plugins.token';

export { provideFormattingKeyboardPlugin } from './lib/editor/plugins';

export { Editor } from './lib/editor/core/editor';
export type {
  RootElementListener,
  UpdateListener,
  UpdateListenerPayload,
} from './lib/editor/core/editor';
export { EditorState } from './lib/editor/core/state';
export type { EditorPlugin, EditorPluginContext } from './lib/editor/core/plugin';

export {
  TextFormat,
  applyFormat,
  hasFormat,
  removeFormat,
  toggleFormat,
} from './lib/editor/core/text-format';
export type {
  TextFormatBits,
  TextFormatFlag,
} from './lib/editor/core/text-format';

export {
  createTextRange,
  getRangeStartEnd,
  resolveDomSelection,
} from './lib/editor/core/selection';
export type {
  SelectionResolverHost,
  TextPoint,
  TextRange,
} from './lib/editor/core/selection';

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
  FORMAT_TEXT,
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
