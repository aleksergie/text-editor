import { InjectionToken, Provider } from '@angular/core';
import { EditorPlugin } from '../core/plugin';

/**
 * Multi-provider Angular DI token for registering `EditorPlugin` instances.
 * `EditorRuntimeService` injects the aggregated array and composes the plugin
 * set for each editor instance.
 */
export const EDITOR_PLUGINS = new InjectionToken<readonly EditorPlugin[]>('EDITOR_PLUGINS');

/**
 * Ergonomic helper to produce a multi-provider for `EDITOR_PLUGINS`. Prefer
 * this over writing the provider literal at every call site.
 */
export function providePlugin(plugin: EditorPlugin): Provider {
  return { provide: EDITOR_PLUGINS, useValue: plugin, multi: true };
}
