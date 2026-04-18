import { Provider } from '@angular/core';
import { providePlugin } from '../angular/editor-plugins.token';
import { FormattingKeyboardPlugin } from './formatting-keyboard.plugin';

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
