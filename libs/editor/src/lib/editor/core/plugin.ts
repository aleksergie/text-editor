import {
  CommandHandler,
  CommandPayloadType,
  CommandPriority,
  EditorCommand,
} from './commands';
import { RootElementListener, UpdateListener } from './editor';
import { NodeKey } from './nodes/node';
import { EditorState } from './state';

/**
 * Safe subset of the editor runtime exposed to plugins. Intentionally omits
 * private internals (the state field, the reconciler, handler storage, the
 * root element, etc.) so that plugins can compose behavior without reaching
 * into editor internals.
 */
export interface EditorPluginContext {
  registerCommand<TCommand extends EditorCommand<unknown>>(
    command: TCommand,
    handler: CommandHandler<CommandPayloadType<TCommand>>,
    priority: CommandPriority,
  ): () => void;
  registerUpdateListener(listener: UpdateListener): () => void;
  registerRootElementListener(listener: RootElementListener): () => void;
  dispatchCommand<TCommand extends EditorCommand<unknown>>(
    command: TCommand,
    payload: CommandPayloadType<TCommand>,
  ): boolean;
  read<T>(fn: (state: EditorState) => T): T;
  update(fn: (state: EditorState) => void): void;
  getEditorState(): EditorState;
  setEditorState(state: EditorState): void;
  /**
   * DOM <-> model lookup helpers. `keyForDomNode` returns the NodeKey of the
   * nearest model-mapped ancestor of `node` (walking up through formatting
   * wrappers), and `getDomForKey` returns the currently rendered host element
   * for a NodeKey, or `null` if it is not mounted.
   */
  keyForDomNode(node: Node | null): NodeKey | null;
  getDomForKey(key: NodeKey): HTMLElement | null;
}

/**
 * Plugin contract. Plugins receive a context on `setup` and may return an
 * optional cleanup function, which the runtime will call on teardown. Plugins
 * can also implement `destroy` for cleanup that is independent of `setup`'s
 * return value.
 */
export interface EditorPlugin {
  readonly key: string;
  setup(context: EditorPluginContext): void | (() => void);
  destroy?(): void;
}
