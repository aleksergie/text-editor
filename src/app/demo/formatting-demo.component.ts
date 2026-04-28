import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ContentEditableDirective,
  EditorRuntimeService,
  FormattingToolbarComponent,
  provideFormattingKeyboardPlugin,
  provideSelectionSyncPlugin,
} from '@text-editor/editor';
import { SelectionDebugPanelComponent } from './selection-debug-panel.component';

/**
 * Demo route that composes the editor runtime with the formatting toolbar,
 * the keyboard shortcut plugin, and the Phase-2 selection-sync plugin.
 * The right-hand debug panel visualises the editor-owned selection state
 * in real time.
 *
 * Everything is wired through public library APIs - the demo has no
 * privileged access to editor internals.
 */
@Component({
  selector: 'app-formatting-demo',
  imports: [CommonModule, ContentEditableDirective, FormattingToolbarComponent, SelectionDebugPanelComponent],
  providers: [EditorRuntimeService, provideFormattingKeyboardPlugin(), provideSelectionSyncPlugin()],
  template: `
    <div class="formatting-demo">
      <h1 class="formatting-demo__title">Rich text formatting demo</h1>
      <p class="formatting-demo__hint">
        Select some text, then press <kbd>Ctrl/Cmd+B</kbd>, <kbd>I</kbd>, <kbd>U</kbd>, <kbd>E</kbd>, or
        <kbd>Shift+X</kbd>, or use the toolbar below.
      </p>

      <div class="formatting-demo__layout">
        <div class="formatting-demo__editor">
          <lib-formatting-toolbar></lib-formatting-toolbar>

          <div
            class="formatting-demo__surface"
            contenteditable="true"
            spellcheck="true"
            [editor]="runtime.editor"
          ></div>
        </div>

        <app-selection-debug-panel></app-selection-debug-panel>
      </div>
    </div>
  `,
  styles: [
    `
      .formatting-demo {
        max-width: 1180px;
        margin: 40px auto;
        padding: 0 24px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #111827;
      }
      .formatting-demo__title {
        font-size: 24px;
        margin-bottom: 8px;
      }
      .formatting-demo__hint {
        color: #4b5563;
        margin-bottom: 16px;
        font-size: 14px;
      }
      .formatting-demo__hint kbd {
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-bottom-width: 2px;
        border-radius: 4px;
        padding: 1px 6px;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 12px;
      }
      .formatting-demo__layout {
        display: flex;
        align-items: flex-start;
        gap: 24px;
      }

      .formatting-demo__editor {
        flex: 1 1 auto;
        min-width: 0;
      }
      .formatting-demo__surface {
        margin-top: 12px;
        min-height: 320px;
        padding: 16px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
        font-size: 16px;
        line-height: 1.5;
        outline: none;
      }
      .formatting-demo__surface:focus-visible {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
      @media (max-width: 960px) {
        .formatting-demo__layout {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class FormattingDemoComponent {
  protected readonly runtime = inject(EditorRuntimeService);
}
