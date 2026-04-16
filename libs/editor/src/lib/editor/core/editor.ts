import {
  CommandHandler,
  CommandPayloadType,
  CommandPriority,
  EditorCommand,
  SET_TEXT,
} from './commands';
import { Reconciler } from './reconciler';
import { EditorState } from './state';

interface HandlerEntry {
  handler: CommandHandler<unknown>;
  priority: CommandPriority;
}

export class Editor {
  private state = EditorState.createEmpty();
  private reconciler = new Reconciler();
  private root: HTMLElement | null = null;
  private commandHandlers = new Map<EditorCommand<unknown>, HandlerEntry[]>();

  constructor() {
    this.registerDefaultHandlers();
  }

  setRoot(root: HTMLElement | null) {
    this.root = root;
    if (root) {
      this.reconciler.mount(root, this.state);
    }
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

  update(fn: (state: EditorState) => void) {
    const next = this.state.clone();
    fn(next);
    const prev = this.state;
    this.state = next;
    if (this.root) {
      this.reconciler.update(this.root, prev, next);
    }
    next.clearDirtyNodeKeys();
  }

  private registerDefaultHandlers() {
    // Bridged onto the bus so existing input flow keeps working. M1-T5 will
    // replace this with SET_TEXT_CONTENT and the broader v1 command set.
    this.registerCommand(
      SET_TEXT,
      (payload) => {
        this.update((state) => state.setText(String(payload ?? '')));
        return true;
      },
      CommandPriority.Editor,
    );
  }
}
