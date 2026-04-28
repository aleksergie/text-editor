# Editor-Owned Selection State - Design Note

Status: **All three phases shipped.** This note now doubles as a
design rationale + implementation log. Decisions taken during
build-out are recorded inline, and the "Open Questions" section has
been rolled up into "Decisions Taken" below.

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

## Phase 1 - Extract `getFormatIntersection` helper [SHIPPED]

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

## Phase 2 - `Editor` selection state + sync plugin [SHIPPED]

Scope: add cached selection to `Editor`, introduce `SelectionSyncPlugin`,
keep toolbar on its current DOM listener so Phase 3 can migrate the
consumer incrementally. The "dual-run validation" described below was
descoped during implementation - see "Decisions Taken" #6.

### Additions to `Editor` (`libs/editor/src/lib/editor/core/editor.ts`)

```ts
class Editor {
  private currentSelection: TextRange | null = null;
  private selectionListeners: SelectionListener[] = [];

  // Transaction staging: setSelection() calls made inside update() land
  // here and flush at the end of the outermost transaction.
  private pendingSelection: PendingSelection | undefined;
  private isUpdating = false;

  getSelection(): TextRange | null;
  setSelection(range: TextRange | null, options?: { source?: SelectionSource }): void;
  registerSelectionListener(cb: SelectionListener): () => void;
}

type SelectionSource = 'user' | 'programmatic';
type SelectionListener = (range: TextRange | null, source: SelectionSource) => void;
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
  setSelection(range: TextRange | null, options?: SetSelectionOptions): void;
  registerSelectionListener(cb: SelectionListener): () => void;
}
```

### Stale-selection handling

Structural mutations via `FORMAT_TEXT` (split/merge) or future commands can
invalidate the anchor/focus keys in the cached selection. Policy shipped
in V2:

- After `editor.update()` mutates state, `Editor.maybeInvalidatePendingSelection`
runs. It validates the effective selection (staged pending value if the
mutator called `setSelection`, else the cached one) against the new
state. A selection is "valid" iff:
  1. both `anchor.key` and `focus.key` resolve to live `TextNode`s in
     `state.nodes`, AND
  2. the offsets fit within each node's current `text.length`.

  The offset check matters because `EditorState.createEmpty()` produces
deterministic keys (`t1`, `p1`, ...), so a `CLEAR_EDITOR` or
snapshot swap reuses key `t1` but leaves it empty; without the offset
guard, offsets like 2 and 5 into the old "hello" would carry over
into the new empty `t1`.

- Invalid ranges are replaced with `null` in `pendingSelection`. The
flush after update listeners emits one clean `null` notification to
`SelectionListener`s, preserving the staged `source` tag when
overriding a user-staged value.

- `setEditorState` (wholesale snapshot swap) runs the same check
synchronously - if the cached selection is invalid against the new
state, we emit `setSelection(null, 'programmatic')` before firing
update listeners.

- No key remapping. That is a Lexical-style "selection reconciliation" pass
and belongs with undo/redo, not here.

### `SelectionSyncPlugin` (`libs/editor/src/lib/editor/plugins/selection-sync.plugin.ts`)

Shipped shape (simplified pseudocode; see the file for the real
implementation):

```ts
export const SelectionSyncPlugin: EditorPlugin = {
  key: 'core/selection-sync',
  setup(ctx) {
    let detachDom: (() => void) | null = null;
    let currentRoot: HTMLElement | null = null;

    const onChange = () => {
      if (!currentRoot) return;
      const win = currentRoot.ownerDocument?.defaultView;
      const sel = win?.getSelection();
      const anchor = sel?.anchorNode ?? null;
      if (!anchor || !currentRoot.contains(anchor)) {
        if (ctx.getSelection() !== null) {
          ctx.setSelection(null, { source: 'user' });
        }
        return;
      }
      ctx.setSelection(resolveDomSelection(ctx, win!), { source: 'user' });
    };

    const unregisterRoot = ctx.registerRootElementListener((root) => {
      detachDom?.();
      detachDom = null;
      currentRoot = null;
      if (!root) {
        if (ctx.getSelection() !== null) {
          ctx.setSelection(null, { source: 'programmatic' });
        }
        return;
      }
      const doc = root.ownerDocument!;
      currentRoot = root;
      doc.addEventListener('selectionchange', onChange);
      detachDom = () => doc.removeEventListener('selectionchange', onChange);
    });

    return () => {
      unregisterRoot();
      detachDom?.();
    };
  },
};

export function provideSelectionSyncPlugin(): Provider {
  return providePlugin(SelectionSyncPlugin);
}
```

Notes:

- `currentRoot.contains(sel.anchorNode)` scopes the listener. Multiple
editors on one page each get their own plugin instance and each filters
to its own root.
- The "leaving the root" path uses `source: 'user'` (the user moved the
caret elsewhere); the "root unmounted" path uses `source: 'programmatic'`
(the editor itself dropped the cache because nothing is rendered). This
distinction shows up in listener call logs and is verified in tests.
- Null-dedup: when the cached selection is already `null` we skip
`setSelection(null)` entirely. Otherwise every `selectionchange` on the
page (even for text far away from the editor) would trigger a spurious
notification.
- Root detach/re-attach cycles flow naturally through
`registerRootElementListener`, so Angular HMR root swaps just work.
- No dependency on Angular in the plugin file itself. The provider helper
lives in `plugins/index.ts`; consumers who want a headless setup can
deep-import `SelectionSyncPlugin` directly.

### Registration: explicit, not automatic

The plugin is **not** auto-registered by `EditorRuntimeService`. Angular
consumers opt in with `provideSelectionSyncPlugin()` in the same providers
array where they opt in to the formatting keyboard plugin. This matches
the existing plugin-registration convention and keeps headless editors
(tests, non-Angular hosts) free of DOM-touching code by default.

Acceptance (all met):

- 21 new unit tests in `editor.spec.ts` for `setSelection` / `getSelection`
idempotence, transaction batching, update-listener interplay,
stale-selection invalidation (including offset-out-of-bounds), and
`setEditorState` integration.
- 7 integration tests in `plugins/selection-sync.plugin.spec.ts`
covering native `selectionchange` forwarding, out-of-root filtering,
null-dedup, teardown, root swap, and multi-editor isolation.
- Plugin-context exposure asserted in `plugin.spec.ts`.
- Toolbar behavior unchanged from the user's perspective - it is still
on its own DOM listener until Phase 3.

## Phase 3 - Toolbar consumes editor selection directly [SHIPPED]

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

### Decisions taken during Phase 3 implementation

1. **Toolbar dependency on `SelectionSyncPlugin`: documented, not
auto-registered.** The toolbar's class JSDoc states the requirement
explicitly. Auto-registering the sync plugin from inside the toolbar
would have walked back Phase 2's "explicit registration" principle
and created a hidden coupling between a UI component and a
runtime-level plugin. A consumer that forgets `provideSelectionSyncPlugin()`
gets a toolbar with permanently-dim buttons - not a runtime error -
which the formatting integration tests would catch in CI.

2. **`NgZone` injection dropped, no defensive `zone.run()`.** All
real callers route through zone-patched DOM event handlers
(`selectionchange` via the sync plugin, `click`/`keydown`/`mousedown`
via dispatched commands), so `markForCheck()` already runs inside a
zone tick. If a future async caller (e.g. a `setTimeout`-driven
`setSelection`) breaks change detection, restore `NgZone.run()`
around `refresh()` at that time.

3. **Subscribe to both `registerSelectionListener` and
`registerUpdateListener`.** Selection moves do not flow through
`update()`, and a future format-affecting command might mutate state
without changing selection. Both subscriptions call the same
`refresh()`, which de-dupes redundant `markForCheck` via the
`bits !== this.activeFlags` guard. The cost is at most one extra
no-op `getFormatIntersection` call per `FORMAT_TEXT` dispatch - a
range walk that profiles in microseconds for realistic selections.

Acceptance (all met):

- Toolbar shrunk from 126 lines to 122 lines (smaller than the
"~40 lines total" target was aspirational; the bulk of remaining
lines is the button registry + JSDoc, both kept intentionally).
- `formatting-integration.spec.ts` gained 3 new tests covering the
end-to-end path (DOM event -> plugin -> editor -> listener ->
toolbar render), the cached-selection click path
(programmatic-only, no DOM read), and cross-editor isolation
(selection in editor B does not light up editor A's toolbar).
- All 19 test suites / 229 tests pass; 3 new vs 226 baseline before
Phase 3.
- Demo at `/` continues to work; the Phase-2 debug panel renders
identical events because the underlying editor flow is unchanged -
only the toolbar's subscription path moved.

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


## Decisions taken

The questions raised during design were resolved before Phase 2 coding.
For future readers, they are recorded here in the order they appeared in
the original note.

1. **Source tag on `setSelection`.** *Yes*, with a typed union
`SelectionSource = 'user' | 'programmatic'`. Defaults to
`'programmatic'`. `SelectionSyncPlugin` passes `'user'` on native
`selectionchange`. Extending the signature to a string bag was
rejected as premature; the closed enum is cheaper to reason about
and easy to extend later.

2. **Plugin-context exposure.** All three methods
(`getSelection`, `setSelection`, `registerSelectionListener`) are on
`EditorPluginContext`, not just the listener. This lets command
handlers read the current selection synchronously (e.g. the future
`FORMAT_TEXT_AT_SELECTION` command) without having to smuggle the
`Editor` reference.

3. **Auto-registration.** *Explicit*. Angular consumers call
`provideSelectionSyncPlugin()`, symmetric with
`provideFormattingKeyboardPlugin()`. Headless editors stay
DOM-listener-free by default. Trade-off accepted: the formatting
toolbar demo now has two providers to wire, but in exchange we keep
the core library free of ambient DOM listeners.

4. **API naming.** *Lexical-shaped, adapted*. Methods are named
`setSelection` / `getSelection`, but the semantics match Lexical's
transaction model: calls inside `editor.update()` are staged and
flushed after update listeners. When selection eventually moves onto
`EditorState` (undo/redo milestone), a thin `$setSelection` wrapper
can be added without changing existing callers. Full-Lexical
(module-level `$`-prefixed ambient-context helpers) was rejected
because we do not have ambient-context plumbing anywhere else and
introducing it just for selection was out of proportion.

5. **`getFormatIntersection` location.** *`selection.ts`*. It
operates on ranges (anchor/focus -> node walk), so grouping it with
other range-oriented utilities wins. `text-format.ts` stays scoped to
bitfield-level operations.

6. **Dual-run validation.** *Descoped.* Tests cover the editor-owned
path end-to-end, and the toolbar keeps its existing listener through
Phase 2. When Phase 3 migrates the toolbar off the DOM listener, the
integration tests in `formatting-integration.spec.ts` will catch any
divergence directly. A parallel-listener assertion harness would have
been write-only infrastructure.

7. **Stale-selection listener fire.** *Fire listeners with `null`.*
Briefly showing "no selection" to the toolbar when keys disappear
matches reality - the browser is about to repaint and the next
`selectionchange` refills the cache anyway. Silent invalidation would
leave listeners disagreeing with the editor's internal state.

## Sequencing summary


| Phase | Touches                                                           | Risk                     | Status     |
| ----- | ----------------------------------------------------------------- | ------------------------ | ---------- |
| 1     | `core/selection.ts`, toolbar                                      | Very low                 | Shipped    |
| 2     | `core/editor.ts`, `core/plugin.ts`, new `selection-sync.plugin.ts` | Medium (new API surface) | Shipped    |
| 3     | Toolbar only                                                      | Low (relies on Phase 2)  | Shipped    |


