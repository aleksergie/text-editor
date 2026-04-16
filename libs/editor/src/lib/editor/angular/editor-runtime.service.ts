import { inject, Injectable, OnDestroy } from '@angular/core';
import { Editor } from '../core/editor';
import { EditorPlugin } from '../core/plugin';
import { EDITOR_PLUGINS } from './editor-plugins.token';

/**
 * Owns a single editor runtime instance for the component it is provided on.
 * Loads plugins from the `EDITOR_PLUGINS` multi-provider, invokes each
 * plugin's `setup`, and tears everything down on `ngOnDestroy`.
 *
 * This service MUST be provided at the component level (not `providedIn:
 * 'root'`) so that each editor host gets its own isolated runtime.
 */
@Injectable()
export class EditorRuntimeService implements OnDestroy {
  private readonly plugins = inject<readonly EditorPlugin[] | null>(EDITOR_PLUGINS, {
    optional: true,
  }) ?? [];
  private readonly _editor = new Editor();
  private teardowns: Array<() => void> = [];

  constructor() {
    for (const plugin of this.plugins) {
      const cleanup = plugin.setup(this._editor.getPluginContext());
      if (typeof cleanup === 'function') {
        this.teardowns.push(cleanup);
      }
    }
  }

  get editor(): Editor {
    return this._editor;
  }

  ngOnDestroy(): void {
    // Run setup-returned teardowns in reverse registration order so later
    // plugins tear down before earlier ones (standard stack-unwind shape).
    for (let i = this.teardowns.length - 1; i >= 0; i -= 1) {
      this.teardowns[i]();
    }
    this.teardowns = [];

    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }

    this._editor.setRoot(null);
  }
}
