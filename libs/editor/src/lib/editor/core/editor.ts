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
import { $isTextNode } from './nodes/node-utils';
import { EditorPluginContext } from './plugin';
import { Reconciler } from './reconciler';
import {
  SelectionListener,
  SelectionSource,
  TextRange,
  rangesEqual,
} from './selection';
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

interface PendingSelection {
  range: TextRange | null;
  source: SelectionSource;
}

export interface SetSelectionOptions {
  /** Origin tag forwarded to listeners. Defaults to `'programmatic'`. */
  source?: SelectionSource;
}

export class Editor {
  private state = EditorState.createEmpty();
  private reconciler = new Reconciler();
  private root: HTMLElement | null = null;
  private commandHandlers = new Map<EditorCommand<unknown>, HandlerEntry[]>();
  private updateListeners: UpdateListener[] = [];
  private rootListeners: RootElementListener[] = [];

  /**
   * Editor-owned cached selection. Populated by the selection-sync plugin
   * on native `selectionchange`, by explicit programmatic calls, and reset
   * internally when a structural mutation removes the nodes the range
   * referenced. `null` means "no selection" (focus lost, range cleared, or
   * stale keys just invalidated).
   */
  private currentSelection: TextRange | null = null;
  private selectionListeners: SelectionListener[] = [];

  /**
   * Transaction staging area. `setSelection` calls that happen while an
   * `update()` is in flight land here instead of firing immediately; the
   * outermost `update()` commits the staged value after running both the
   * mutator and the update listeners. Keeps selection changes consistent
   * with the document state observers see.
   */
  private pendingSelection: PendingSelection | undefined;
  private isUpdating = false;

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
    // Wholesale state replacement almost always invalidates the cached
    // selection (keys rarely survive a snapshot swap). Null it out before
    // notifying listeners so observers never see a range pointing at a node
    // that no longer exists.
    if (!this.isSelectionValid(this.currentSelection, state)) {
      this.commitSelection(null, 'programmatic');
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
      registerSelectionListener: this.registerSelectionListener.bind(this),
      dispatchCommand: this.dispatchCommand.bind(this),
      read: this.read.bind(this),
      update: this.update.bind(this),
      getEditorState: this.getEditorState.bind(this),
      setEditorState: this.setEditorState.bind(this),
      getSelection: this.getSelection.bind(this),
      setSelection: this.setSelection.bind(this),
      keyForDomNode: this.keyForDomNode.bind(this),
      getDomForKey: this.getDomForKey.bind(this),
    };
  }

  /**
   * Read the currently cached selection in model coordinates. Returns
   * `null` when no selection is active (focus lost, selection moved
   * outside the editor, or the last cached range was invalidated by a
   * structural mutation that removed its anchor/focus node).
   */
  getSelection(): TextRange | null {
    return this.currentSelection;
  }

  /**
   * Update the cached selection.
   *
   * Behavior:
   * - When called outside an `update()` transaction, commits immediately.
   *   Listeners fire synchronously if the new range differs from the
   *   cached one by structural equality.
   * - When called inside an `update()` mutator or update listener, the
   *   value is staged and committed at the end of the outermost
   *   transaction - alongside any other pending changes - so observers
   *   see a single consistent state.
   * - `null` is a valid value ("no selection"). Passing a range that
   *   structurally equals the cached one is a no-op; listeners do not
   *   re-fire.
   *
   * The `source` tag is forwarded to `SelectionListener`s so consumers
   * can distinguish user-driven moves from programmatic replays. Defaults
   * to `'programmatic'`.
   */
  setSelection(range: TextRange | null, options: SetSelectionOptions = {}): void {
    const source = options.source ?? 'programmatic';
    if (this.isUpdating) {
      this.pendingSelection = { range, source };
      return;
    }
    this.commitSelection(range, source);
  }

  /**
   * Subscribe to selection changes. Listeners fire only when the cached
   * range actually changes (structural equality), and always fire outside
   * `update()` transactions. During an update, all selection changes -
   * whether user-triggered, programmatic, or stale-key invalidations -
   * are coalesced and flushed once at commit time. Returns an unsubscribe
   * function.
   */
  registerSelectionListener(listener: SelectionListener): () => void {
    this.selectionListeners.push(listener);
    return () => {
      const idx = this.selectionListeners.indexOf(listener);
      if (idx >= 0) {
        this.selectionListeners.splice(idx, 1);
      }
    };
  }

  update(fn: (state: EditorState) => void) {
    const wasUpdating = this.isUpdating;
    this.isUpdating = true;
    try {
      const next = this.state.clone();
      fn(next);
      const prev = this.state;
      this.state = next;
      if (this.root) {
        this.reconciler.update(this.root, prev, next);
      }

      // Invalidate cached selection if structural mutations removed its
      // anchor/focus nodes. This also covers the case where a caller inside
      // the mutator staged a range that became stale by the end of the
      // transaction - we still null it out so observers never see a
      // dangling key. The next `selectionchange` from the browser, delivered
      // via the sync plugin, refills the cache.
      this.maybeInvalidatePendingSelection(next);

      this.notifyUpdateListeners(prev, next);
      next.clearDirtyNodeKeys();
    } finally {
      this.isUpdating = wasUpdating;
    }

    // Only the outermost update flushes selection. Nested updates keep their
    // changes staged so the outer transaction observes a single post-commit
    // selection value.
    if (!wasUpdating) {
      this.flushPendingSelection();
    }
  }

  /**
   * Returns true if both endpoints of `range` still resolve to live
   * `TextNode`s in `state` AND their offsets fit within the node's
   * current text length. The offset check is important because node
   * keys are deterministic across `createEmpty()` rebuilds (CLEAR_EDITOR
   * regenerates to the same baseline `t1` key), so without it a
   * reset-to-empty could leave a range pointing into a now-empty text
   * node at a long-gone offset.
   */
  private isSelectionValid(range: TextRange | null, state: EditorState): boolean {
    if (!range) {
      return true;
    }
    const anchor = state.nodes.get(range.anchor.key);
    const focus = state.nodes.get(range.focus.key);
    if (!$isTextNode(anchor) || !$isTextNode(focus)) {
      return false;
    }
    return (
      range.anchor.offset >= 0 &&
      range.anchor.offset <= anchor.text.length &&
      range.focus.offset >= 0 &&
      range.focus.offset <= focus.text.length
    );
  }

  /**
   * Called at the end of an `update()` mutator, before update listeners
   * run. If the pending-or-cached selection references nodes that no
   * longer exist, stage a `null` selection so the flush fires a clear
   * notification. Preserves the staged `source` tag when overriding a
   * user-staged pending value (so listeners can still tell "this came
   * from the user but the editor had to drop it").
   */
  private maybeInvalidatePendingSelection(state: EditorState): void {
    const effective = this.pendingSelection !== undefined
      ? this.pendingSelection.range
      : this.currentSelection;
    if (this.isSelectionValid(effective, state)) {
      return;
    }
    const source = this.pendingSelection?.source ?? 'programmatic';
    this.pendingSelection = { range: null, source };
  }

  private flushPendingSelection(): void {
    const pending = this.pendingSelection;
    this.pendingSelection = undefined;
    if (!pending) {
      return;
    }
    this.commitSelection(pending.range, pending.source);
  }

  private commitSelection(range: TextRange | null, source: SelectionSource): void {
    if (rangesEqual(range, this.currentSelection)) {
      return;
    }
    this.currentSelection = range;
    if (this.selectionListeners.length === 0) {
      return;
    }
    const snapshot = this.selectionListeners.slice();
    for (const listener of snapshot) {
      listener(range, source);
    }
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
