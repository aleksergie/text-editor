import { InjectionToken, Provider } from '@angular/core';
import { EditorPlugin } from '../core/plugin';

export const EDITOR_PLUGINS = new InjectionToken<readonly EditorPlugin[]>('EDITOR_PLUGINS');

export function providePlugin(plugin: EditorPlugin): Provider {
  return { provide: EDITOR_PLUGINS, useValue: plugin, multi: true };
}
