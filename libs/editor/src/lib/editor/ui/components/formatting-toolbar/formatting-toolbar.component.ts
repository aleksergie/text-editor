import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_TEXT } from '../../../core/commands';
import { EditorRuntimeService } from '../../../angular/editor-runtime.service';
import { getFormatIntersection } from '../../../core/selection';
import {
  TextFormat,
  TextFormatFlag,
  hasFormat,
} from '../../../core/text-format';

interface ToolbarButton {
  readonly flag: TextFormatFlag;
  readonly label: string;
  readonly hint: string;
  readonly glyph: string;
}

const BUTTONS: readonly ToolbarButton[] = [
  { flag: TextFormat.BOLD, label: 'Bold', hint: 'Ctrl/Cmd+B', glyph: 'B' },
  { flag: TextFormat.ITALIC, label: 'Italic', hint: 'Ctrl/Cmd+I', glyph: 'I' },
  { flag: TextFormat.UNDERLINE, label: 'Underline', hint: 'Ctrl/Cmd+U', glyph: 'U' },
  {
    flag: TextFormat.STRIKETHROUGH,
    label: 'Strikethrough',
    hint: 'Ctrl/Cmd+Shift+X',
    glyph: 'S',
  },
  { flag: TextFormat.CODE, label: 'Code', hint: 'Ctrl/Cmd+E', glyph: '</>' },
];

/**
 * Drop-in standalone formatting toolbar. Reads the editor's cached
 * selection (populated by `SelectionSyncPlugin`), computes the
 * format-flag intersection over that range, and dispatches `FORMAT_TEXT`
 * on button presses. Refreshes on both selection and update events so
 * caret moves and structural format changes both keep the buttons in sync.
 *
 * Usage:
 *   <lib-formatting-toolbar></lib-formatting-toolbar>
 *
 * Requirements:
 * - The host component must provide `EditorRuntimeService` (typically by
 *   rendering the editor surface in the same component or by re-providing
 *   the service on a wrapper).
 * - `provideSelectionSyncPlugin()` MUST be in the providers, otherwise
 *   the toolbar will receive no selection updates and its buttons will
 *   never light up. The toolbar deliberately does NOT auto-register the
 *   sync plugin - registration stays explicit, matching how every other
 *   plugin in the editor library is wired.
 *
 * Design notes:
 * - No DOM listeners. Everything flows through
 *   `editor.registerSelectionListener` and `editor.registerUpdateListener`.
 * - Click path uses `(mousedown)` with `event.preventDefault()` so the
 *   editor's selection survives the button press. The cached range is
 *   read at toggle time, not the current `window.getSelection()`.
 */
@Component({
  selector: 'lib-formatting-toolbar',
  imports: [CommonModule],
  templateUrl: './formatting-toolbar.component.html',
  styleUrl: './formatting-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormattingToolbarComponent {
  private readonly runtime = inject(EditorRuntimeService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly buttons = BUTTONS;
  activeFlags = 0;

  constructor() {
    // Subscribe to both signals: selection moves do not flow through
    // update(), and a future format-affecting command might mutate state
    // without changing selection. The `bits !== activeFlags` guard inside
    // refresh() de-dupes any redundant markForCheck.
    const unsubscribeSelection = this.runtime.editor.registerSelectionListener(() => {
      this.refresh();
    });
    const unsubscribeUpdates = this.runtime.editor.registerUpdateListener(() => {
      this.refresh();
    });

    this.destroyRef.onDestroy(() => {
      unsubscribeSelection();
      unsubscribeUpdates();
    });
  }

  isActive(flag: TextFormatFlag): boolean {
    return hasFormat(this.activeFlags, flag);
  }

  toggle(flag: TextFormatFlag, event: Event): void {
    // mousedown's preventDefault keeps the editor's selection intact
    // through the button press, so the cached range is still the user's
    // intended target when we read it below.
    event.preventDefault();
    const range = this.runtime.editor.getSelection();
    if (!range || range.isCollapsed) {
      return;
    }
    this.runtime.editor.dispatchCommand(FORMAT_TEXT, { format: flag, range });
  }

  private refresh(): void {
    const range = this.runtime.editor.getSelection();
    const bits = range && !range.isCollapsed
      ? getFormatIntersection(this.runtime.editor.getEditorState(), range)
      : TextFormat.NONE;
    if (bits !== this.activeFlags) {
      this.activeFlags = bits;
      this.cdr.markForCheck();
    }
  }
}
