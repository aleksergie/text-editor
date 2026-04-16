import { SET_TEXT } from './commands';
import { Reconciler } from './reconciler';
import { EditorState } from './state';

export class Editor {
  private state = EditorState.createEmpty();
  private reconciler = new Reconciler();
  private root: HTMLElement | null = null;

  setRoot(root: HTMLElement | null) {
    this.root = root;
    if (root) {
      this.reconciler.mount(root, this.state);
    }
  }

  dispatchCommand(type: string, payload: unknown) {
    if (type === SET_TEXT) {
      this.update((state) => state.setText(String(payload ?? '')));
      return true;
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
}
