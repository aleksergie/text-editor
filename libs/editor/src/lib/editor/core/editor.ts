import {
  APPLY_EDITOR_STATE,
  CLEAR_EDITOR,
  CommandHandler,
  CommandPayloadType,
  CommandPriority,
  DELETE_CHARACTER,
  EditorCommand,
  FORMAT_TEXT,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from './commands';
import { NodeKey } from './nodes/node';
import { EditorPluginContext } from './plugin';
import { Reconciler } from './reconciler';
import { EditorState } from './state';

interface HandlerEntry {
  handler: CommandHandler<unknown>;
  priority: CommandPriority;
}

export interface UpdateListenerPayload {
  readonly editorState: EditorState;
  readonly prevEditorState: EditorState;
  readonly dirtyNodeKeys: ReadonlySet<NodeKey>;
}

export type UpdateListener = (payload: UpdateListenerPayload) => void;

/**
 * Callback fired when the editor's mounted DOM root changes. Fires once on
 * initial subscription with the current root (or `null` if unmounted), and
 * again on every subsequent `setRoot`. Plugins use this hook to attach
 * native DOM listeners (keyboard shortcuts, etc.) without reaching into
 * the contenteditable directive.
 */
export type RootElementListener = (root: HTMLElement | null) => void;

export class Editor {
  private state = EditorState.createEmpty();
  private reconciler = new Reconciler();
  private root: HTMLElement | null = null;
  private commandHandlers = new Map<EditorCommand<unknown>, HandlerEntry[]>();
  private updateListeners: UpdateListener[] = [];
  private rootListeners: RootElementListener[] = [];

  constructor() {
    this.registerDefaultHandlers();
  }

  setRoot(root: HTMLElement | null) {
    if (this.root === root) {
      return;
    }
    this.root = root;
    if (root) {
      this.reconciler.mount(root, this.state);
    }
    this.notifyRootListeners(root);
  }

  /**
   * Subscribe to root-element attach/detach events. The listener is invoked
   * immediately with the current root so plugins don't need to special-case
   * the first call. Returns an unsubscribe function.
   */
  registerRootElementListener(listener: RootElementListener): () => void {
    this.rootListeners.push(listener);
    // Notify synchronously with current state so plugins can set up immediately.
    listener(this.root);
    return () => {
      const idx = this.rootListeners.indexOf(listener);
      if (idx >= 0) {
        this.rootListeners.splice(idx, 1);
      }
    };
  }

  /**
   * DOM lookup helpers exposed for the selection bridge. They forward to the
   * reconciler without leaking the reconciler itself to consumers.
   */
  keyForDomNode(node: Node | null): NodeKey | null {
    return this.reconciler.keyForDomNode(node);
  }

  getDomForKey(key: NodeKey): HTMLElement | null {
    return this.reconciler.getDom(key);
  }

  getEditorState(): EditorState {
    return this.state;
  }

  setEditorState(state: EditorState) {
    const prev = this.state;
    if (prev === state) {
      return;
    }
    this.state = state;
    if (this.root) {
      this.reconciler.update(this.root, prev, state);
    }
    this.notifyUpdateListeners(prev, state);
    state.clearDirtyNodeKeys();
  }

  read<T>(fn: (state: EditorState) => T): T {
    return fn(this.state);
  }

  registerUpdateListener(listener: UpdateListener): () => void {
    this.updateListeners.push(listener);
    return () => {
      const idx = this.updateListeners.indexOf(listener);
      if (idx >= 0) {
        this.updateListeners.splice(idx, 1);
      }
    };
  }

  registerCommand<TCommand extends EditorCommand<unknown>>(
    command: TCommand,
    handler: CommandHandler<CommandPayloadType<TCommand>>,
    priority: CommandPriority,
  ): () => void {
    const entry: HandlerEntry = {
      handler: handler as CommandHandler<unknown>,
      priority,
    };

    const key = command as EditorCommand<unknown>;
    let entries = this.commandHandlers.get(key);
    if (!entries) {
      entries = [];
      this.commandHandlers.set(key, entries);
    }
    entries.push(entry);

    return () => {
      const list = this.commandHandlers.get(key);
      if (!list) {
        return;
      }
      const idx = list.indexOf(entry);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
      if (list.length === 0) {
        this.commandHandlers.delete(key);
      }
    };
  }

  dispatchCommand<TCommand extends EditorCommand<unknown>>(
    command: TCommand,
    payload: CommandPayloadType<TCommand>,
  ): boolean {
    const entries = this.commandHandlers.get(command as EditorCommand<unknown>);
    if (!entries || entries.length === 0) {
      return false;
    }

    // Copy before sorting so concurrent registrations during dispatch don't
    // shuffle the iteration in-flight. Stable sort preserves registration
    // order within the same priority bucket.
    const sorted = entries.slice().sort((a, b) => b.priority - a.priority);
    for (const { handler } of sorted) {
      if (handler(payload) === true) {
        return true;
      }
    }
    return false;
  }

  /**
   * Produce a plugin-facing context exposing only documented public APIs.
   * Methods are bound so plugins can destructure/pass them freely.
   */
  getPluginContext(): EditorPluginContext {
    return {
      registerCommand: this.registerCommand.bind(this),
      registerUpdateListener: this.registerUpdateListener.bind(this),
      registerRootElementListener: this.registerRootElementListener.bind(this),
      dispatchCommand: this.dispatchCommand.bind(this),
      read: this.read.bind(this),
      update: this.update.bind(this),
      getEditorState: this.getEditorState.bind(this),
      setEditorState: this.setEditorState.bind(this),
      keyForDomNode: this.keyForDomNode.bind(this),
      getDomForKey: this.getDomForKey.bind(this),
    };
  }

  update(fn: (state: EditorState) => void) {
    const next = this.state.clone();
    fn(next);
    const prev = this.state;
    this.state = next;
    if (this.root) {
      this.reconciler.update(this.root, prev, next);
    }
    this.notifyUpdateListeners(prev, next);
    next.clearDirtyNodeKeys();
  }

  private notifyRootListeners(root: HTMLElement | null) {
    if (this.rootListeners.length === 0) {
      return;
    }
    const snapshot = this.rootListeners.slice();
    for (const listener of snapshot) {
      listener(root);
    }
  }

  private notifyUpdateListeners(prev: EditorState, next: EditorState) {
    if (this.updateListeners.length === 0) {
      return;
    }
    // Copy the dirty set so listeners keep a stable view after the transaction
    // clears it, and so listeners cannot mutate the editor's internal state.
    const payload: UpdateListenerPayload = {
      editorState: next,
      prevEditorState: prev,
      dirtyNodeKeys: new Set(next.getDirtyNodeKeys()),
    };
    // Iterate over a snapshot so listeners registered/removed during
    // notification don't alter the in-flight iteration.
    const snapshot = this.updateListeners.slice();
    for (const listener of snapshot) {
      listener(payload);
    }
  }

  private registerDefaultHandlers() {
    // All v1 core defaults register at `CommandPriority.Editor` so plugins
    // (registered at any higher priority) can intercept and short-circuit them.

    this.registerCommand(
      SET_TEXT_CONTENT,
      (payload) => {
        this.update((state) => state.setText(String(payload ?? '')));
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      INSERT_TEXT,
      ({ text }) => {
        if (!text) {
          return true;
        }
        this.update((state) => state.insertText(text));
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      DELETE_CHARACTER,
      ({ isBackward }) => {
        this.update((state) => state.deleteCharacter(isBackward));
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      INSERT_PARAGRAPH,
      () => {
        this.update((state) => state.insertParagraph());
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      CLEAR_EDITOR,
      () => {
        this.setEditorState(EditorState.createEmpty());
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      APPLY_EDITOR_STATE,
      (state) => {
        this.setEditorState(state);
        return true;
      },
      CommandPriority.Editor,
    );

    this.registerCommand(
      FORMAT_TEXT,
      ({ format, range }) => {
        this.update((state) => state.applyFormatToRange(range, format));
        return true;
      },
      CommandPriority.Editor,
    );
  }
}
