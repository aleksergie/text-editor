import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import {
  EditorRuntimeService,
  SelectionSource,
  TextFormat,
  TextFormatFlag,
  TextRange,
  createTextRange,
  getFormatIntersection,
  hasFormat,
} from '@text-editor/editor';

interface LogEntry {
  readonly id: number;
  readonly kind: 'selection' | 'update';
  readonly timestamp: string;
  readonly source: SelectionSource | '-';
  readonly summary: string;
  readonly backward: boolean;
  readonly collapsed: boolean;
}

interface FlagChip {
  readonly flag: TextFormatFlag;
  readonly label: string;
  readonly glyph: string;
}

const FLAG_CHIPS: readonly FlagChip[] = [
  { flag: TextFormat.BOLD, label: 'Bold', glyph: 'B' },
  { flag: TextFormat.ITALIC, label: 'Italic', glyph: 'I' },
  { flag: TextFormat.UNDERLINE, label: 'Underline', glyph: 'U' },
  { flag: TextFormat.STRIKETHROUGH, label: 'Strike', glyph: 'S' },
  { flag: TextFormat.CODE, label: 'Code', glyph: '</>' },
];

const MAX_LOG_ENTRIES = 100;

/**
 * Live inspector panel that surfaces the editor's Phase-2 selection state
 * directly to the screen. Intended as a development-time tool bundled with
 * the formatting demo - it does not ship as part of the editor library.
 *
 * What it shows:
 * - The current cached `TextRange` (or `null`), pulled from
 *   `Editor.getSelection()`.
 * - The active format flags, computed with `getFormatIntersection` on
 *   every change. This mirrors what the Phase-3 toolbar will consume.
 * - A rolling log of selection and update events, tagged with their
 *   source (`user` vs `programmatic`). Useful for confirming that
 *   `SelectionSyncPlugin` reports `user`, while internal invalidations
 *   and the two programmatic buttons report `programmatic`.
 * - Document graph stats (total nodes, text-node count, paragraph count,
 *   last-update dirty-key size).
 * - Two programmatic action buttons that drive `editor.setSelection`
 *   directly, without touching the DOM - the cleanest way to prove the
 *   source-tag discipline holds.
 */
@Component({
  selector: 'app-selection-debug-panel',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="debug-panel">
      <header class="debug-panel__header">
        <h2 class="debug-panel__title">Selection debug</h2>
        <span class="debug-panel__tag">Phase 2</span>
      </header>

      <section class="debug-panel__section">
        <h3 class="debug-panel__section-title">Cached selection</h3>
        <div
          class="debug-panel__range"
          [class.debug-panel__range--null]="!currentRange"
          [class.debug-panel__range--collapsed]="currentRange?.isCollapsed"
        >
          <ng-container *ngIf="currentRange; else noRange">
            <div class="debug-panel__range-line">
              <span class="debug-panel__kv-label">anchor</span>
              <code>{{ currentRange.anchor.key }}:{{ currentRange.anchor.offset }}</code>
            </div>
            <div class="debug-panel__range-line">
              <span class="debug-panel__kv-label">focus</span>
              <code>{{ currentRange.focus.key }}:{{ currentRange.focus.offset }}</code>
            </div>
            <div class="debug-panel__range-meta">
              <span [class.is-on]="currentRange.isBackward">backward</span>
              <span [class.is-on]="currentRange.isCollapsed">collapsed</span>
              <span class="debug-panel__source-chip debug-panel__source-chip--{{ lastSource }}">
                last: {{ lastSource }}
              </span>
            </div>
          </ng-container>
          <ng-template #noRange>
            <div class="debug-panel__null">null &mdash; no active selection</div>
          </ng-template>
        </div>
      </section>

      <section class="debug-panel__section">
        <h3 class="debug-panel__section-title">Format intersection</h3>
        <div class="debug-panel__chips">
          <span
            *ngFor="let chip of chips"
            class="debug-panel__chip"
            [class.debug-panel__chip--on]="isFlagActive(chip.flag)"
            [title]="chip.label"
          >
            {{ chip.glyph }}
          </span>
        </div>
        <p class="debug-panel__hint">
          Active iff <em>every</em> character in the cached range carries the flag.
        </p>
      </section>

      <section class="debug-panel__section">
        <h3 class="debug-panel__section-title">Graph stats</h3>
        <dl class="debug-panel__stats">
          <dt>nodes</dt><dd>{{ stats.nodeCount }}</dd>
          <dt>text nodes</dt><dd>{{ stats.textNodeCount }}</dd>
          <dt>paragraphs</dt><dd>{{ stats.paragraphCount }}</dd>
          <dt>last dirty</dt><dd>{{ stats.lastDirtySize }}</dd>
          <dt>selection events</dt>
          <dd>
            <span class="debug-panel__source-chip debug-panel__source-chip--user">user {{ counts.user }}</span>
            <span class="debug-panel__source-chip debug-panel__source-chip--programmatic">prog {{ counts.programmatic }}</span>
          </dd>
          <dt>update events</dt><dd>{{ counts.updates }}</dd>
        </dl>
      </section>

      <section class="debug-panel__section">
        <h3 class="debug-panel__section-title">
          Programmatic actions
          <small>(exercise source tagging)</small>
        </h3>
        <div class="debug-panel__buttons">
          <button type="button" (click)="emitProgrammaticRange()">
            setSelection(t1 0&hellip;3)
          </button>
          <button type="button" (click)="emitProgrammaticNull()">
            setSelection(null)
          </button>
        </div>
      </section>

      <section class="debug-panel__section debug-panel__section--log">
        <h3 class="debug-panel__section-title">
          Event log
          <button
            type="button"
            class="debug-panel__clear-btn"
            (click)="clearLog()"
            [disabled]="log.length === 0"
          >
            clear
          </button>
        </h3>
        <div #logScroll class="debug-panel__log">
          <div *ngIf="log.length === 0" class="debug-panel__log-empty">
            No events yet. Click or drag in the editor.
          </div>
          <div
            *ngFor="let entry of log; trackBy: trackById"
            class="debug-panel__log-entry debug-panel__log-entry--{{ entry.kind }}"
          >
            <span class="debug-panel__log-time">{{ entry.timestamp }}</span>
            <span
              class="debug-panel__log-source debug-panel__source-chip debug-panel__source-chip--{{ entry.source }}"
            >
              {{ entry.kind === 'update' ? 'upd' : entry.source }}
            </span>
            <code class="debug-panel__log-body">{{ entry.summary }}</code>
          </div>
        </div>
      </section>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 340px;
        flex: 0 0 340px;
      }
      .debug-panel {
        position: sticky;
        top: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 14px 18px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fafafa;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 12.5px;
        color: #111827;
        max-height: calc(100vh - 32px);
        overflow: hidden;
      }
      .debug-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .debug-panel__title {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: 15px;
        margin: 0;
      }
      .debug-panel__tag {
        background: #2563eb;
        color: white;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .debug-panel__section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-top: 1px solid #e5e7eb;
        padding-top: 10px;
      }
      .debug-panel__section--log {
        flex: 1 1 auto;
        min-height: 0;
      }
      .debug-panel__section-title {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #6b7280;
        margin: 0 0 2px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .debug-panel__section-title small {
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        color: #9ca3af;
      }
      .debug-panel__range {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .debug-panel__range--null {
        background: repeating-linear-gradient(
          45deg,
          #fafafa,
          #fafafa 6px,
          #f3f4f6 6px,
          #f3f4f6 12px
        );
      }
      .debug-panel__range--collapsed {
        border-color: #fcd34d;
        background: #fffbeb;
      }
      .debug-panel__range-line {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .debug-panel__kv-label {
        color: #6b7280;
        font-size: 11px;
        width: 42px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .debug-panel__range code {
        background: #f3f4f6;
        padding: 1px 6px;
        border-radius: 4px;
      }
      .debug-panel__range-meta {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-top: 2px;
        flex-wrap: wrap;
      }
      .debug-panel__range-meta span {
        font-size: 10.5px;
        padding: 1px 6px;
        border-radius: 4px;
        background: #f3f4f6;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .debug-panel__range-meta span.is-on {
        background: #fde68a;
        color: #78350f;
      }
      .debug-panel__null {
        color: #9ca3af;
        font-style: italic;
      }
      .debug-panel__chips {
        display: flex;
        gap: 4px;
      }
      .debug-panel__chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 24px;
        padding: 0 6px;
        border-radius: 4px;
        background: #f3f4f6;
        color: #9ca3af;
        font-weight: 700;
        font-size: 11px;
      }
      .debug-panel__chip--on {
        background: #2563eb;
        color: white;
      }
      .debug-panel__hint {
        color: #9ca3af;
        font-size: 10.5px;
        margin: 0;
      }
      .debug-panel__stats {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 10px;
        row-gap: 3px;
        margin: 0;
      }
      .debug-panel__stats dt {
        color: #6b7280;
        text-transform: uppercase;
        font-size: 10.5px;
        letter-spacing: 0.05em;
      }
      .debug-panel__stats dd {
        margin: 0;
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .debug-panel__source-chip {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 4px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .debug-panel__source-chip--user {
        background: #dcfce7;
        color: #166534;
      }
      .debug-panel__source-chip--programmatic {
        background: #e0e7ff;
        color: #3730a3;
      }
      .debug-panel__source-chip---,
      .debug-panel__source-chip--update {
        background: #f3f4f6;
        color: #6b7280;
      }
      .debug-panel__buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .debug-panel__buttons button {
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        cursor: pointer;
        color: #111827;
      }
      .debug-panel__buttons button:hover {
        background: #f3f4f6;
      }
      .debug-panel__buttons button:active {
        background: #e5e7eb;
      }
      .debug-panel__log {
        flex: 1 1 auto;
        overflow-y: auto;
        background: #111827;
        color: #f9fafb;
        padding: 8px;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 11px;
        max-height: 260px;
        min-height: 120px;
      }
      .debug-panel__log-empty {
        color: #6b7280;
        font-style: italic;
      }
      .debug-panel__log-entry {
        display: grid;
        grid-template-columns: 64px 56px 1fr;
        gap: 6px;
        padding: 2px 0;
        border-bottom: 1px solid #1f2937;
      }
      .debug-panel__log-entry:last-child {
        border-bottom: none;
      }
      .debug-panel__log-entry--update {
        color: #93c5fd;
      }
      .debug-panel__log-time {
        color: #6b7280;
      }
      .debug-panel__log-source {
        justify-self: start;
      }
      .debug-panel__log-body {
        background: transparent;
        color: inherit;
        word-break: break-all;
      }
      .debug-panel__clear-btn {
        background: transparent;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 1px 6px;
        font-size: 10px;
        font-family: inherit;
        cursor: pointer;
        color: #6b7280;
        text-transform: uppercase;
      }
      .debug-panel__clear-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
  ],
})
export class SelectionDebugPanelComponent implements AfterViewInit {
  private readonly runtime = inject(EditorRuntimeService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('logScroll') private logScrollRef?: ElementRef<HTMLDivElement>;

  readonly chips = FLAG_CHIPS;

  currentRange: TextRange | null = null;
  lastSource: SelectionSource | '-' = '-';
  activeFlags = 0;
  log: LogEntry[] = [];
  counts = { user: 0, programmatic: 0, updates: 0 };
  stats = {
    nodeCount: 0,
    textNodeCount: 0,
    paragraphCount: 0,
    lastDirtySize: 0,
  };

  private nextLogId = 0;
  private shouldScrollToBottom = false;

  constructor() {
    this.recomputeStatsAndFormat();

    const unsubSelection = this.runtime.editor.registerSelectionListener(
      (range, source) => {
        this.currentRange = range;
        this.lastSource = source;
        this.counts = {
          ...this.counts,
          [source]: this.counts[source] + 1,
        };
        this.pushLog({
          kind: 'selection',
          source,
          summary: this.summarize(range),
          backward: range?.isBackward ?? false,
          collapsed: range?.isCollapsed ?? false,
        });
        this.recomputeStatsAndFormat();
        this.cdr.markForCheck();
      },
    );

    const unsubUpdates = this.runtime.editor.registerUpdateListener((payload) => {
      this.stats = {
        ...this.stats,
        lastDirtySize: payload.dirtyNodeKeys.size,
      };
      this.counts = { ...this.counts, updates: this.counts.updates + 1 };
      this.pushLog({
        kind: 'update',
        source: '-',
        summary: `dirty=${payload.dirtyNodeKeys.size}`,
        backward: false,
        collapsed: false,
      });
      this.recomputeStatsAndFormat();
      this.cdr.markForCheck();
    });

    this.destroyRef.onDestroy(() => {
      unsubSelection();
      unsubUpdates();
    });
  }

  ngAfterViewInit(): void {
    this.scrollLogToBottom();
  }

  isFlagActive(flag: TextFormatFlag): boolean {
    return hasFormat(this.activeFlags, flag);
  }

  clearLog(): void {
    this.log = [];
    this.cdr.markForCheck();
  }

  emitProgrammaticRange(): void {
    const firstTextKey = this.firstTextNodeKey();
    if (!firstTextKey) {
      return;
    }
    const range = createTextRange(
      { key: firstTextKey, offset: 0 },
      { key: firstTextKey, offset: 3 },
      false,
    );
    this.runtime.editor.setSelection(range, { source: 'programmatic' });
  }

  emitProgrammaticNull(): void {
    this.runtime.editor.setSelection(null, { source: 'programmatic' });
  }

  trackById(_index: number, entry: LogEntry): number {
    return entry.id;
  }

  private pushLog(partial: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const entry: LogEntry = {
      id: this.nextLogId++,
      timestamp: this.now(),
      ...partial,
    };
    const next = this.log.concat(entry);
    this.log = next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    this.shouldScrollToBottom = true;
    // Schedule post-render scroll since OnPush won't flush until markForCheck.
    queueMicrotask(() => this.scrollLogToBottom());
  }

  private scrollLogToBottom(): void {
    if (!this.shouldScrollToBottom) {
      return;
    }
    const el = this.logScrollRef?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    this.shouldScrollToBottom = false;
  }

  private summarize(range: TextRange | null): string {
    if (!range) {
      return 'null';
    }
    const dir = range.isBackward ? '<-' : '->';
    return `${range.anchor.key}:${range.anchor.offset} ${dir} ${range.focus.key}:${range.focus.offset}`;
  }

  private recomputeStatsAndFormat(): void {
    const state = this.runtime.editor.getEditorState();
    let textNodes = 0;
    let paragraphs = 0;
    for (const node of state.nodes.values()) {
      const type = (node as { type?: string }).type;
      if (type === 'text') {
        textNodes += 1;
      } else if (type === 'paragraph') {
        paragraphs += 1;
      }
    }
    this.stats = {
      ...this.stats,
      nodeCount: state.nodes.size,
      textNodeCount: textNodes,
      paragraphCount: paragraphs,
    };
    const range = this.runtime.editor.getSelection();
    this.activeFlags = range ? getFormatIntersection(state, range) : TextFormat.NONE;
  }

  private firstTextNodeKey(): string | null {
    const state = this.runtime.editor.getEditorState();
    for (const node of state.nodes.values()) {
      if ((node as { type?: string }).type === 'text') {
        return (node as { key: string }).key;
      }
    }
    return null;
  }

  private now(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }
}
