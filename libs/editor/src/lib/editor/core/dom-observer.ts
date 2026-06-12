const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  characterDataOldValue: true,
};

/**
 * Mirrors Lexical's `flushMutations(editor, mutations, observer)` shape.
 * The second argument lets later phases call `takeRecords()` mid-flush to
 * capture browser auto-cleanup mutations (e.g. spurious `<br>` injection
 * after we revert a childList change). See LexicalMutations.ts.
 */
export type DomObserverCallback = (
  mutations: MutationRecord[],
  takeRecords: () => MutationRecord[],
) => void;

/**
 * Wraps a native `MutationObserver` with a reference-counted pause/resume
 * contract so reconciler and future selection-writer DOM updates do not
 * feed back into mutation handling.
 */
export class DomObserver {
  private observer: MutationObserver | null = null;
  private root: HTMLElement | null = null;
  private pauseDepth = 0;
  private callback: DomObserverCallback;

  constructor(callback: DomObserverCallback) {
    this.callback = callback;
  }

  start(root: HTMLElement): void {
    this.stop();
    this.root = root;
    this.pauseDepth = 0;
    if (!this.observer) {
      this.observer = new MutationObserver((records) => {
        if (this.pauseDepth === 0) {
          this.deliver(records);
        }
      });
    }
    this.observer.observe(root, OBSERVER_OPTIONS);
  }

  stop(): void {
    this.observer?.disconnect();
    this.root = null;
    this.pauseDepth = 0;
  }

  pause(): void {
    this.pauseDepth += 1;
    if (this.pauseDepth === 1) {
      this.observer?.disconnect();
    }
  }

  resume(): void {
    if (this.pauseDepth === 0) {
      return;
    }
    this.pauseDepth -= 1;
    if (this.pauseDepth === 0 && this.observer && this.root) {
      this.observer.observe(this.root, OBSERVER_OPTIONS);
    }
  }

  /** Discard queued records after mutation-defense DOM cleanup. */
  drain(): void {
    this.observer?.takeRecords();
  }

  /**
   * Synchronously process any queued mutations through the registered
   * callback. Mirrors Lexical's `flushRootMutations`. Used by future
   * composition-end and on-demand flush paths (Phase 4).
   */
  flush(): void {
    if (!this.observer || this.pauseDepth > 0) {
      return;
    }
    const records = this.observer.takeRecords();
    if (records.length > 0) {
      this.deliver(records);
    }
  }

  private deliver(records: MutationRecord[]): void {
    this.callback(records, () => this.observer?.takeRecords() ?? []);
  }
}
