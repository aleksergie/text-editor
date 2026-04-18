import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  NgZone,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_TEXT } from '../../../core/commands';
import { EditorRuntimeService } from '../../../angular/editor-runtime.service';
import {
  SelectionResolverHost,
  TextRange,
  getFormatIntersection,
  resolveDomSelection,
} from '../../../core/selection';
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
 * Drop-in standalone formatting toolbar. Injects the ambient
 * `EditorRuntimeService`, reads the current DOM selection on demand, and
 * dispatches `FORMAT_TEXT`. Active state is refreshed on editor updates and
 * on native `selectionchange`.
 *
 * Usage:
 *   <lib-formatting-toolbar></lib-formatting-toolbar>
 *
 * The host component must provide `EditorRuntimeService` (typically by
 * rendering `<lib-editor>` in the same component, or by re-providing the
 * service on a wrapper component).
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
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly buttons = BUTTONS;
  activeFlags = 0;

  constructor() {
    const unsubscribeUpdates = this.runtime.editor.registerUpdateListener(() => {
      this.refreshActiveFlags();
    });

    const onSelectionChange = () => {
      this.zone.run(() => this.refreshActiveFlags());
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('selectionchange', onSelectionChange);
    }

    this.destroyRef.onDestroy(() => {
      unsubscribeUpdates();
      if (typeof document !== 'undefined') {
        document.removeEventListener('selectionchange', onSelectionChange);
      }
    });
  }

  isActive(flag: TextFormatFlag): boolean {
    return hasFormat(this.activeFlags, flag);
  }

  toggle(flag: TextFormatFlag, event: Event): void {
    event.preventDefault();
    const range = this.readRange();
    if (!range || range.isCollapsed) {
      return;
    }
    this.runtime.editor.dispatchCommand(FORMAT_TEXT, { format: flag, range });
  }

  private refreshActiveFlags(): void {
    const range = this.readRange();
    const bits = range
      ? getFormatIntersection(this.runtime.editor.getEditorState(), range)
      : TextFormat.NONE;
    if (bits !== this.activeFlags) {
      this.activeFlags = bits;
      this.cdr.markForCheck();
    }
  }

  private readRange(): TextRange | null {
    const context = this.runtime.editor as unknown as SelectionResolverHost;
    if (typeof window === 'undefined') {
      return null;
    }
    return resolveDomSelection(context, window);
  }
}
