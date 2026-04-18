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
import { TextNode } from '../../../core/nodes/text-node';
import { $isTextNode } from '../../../core/nodes/node-utils';
import {
  SelectionResolverHost,
  TextRange,
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
    if (!range || range.isCollapsed) {
      if (this.activeFlags !== 0) {
        this.activeFlags = 0;
        this.cdr.markForCheck();
      }
      return;
    }

    const state = this.runtime.editor.getEditorState();
    const startNode = state.nodes.get(range.anchor.key);
    if (!$isTextNode(startNode)) {
      return;
    }

    // Approximate active state: intersect the format bitfields of every text
    // node touched by the range. A flag is "active" only if every character
    // has it; this matches the toggle semantics so button state reflects
    // what the next click would flip.
    let bits = (startNode as TextNode).format;
    const endKey = range.focus.key;
    const nodes = state.getTextNodesInDocumentOrder();
    const startIdx = nodes.indexOf(startNode);
    let endIdx = nodes.findIndex((n) => n.key === endKey);
    if (startIdx < 0 || endIdx < 0) {
      return;
    }
    if (endIdx < startIdx) {
      const tmp = endIdx;
      endIdx = startIdx;
      const adjustedStart = tmp;
      for (let i = adjustedStart; i <= endIdx; i += 1) {
        bits &= nodes[i].format;
      }
    } else {
      for (let i = startIdx; i <= endIdx; i += 1) {
        bits &= nodes[i].format;
      }
    }

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
