import { Provider } from '@angular/core';
import { providePlugin } from '../angular/editor-plugins.token';
import { FormattingKeyboardPlugin } from './formatting-keyboard.plugin';
import { SelectionSyncPlugin } from './selection-sync.plugin';

/**
 * Ergonomic DI helper: `providers: [provideFormattingKeyboardPlugin()]`.
 *
 * This is the only public entry point for the formatting keyboard plugin.
 * The raw `EditorPlugin` value is intentionally not re-exported; advanced
 * consumers who need it (e.g. to wire it into a custom `EDITOR_PLUGINS`
 * array) can still deep-import from `'./formatting-keyboard.plugin'`.
 */
export function provideFormattingKeyboardPlugin(): Provider {
  return providePlugin(FormattingKeyboardPlugin);
}

/**
 * Ergonomic DI helper: `providers: [provideSelectionSyncPlugin()]`.
 *
 * Registers the `SelectionSyncPlugin`, which forwards native
 * `selectionchange` events into `editor.setSelection` with a `'user'`
 * source tag. Opt-in: applications that want UI surfaces (toolbar,
 * floating menu, status bar, ...) to react to caret moves should include
 * this provider alongside any selection-consuming plugins/components.
 * Headless consumers (tests, server-side) can omit it and drive
 * selection via direct `editor.setSelection` calls.
 *
 * As with the formatting keyboard plugin, the raw `EditorPlugin` value
 * is intentionally not re-exported; advanced consumers can deep-import
 * from `'./selection-sync.plugin'` if they need to wire it into a
 * custom `EDITOR_PLUGINS` array.
 */
export function provideSelectionSyncPlugin(): Provider {
  return providePlugin(SelectionSyncPlugin);
}
