import { EditorPlugin, EditorPluginContext } from '../core/plugin';
import { resolveDomSelection } from '../core/selection';

/**
 * Bridges native `document.selectionchange` events into the editor's
 * cached selection. Exactly one listener per editor instance, scoped to
 * the mounted root element - multiple editors on one page each get their
 * own plugin instance and each filters out selections that landed outside
 * their own root.
 *
 * Design notes:
 * - The core editor stays DOM-free; this plugin is the only place
 *   `document` is referenced. Core sees only `editor.setSelection(range)`
 *   with a pre-resolved `TextRange`.
 * - Selections that leave the editor (focus lost, user clicks another
 *   region of the page, anchor node detached) produce `setSelection(null)`
 *   so consumers like the formatting toolbar can reset their state.
 * - `onRootElement` drives attach/detach, so Angular HMR root swaps and
 *   post-destroy cleanup happen automatically without any extra plumbing.
 * - `source: 'user'` tags every selection change pushed by this plugin,
 *   letting consumers distinguish native caret moves from programmatic
 *   updates (e.g. the editor's own stale-key invalidation).
 */
export const SelectionSyncPlugin: EditorPlugin = {
  key: 'core/selection-sync',
  setup(context: EditorPluginContext): () => void {
    let detachDomListener: (() => void) | null = null;
    let currentRoot: HTMLElement | null = null;

    const onSelectionChange = () => {
      if (!currentRoot) {
        return;
      }
      const doc = currentRoot.ownerDocument;
      const win = doc?.defaultView as (Window & typeof globalThis) | null;
      if (!doc || !win) {
        return;
      }

      const sel = win.getSelection();
      const anchor = sel?.anchorNode ?? null;
      if (!anchor || !currentRoot.contains(anchor)) {
        // Selection left (or never entered) this editor's root. Only
        // clear our cache if we had something cached, so we don't spam
        // null notifications for every other editor's selectionchange.
        if (context.getSelection() !== null) {
          context.setSelection(null, { source: 'user' });
        }
        return;
      }

      const range = resolveDomSelection(context, win);
      context.setSelection(range, { source: 'user' });
    };

    const detachCurrent = () => {
      detachDomListener?.();
      detachDomListener = null;
      currentRoot = null;
    };

    const unsubscribeRoot = context.registerRootElementListener((root) => {
      detachCurrent();
      if (!root) {
        // Unmounted. Clear any cached selection since it no longer
        // refers to anything observable on the page.
        if (context.getSelection() !== null) {
          context.setSelection(null, { source: 'programmatic' });
        }
        return;
      }
      const doc = root.ownerDocument;
      if (!doc) {
        return;
      }
      currentRoot = root;
      doc.addEventListener('selectionchange', onSelectionChange);
      detachDomListener = () => doc.removeEventListener('selectionchange', onSelectionChange);
    });

    return () => {
      unsubscribeRoot();
      detachCurrent();
    };
  },
};
