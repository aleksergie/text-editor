# Editor-Owned Selection State - Design Note

Status: **Draft / Under Review** - not yet scheduled. Review, edit, and
extend this note freely. Implementation kicks off once the outstanding items
in "Open Questions" are closed.

Related prior work:

- `docs/angular-lexical-editor-plan.md` - V1 minimal engine.
- `docs/rich-text-formatting-plan.md` - V2 rich-text formatting, which
surfaced the duplication problem this note addresses.

## Why this exists

Today, `FormattingToolbarComponent` owns four concerns in one place:

1. Listen to native `document.selectionchange`.
2. Resolve DOM selection to a model `TextRange` via `resolveDomSelection`.
3. Intersect format bits across every `TextNode` inside the range to derive
  active-flag state.
4. Drive Angular change detection (`NgZone.run`, `cdr.markForCheck`).

(1)-(3) are not Angular-specific and are not formatting-specific in the
generic sense; any future UI surface (floating menu, link popover, status
bar, mobile chip strip, command palette) that needs to react to the caret
will reimplement the same plumbing. We should lift (1)-(3) out of the
component before the second consumer lands.

This note captures a three-step design for doing that while keeping the
existing architectural commitments:

- `core/` stays framework-agnostic and DOM-**rendering**-only (no DOM event
listeners in core).
- Formatting semantics stay out of `Editor` itself; formatting-aware helpers
live alongside `core/text-format.ts` or `core/selection.ts`.
- Multiple editors on one page remain isolated.
- `EditorState` remains selection-free for now (versioned selection is
deferred to the undo/redo milestone).

## Current flow (for reference)

```
  document.selectionchange (DOM)
             |
             v
  FormattingToolbarComponent
    - resolveDomSelection(editor, window) -> TextRange | null
    - walk text nodes, AND their format bits -> activeFlags
    - cdr.markForCheck()
```

Every toolbar instance attaches its own `selectionchange` listener. There is
no shared "current selection" concept on the editor; selection is recomputed
lazily per consumer.

## Proposed flow

```
  document.selectionchange (DOM)
             |
             v
  SelectionSyncPlugin  (Angular / host adapter layer)
    - resolveDomSelection -> TextRange | null
    - scope-check via root.contains(anchorNode)
    - editor.setSelection(range)
             |
             v
  Editor  (core, stateful, DOM-free)
    - cached TextRange | null
    - selectionListeners notified on change
             |
             +--> FormattingToolbarComponent
             |     - getFormatIntersection(state, range)
             |     - activeFlags = bits; markForCheck()
             |
             +--> FloatingMenuComponent (future)
             +--> LinkPopoverPlugin    (future)
             +--> StatusBarComponent   (future)
```

Key properties:

- Exactly **one** `selectionchange` listener per editor instance, owned by
the sync plugin.
- Core holds the cached selection; consumers subscribe to change.
- Headless `new Editor()` consumers (tests, non-Angular hosts) can either
opt in to the sync plugin or call `editor.setSelection` manually.

## Phase 1 - Extract `getFormatIntersection` helper

Scope: pure refactor, zero API change, no new state.

Add to `libs/editor/src/lib/editor/core/selection.ts` (or beside
`text-format.ts`):

```ts
/**
 * AND the format bitfields of every TextNode touched by `range`, returning
 * the set of flags that are active across the *entire* range. A flag is
 * present only if every character in the range has it - matching the
 * toggle semantics of FORMAT_TEXT. Returns 0 for collapsed or invalid
 * ranges.
 */
export function getFormatIntersection(
  state: EditorState,
  range: TextRange,
): TextFormatBits;
```

Toolbar migration:

```ts
private refreshActiveFlags(): void {
  const range = this.readRange();
  if (!range || range.isCollapsed) {
    if (this.activeFlags !== 0) {
      this.activeFlags = 0;
      this.cdr.markForCheck();
    }
    return;
  }
  const bits = getFormatIntersection(this.runtime.editor.getEditorState(), range);
  if (bits !== this.activeFlags) {
    this.activeFlags = bits;
    this.cdr.markForCheck();
  }
}
```

Acceptance:

- `FormattingToolbarComponent` loses ~40 lines of node-walking.
- New unit tests in `core/selection.spec.ts` covering: collapsed range,
single-node range, multi-node range, cross-paragraph range, range with
missing keys (returns 0), backward range.
- All existing integration/unit tests continue to pass unchanged.

Risk: negligible. This is a pure function extraction.

## Phase 2 - `Editor` selection state + sync plugin

Scope: add cached selection to `Editor`, introduce `SelectionSyncPlugin`,
keep toolbar on its current DOM listener so we can dual-run and compare
during rollout.

### Additions to `Editor` (`libs/editor/src/lib/editor/core/editor.ts`)

```ts
class Editor {
  // New state
  private currentSelection: TextRange | null = null;
  private selectionListeners = new Set<SelectionListener>();

  getSelection(): TextRange | null;
  setSelection(range: TextRange | null): void;   // diffs by structural equality, notifies only on change
  registerSelectionListener(cb: SelectionListener): () => void;
}

type SelectionListener = (range: TextRange | null) => void;
```

Invariants:

- `setSelection` is idempotent: calling with a range structurally equal to
the current one does not notify.
- `setSelection(null)` is valid and represents "no selection" (focus lost,
selection moved outside the editor).
- Listeners fire **after** the cached selection is updated, so
`editor.getSelection()` inside a listener returns the new value.
- Listeners fire outside `editor.update()` transactions. If called during
an update, the notification is deferred to the end of the update pass
(same scheduling rule as `updateListeners`).

Expose these in `EditorPluginContext` as well, so plugins can read and
write selection without smuggling the `Editor` reference:

```ts
interface EditorPluginContext {
  // ... existing members ...
  getSelection(): TextRange | null;
  setSelection(range: TextRange | null): void;
  registerSelectionListener(cb: SelectionListener): () => void;
}
```

### Stale-selection handling

Structural mutations via `FORMAT_TEXT` (split/merge) or future commands can
invalidate the anchor/focus keys in the cached selection. Policy for V2:

- After `editor.update()` completes, if the cached selection references a
key that is no longer in `state.nodes`, call `setSelection(null)`
internally before notifying update listeners. The sync plugin's next
`selectionchange` event (fired by the browser as the DOM recomposes) will
refill the cache.
- No key remapping. That is a Lexical-style "selection reconciliation" pass
and belongs with undo/redo, not here.

### `SelectionSyncPlugin` (`libs/editor/src/lib/editor/plugins/selection-sync.plugin.ts`)

```ts
export const SelectionSyncPlugin: EditorPlugin = {
  key: 'core/selection-sync',
  setup(ctx) {
    let detachDomListener: (() => void) | null = null;

    const unregisterRoot = ctx.onRootElement((root) => {
      detachDomListener?.();
      detachDomListener = null;
      if (!root || typeof document === 'undefined') return;

      const onChange = () => {
        const sel = window.getSelection();
        const anchor = sel?.anchorNode;
        if (!anchor || !root.contains(anchor)) {
          ctx.setSelection(null);
          return;
        }
        ctx.setSelection(resolveDomSelection(ctx, window));
      };

      document.addEventListener('selectionchange', onChange);
      detachDomListener = () => document.removeEventListener('selectionchange', onChange);
    });

    return () => {
      detachDomListener?.();
      unregisterRoot();
    };
  },
};

export function provideSelectionSyncPlugin(): Provider {
  return providePlugin(SelectionSyncPlugin);
}
```

Notes:

- `root.contains(sel.anchorNode)` scopes the listener. Multiple editors on
one page each get their own plugin instance and each filters to its own
root.
- `document.removeEventListener` is reference-equal to the `add` call, so
Angular HMR root swaps detach cleanly via the `onRootElement` mount/unmount
cycle.
- No dependency on Angular in the plugin file itself (the provider helper
stays in the same file but consumers who want it headless can import
`SelectionSyncPlugin` directly).

### Automatic wiring via `EditorRuntimeService`

Opt-in **by default** for Angular: `EditorRuntimeService` auto-registers
`SelectionSyncPlugin`, mirroring how the runtime already wires the default
command handlers. Consumers who want a headless editor instantiate
`new Editor()` directly and either register the plugin themselves or push
into `setSelection` from their own code (e.g. tests).

### Dual-run validation

During Phase 2 the toolbar keeps its existing `selectionchange` listener.
Add a parallel listener on `editor.registerSelectionListener` that asserts
both paths agree, guarded behind a dev-only flag. Once green for one
milestone of real usage, Phase 3 removes the DOM listener from the toolbar.

Acceptance:

- New unit tests (`editor.spec.ts`) for `setSelection` / `getSelection`
idempotence, listener fire-on-change-only, listener unsubscribe.
- New unit tests for stale-selection invalidation after structural updates.
- New integration tests covering `SelectionSyncPlugin` with multiple editors
on one page and with programmatic DOM selections.
- Toolbar behavior unchanged from the user's perspective.

## Phase 3 - Toolbar consumes editor selection directly

Scope: delete DOM event handling from `FormattingToolbarComponent`;
subscribe to `editor.registerSelectionListener` instead.

Diff sketch:

```ts
constructor() {
  const unsubUpdates = this.runtime.editor.registerUpdateListener(() => this.refresh());
  const unsubSelection = this.runtime.editor.registerSelectionListener(() => this.refresh());
  this.destroyRef.onDestroy(() => { unsubUpdates(); unsubSelection(); });
}

private refresh(): void {
  const range = this.runtime.editor.getSelection();
  const state = this.runtime.editor.getEditorState();
  const bits = range && !range.isCollapsed ? getFormatIntersection(state, range) : 0;
  if (bits !== this.activeFlags) {
    this.activeFlags = bits;
    this.cdr.markForCheck();
  }
}
```

Also gone: `NgZone` injection, `typeof document !== 'undefined'` guards,
the manual `onSelectionChange` wrapper.

Acceptance:

- Toolbar shrinks to ~40 lines total.
- `formatting-integration.spec.ts` covers the end-to-end path
(DOM event -> plugin -> editor -> listener -> toolbar render).
- Selection-outside-editor no longer false-triggers the toolbar (the plugin
already filtered it out by scope).

## Possible follow-on work (do **not** schedule yet)

These are natural next steps that this design unlocks. Keeping them parked
so Phase 1-3 stay tight.

- `**FORMAT_TEXT_AT_SELECTION` command.** Convenience command that reads
`editor.getSelection()` and forwards to `FORMAT_TEXT`. Lets callers skip
resolving the range manually.
- **Selection on `EditorState` (Lexical parity).** Move `TextRange` into
`EditorState` as a versioned artifact. Serialize with snapshots.
Required once undo/redo lands, because history needs to restore caret
position. Also unlocks programmatic transforms that read "the current
selection" inside `editor.update()`.
- **Selection reconciliation pass.** When structural commands mutate nodes
under the current selection, remap anchor/focus to the nearest surviving
text offset. Depends on selection-on-state.
- **Public `SelectionResolver` interface.** Today `SelectionResolverHost`
is the narrow type used internally. We may want to publish a stable
version so custom adapters (non-Angular) can implement their own sync
plugins.

## Risks and edge cases


| Risk                                                          | Mitigation                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple editors on one page share `document.selectionchange` | Each plugin instance filters via `root.contains(sel.anchorNode)` and calls `setSelection(null)` when out of scope.                       |
| Stale keys in cached selection after split/merge              | Update pass nulls out the cache when keys disappear; DOM resync re-populates on the next tick.                                           |
| Core accidentally depends on DOM                              | Sync plugin is the **only** place the DOM is touched. `Editor.setSelection` takes a pre-resolved `TextRange` and does nothing DOM-aware. |
| SSR / non-browser hosts                                       | Plugin guards `typeof document`. Core itself never references `document`.                                                                |
| Angular HMR root swaps                                        | `onRootElement` already emits unmount -> mount; plugin detaches old listener and attaches a new one each swap.                           |
| Listener fires inside `editor.update()` transaction           | Deferred to end of update pass, matching `updateListeners` scheduling.                                                                   |
| Microtask storms during fast typing                           | `setSelection` de-dupes by structural equality, so only *actual* changes notify. Consumers that need debouncing can wrap their listener. |


## Open questions

Leave items here as you review; I'll roll them up into the design before
implementation begins.

- Should `setSelection` accept a `{ source: 'user' | 'programmatic' }`
tag so consumers can distinguish caret moves from `FORMAT_TEXT`-style
replays? (Needed for "scroll into view on user caret move, not on
programmatic" patterns.)
- Do we want to expose the cached selection via a read-only accessor on
`EditorPluginContext`, or require plugins to subscribe via
`registerSelectionListener` only?
- Should `SelectionSyncPlugin` be auto-registered by
`EditorRuntimeService`, or require explicit
`provideSelectionSyncPlugin()` like the formatting plugin does?
- Naming: `setSelection` vs. `updateSelection` vs. `commitSelection`.
Lexical uses `editor.update(() => { $setSelection(...) })`; we are
intentionally simpler here, but should we mirror the naming for
future-compat?
- Should `getFormatIntersection` live in `selection.ts`
(range-oriented) or `text-format.ts` (format-oriented)? Same function,
different mental model for the reader.

## Sequencing summary


| Phase | Touches                                       | Risk                     | Ships independently? |
| ----- | --------------------------------------------- | ------------------------ | -------------------- |
| 1     | `core/selection.ts`, toolbar                  | Very low                 | Yes                  |
| 2     | `core/editor.ts`, new plugin, runtime service | Medium (new API surface) | Yes                  |
| 3     | Toolbar only                                  | Low (relies on Phase 2)  | Yes                  |


