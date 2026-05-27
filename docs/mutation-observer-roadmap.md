# MutationObserver Defense Layer Roadmap

## Status

Future work. Not started. This note describes how to add a defensive
`MutationObserver` to the core editor so the model survives DOM writes that
the editor did not author: spell-check, autocorrect, IME composition,
default `contenteditable` behavior, and DOM-mutating browser extensions
(Grammarly, LanguageTool, 1Password, accessibility tooling).

The design mirrors the shape Lexical uses in `LexicalMutations.ts`. Where
Lexical's implementation is a good fit, copying it is preferable to
inventing a new shape; see `docs/input-selection-roadmap.md` for the broader
"copy Lexical when it fits" guidance.

This roadmap is structured so each phase is independently shippable and
implementable by a different agent. Phase 1 lays the scaffolding without
changing observable behavior; phases 2-5 add defensive behavior in
narrowly scoped slices.

## Why This Is Needed

The browser can change `contenteditable` DOM without asking us. Today,
nothing in the editor notices when that happens. The full inventory of
how a `contenteditable` gets corrupted from the outside is documented in
`docs/LEXICAL_ARCHITECTURE.md` [§3 "Why the MutationObserver?"](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps);
the short list relevant to this editor:

- **Spell-check / autocorrect.** Chrome, Edge, and Safari rewrite text
  inside `contenteditable` when a misspelling is accepted. The DOM text
  changes, the model does not.
- **IME composition.** Mobile keyboards (especially Android) and IMEs for
  CJK/Vietnamese commit composed text by mutating DOM after our `input`
  handler has run.
- **Browser extensions.** Grammarly, LanguageTool, 1Password, and
  accessibility tools inject wrapper elements, badges, and inline buttons
  into the editor root.
- **Default contenteditable behavior.** Some `beforeinput` types we
  `preventDefault` are still partially honored by the browser; paste,
  drag-and-drop, and certain Enter behaviors can bypass `beforeinput`
  entirely.
- **Future copy/paste and drag/drop.** Once paste handling lands, foreign
  HTML structures (`<font>`, `<o:p>`, MS Office wrappers) will leak in
  unless something strips them.

Without observation, these silently corrupt model<->DOM coherence. The
reconciler then computes diffs against a DOM it does not match, the
selection bridge resolves anchors that no longer map to known keys, and
formatting toggles operate on stale `TextNode.text`.

## Current Behavior

- `Reconciler` is the only intentional writer to the editor root. It
  maintains `keyToDom: Map<NodeKey, HTMLElement>` and
  `domToKey: WeakMap<Node, NodeKey>` for every host it creates plus its
  descendant tag stack (see `indexSubtree`).
- `bindEditorEvents` listens for `beforeinput` / `input` / `composition*`
  and routes through `BEFORE_INPUT_COMMAND`. Anything the browser does that
  does not flow through `beforeinput` is invisible to the editor.
- The v1 `placeCursorAtEnd` fallback collapses selection after a
  bridge-driven update, but does nothing for foreign mutations.
- `SelectionSyncPlugin` reads native selection on every `selectionchange`
  and resolves it via `keyForDomNode`. If the browser injected an unknown
  wrapper, `keyForDomNode` returns `null` and the selection is treated as
  outside the editor - the model survives but the UI loses the caret.

There is no DOM-defense layer.

## Lexical Reference Shape

`docs/LEXICAL_ARCHITECTURE.md` is the canonical reference for everything
in this roadmap. Read it first before starting any phase. The sections
that matter and what each one covers. When the summary is not enough,
compare against Lexical source:
[`LexicalMutations.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical/src/LexicalMutations.ts)
and
[`LexicalUpdates.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical/src/LexicalUpdates.ts).

| LEXICAL_ARCHITECTURE.md section | What it documents | Used by phase |
|---|---|---|
| [§2 Editor Initialization](LEXICAL_ARCHITECTURE.md#2-editor-initialization) - "initMutationObserver" step | When the observer is created, when it is first `observe()`d | Phase 1 |
| [§3 MutationObserver & WeakMaps](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps) - "Why the MutationObserver?" | The corruption sources we are defending against | This doc's "Why" section |
| [§3 MutationObserver & WeakMaps](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps) - "The Timing Contract" | The disconnect / write / observe loop, mutation-defense cleanup drains, and the `TEXT_MUTATION_VARIANCE = 100ms` Android guard | Phases 1, 2, 4 |
| [§3 MutationObserver & WeakMaps](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps) - body (`flushMutations` pseudocode) | The `characterData` vs `childList` branching, `isManagedLineBreak`, `reconcileObservedMutation`, the `badDOMTargets` queue | Phases 2, 3 |
| [§6 $commitPendingUpdates](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates) - Stage 2 (DOM Reconciliation) and Stage 6 (Selection) | Where exactly Lexical calls `observer.disconnect()` and re-arms via `initMutationObserver` on reconciler errors | Phases 1, 5 |
| [§11 Selection](LEXICAL_ARCHITECTURE.md#11-selection) - "Selection Lifecycle Diagram" | Why selection writes also need the observer paused (relevant when `input-selection-roadmap.md` lands a selection writer) | Phase 1 contract; future input-selection work |
| [§13 beforeinput Event](LEXICAL_ARCHITECTURE.md#13-beforeinput-event) - "Full Flow" | How `beforeinput` / `input` / `MutationObserver` interleave per keystroke | Phase 4 |

The pieces we want to copy:

1. **Disconnect / reconnect contract.** Lexical wraps every reconciler
   DOM write and every DOM selection write with `observer.disconnect()`,
   performs the write, then calls `observer.observe(...)` again. Mutation
   defense code that performs its own DOM cleanup drains `takeRecords()`
   after cleanup so those self-authored cleanup mutations are never handed
   back to the observer callback. See
   `LEXICAL_ARCHITECTURE.md` [§3 "The Timing Contract"](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps)
   and the disconnect calls in [§6 Stage 2 and Stage 6](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates).

2. **Two mutation kinds, two responses.** See the `flushMutations`
   pseudocode in [§3](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps).
   - `characterData`: browser changed text content (spell-check,
     autocorrect, IME). Resolve the affected `TextNode` from `domToKey`,
     read the new DOM text, and write it back into the model in a single
     transaction (Lexical calls this path `$handleTextMutation`).
   - `childList`: browser added or removed DOM nodes. Any added node not
     in `domToKey` and not a managed line break is removed
     (`isManagedLineBreak`). Any removed managed line break is restored.
     The owning model node is queued in `badDOMTargets` and run through
     `reconcileObservedMutation` at the end of the batch.

3. **`TEXT_MUTATION_VARIANCE = 100ms`.** Lexical tracks the timestamp of
   the last `textInput`-class event. If a `characterData` mutation
   arrives within 100ms of that timestamp, it is deferred to avoid
   fighting the IME on Android. This is an IME-coexistence guardrail,
   not a general debounce. See the note at the end of
   [§3 "The Timing Contract"](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps).

4. **Composition window.** While `compositionstart` / `compositionend`
   is in flight, mutations are buffered or skipped and reconciled at
   composition end. See [§13 "Full Flow"](LEXICAL_ARCHITECTURE.md#13-beforeinput-event)
   for the per-keystroke interleaving of `beforeinput`, `input`, and
   `MutationObserver`.

5. **Recovery path.** If the reconciler throws,
   `initMutationObserver(editor)` is re-armed before a full re-reconcile
   to recover from a torn state. See the error path in
   [§6 Stage 2](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates).

## Target Behavior

After this roadmap ships:

- `Editor.setRoot(root)` attaches a `MutationObserver` to `root` with
  `{ subtree: true, childList: true, characterData: true, characterDataOldValue: true }`.
- All `Reconciler` writes happen with the observer paused via a single
  helper on `Editor` (`runWithObserverPaused`). The helper disconnects,
  runs the DOM write, then resumes observation. It does not drain records
  by default because pending records may include real foreign mutations
  that arrived before the editor-owned write.
- The observer callback splits work by mutation kind:
  1. Resolve each mutation target to the nearest managed editor DOM pair
     via a narrow internal helper, not ad hoc ancestor walking.
  2. `characterData` mutations on known text nodes run inside one
     `editor.update()` transaction. They copy DOM text into
     `TextNode.text` and mark the node dirty so the next reconcile
     produces a consistent format-wrapper stack.
  3. `childList` mutations do not write `EditorState` by default. They
     run observer-paused DOM repair from the current source-of-truth
     state: remove unknown added nodes, restore managed nodes, and force a
     re-render of the affected subtree when needed.
  4. Mixed batches apply text updates first, then perform structural DOM
     repair.
- During IME composition or within `TEXT_MUTATION_VARIANCE` of the last
  `input` event, `characterData` mutations are deferred until the next
  safe point.
- `setRoot(null)` (and root swap) disconnects the observer and discards
  pending records.
- Multiple editors on one page do not share an observer; each owns its
  own and only sees mutations inside its own root.

## Desired Invariants

- **No self-mutation feedback loops.** Every reconciler DOM write and
  every mutation-defense DOM repair must run with the observer paused.
  Defense repairs drain `takeRecords()` after cleanup so their own
  mutations do not schedule another cleanup pass.
- **The observer never writes to the model outside an `editor.update()`
  transaction.** All model writes that originate from mutation handling
  go through the existing transaction surface, so update listeners and
  selection invalidation fire exactly once per batch.
- **Unknown DOM nodes never persist in the editor root.** Anything the
  observer sees added that is not registered in `domToKey` and is not a
  managed line break is removed in the same tick.
- **`domToKey` is the source of truth for "this DOM is ours."** The
  observer must not maintain a parallel registry of known nodes. Exact
  DOM ownership checks must use an exact `WeakMap` lookup; ancestor-walk
  lookup is reserved for selection and mutation-target resolution.
- **Composition correctness over speed.** When `isComposing` is true or
  the Android variance window is active, the observer prefers deferring
  mutation handling to corrupting IME state.
- **Per-editor isolation.** A mutation inside editor A never triggers the
  callback for editor B, even on the same `document`.
- **Same-clock IME timing.** The Android variance guard must compare
  timestamps from the same clock source. Do not subtract `event.timeStamp`
  from `Date.now()`.
- **Recovery without leaking listeners.** If the observer callback throws,
  the observer is re-armed and the editor falls back to a full re-render
  of the current `EditorState`.

## Implementation Direction

Five phases. Each is independently shippable and adds a narrow set of
files. The risk of regression is concentrated in phases 3 and 4; phases 1,
2, and 5 are each small and well-scoped.

Recommended cross-roadmap order:

1. Ship **this roadmap's Phase 1** first. It adds the observer
   pause/resume contract and exact DOM lookup helpers without changing
   editing behavior.
2. Ship `docs/input-selection-roadmap.md`. Its DOM selection writer
   should use the Phase 1 `runWithObserverPaused` helper so selection
   writes do not trigger observer feedback.
3. Return to **this roadmap's Phases 2-5**. Text mutation sync,
   childList defense, IME variance handling, and recovery are easier to
   implement once selection writes have a stable model/DOM contract.

If the input-selection roadmap ships before this Phase 1, retrofit its
DOM selection writer to use `runWithObserverPaused` as soon as Phase 1
lands.

### Phase 1 - Scaffolding And Reconciler Pause Contract

Goal: introduce the observer infrastructure without any defensive
behavior. The observer logs mutations for debugging only; the editor runs
unchanged.

Lexical reference:
[§2 Editor Initialization "initMutationObserver" step](LEXICAL_ARCHITECTURE.md#2-editor-initialization)
for when the observer is created vs first `observe()`d, and
[§6 $commitPendingUpdates Stage 2](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates)
for the disconnect-before-reconcile pattern. Lexical also disconnects
the observer in Stage 6 around its DOM selection writer; our editor has
no selection writer today, but `docs/input-selection-roadmap.md` will
add one. **`runWithObserverPaused` must be designed so the future
selection writer can call it the same way the reconciler does.** Phase 1
should land that helper as a public-on-`Editor` (but unexported)
primitive that takes any zero-arg callback.

Files to add or change:

- **New:** `libs/editor/src/lib/editor/core/dom-observer.ts`
  - `class DomObserver` with `start(root)`, `stop()`, `pause()`,
    `resume()`, `drain()` methods.
  - Wraps a native `MutationObserver` with options
    `{ childList: true, subtree: true, characterData: true, characterDataOldValue: true }`.
  - `pause`/`resume` are reference-counted so nested pauses are safe.
  - `pause` calls `observer.disconnect()`; `resume` calls
    `observer.observe(root, options)`. `drain` calls
    `observer.takeRecords()` and discards the result. Use `drain` after
    mutation-defense cleanup, not after every reconciler write.
  - Takes a callback `(mutations: MutationRecord[]) => void` invoked when
    the observer fires and the pause counter is zero.

- **Change:** `libs/editor/src/lib/editor/core/editor.ts`
  - Add a private `DomObserver` instance owned by `Editor`.
  - In `setRoot(root)`, after `reconciler.mount`, call
    `observer.start(root)`.
  - On `setRoot(null)` or root swap, call `observer.stop()`.
  - Wrap all calls to `reconciler.mount` and `reconciler.update` with a
    private helper `runWithObserverPaused(fn)`:
    ```ts
    private runWithObserverPaused<T>(fn: () => T): T {
      this.observer.pause();
      try {
        return fn();
      } finally {
        this.observer.resume();
      }
    }
    ```
  - Add an internal `drainObserverRecords()` helper for mutation-defense
    cleanup paths that intentionally remove or restore DOM nodes.
  - For phase 1, the observer callback is a no-op (or a `console.debug`
    behind a module-local `DEBUG_OBSERVER` flag). No model writes.

- **Change:** `libs/editor/src/lib/editor/core/reconciler.ts`
  - Add exact DOM lookup APIs:
    - `keyForExactDomNode(node: Node | null): NodeKey | null` returns
      `domToKey.get(node) ?? null` and does not walk ancestors.
    - `isManagedDomNode(node: Node | null): boolean` returns whether the
      exact DOM node is registered.
  - Add nearest managed pair API for mutation-target resolution:
    - `nearestManagedDomPair(node: Node | null): { dom: HTMLElement; key: NodeKey } | null`.
    - Walk ancestors until a registered DOM host or root is found.
    - Do not use this helper to classify `addedNode`; use exact lookup
      for added/removed DOM ownership.

- **New tests:** `libs/editor/src/lib/editor/core/dom-observer.spec.ts`
  - Pause/resume reference counting.
  - `drain()` discards records produced by mutation-defense cleanup.
  - Observer fires for foreign mutations after `start()`.
  - Observer stops firing after `stop()`.

Acceptance:

- `npx nx test editor` is green.
- No behavior change in the demo app at `/` or `/plain`.
- The observer is verifiably attached: a manual
  `root.appendChild(document.createElement('div'))` in a jsdom test causes
  the observer callback to fire.
- Reconciler-produced mutations never reach the callback (verify by
  spying on the callback while running `editor.dispatchCommand(SET_TEXT_CONTENT, 'x')`).
- Exact lookup distinguishes foreign children from managed ancestors: an
  injected node inside a known text host returns `null` from
  `keyForExactDomNode` even though `keyForDomNode` / nearest pair can
  resolve the host.

### Phase 2 - CharacterData Handling

Goal: handle text mutations from spell-check and autocorrect. Structural
mutations (childList) are still ignored.

Lexical reference: the `characterData` branch in the `flushMutations`
pseudocode in [§3 MutationObserver & WeakMaps](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps).
Lexical's equivalent of `setTextNodeText` is `$handleTextMutation`, which
also normalizes the affected `TextNode` (`shouldFlushTextMutations`
gating). Our V2 has no equivalent gate yet; the simpler unconditional
write is fine until the IME / variance handling lands in phase 4.

Files to add or change:

- **`libs/editor/src/lib/editor/core/nodes/text-node.ts`**
  - Export the existing `getInnermostTextHolder(host)` helper so the
    observer can read the current DOM text of a `TextNode` host without
    re-implementing the tag-stack walk.

- **`libs/editor/src/lib/editor/core/state.ts`**
  - Add a method `setTextNodeText(key: NodeKey, text: string): void` that
    updates `TextNode.text` in place and marks the node dirty. Callable
    inside `editor.update`. Intentionally narrower than `insertText` and
    `setText` so the observer cannot accidentally rewrite structure.

- **New:** `libs/editor/src/lib/editor/core/dom-mutations.ts`
  - `function handleCharacterDataMutation(editor: Editor, mutation: MutationRecord): void`
    - Resolve `mutation.target` with `editor.nearestManagedDomPair`.
    - If the resolved node is not a `TextNode` in current state, return.
    - Read current DOM text via `getInnermostTextHolder(host)`.
    - If DOM text differs from `TextNode.text`, call
      `editor.update((state) => state.setTextNodeText(key, newText))`.
  - `function flushMutations(editor: Editor, records: MutationRecord[]): void`
    - For each record with `type === 'characterData'`, call
      `handleCharacterDataMutation`.
    - For each `childList` record, no-op for phase 2 (log a TODO in debug
      mode).
    - Batch multiple `characterData` mutations into a single
      `editor.update` callback when they target the same model key, so
      one transaction covers them all.

- **Change:** `libs/editor/src/lib/editor/core/editor.ts`
  - Set the observer callback to `flushMutations`.
  - Add `private inputEventTimeStamp = 0` and
    `getLastInputTimeStamp(): number`. Fed by `bindEditorEvents` on every
    `input` event. Used by phase 4; phase 2 records the value but does
    not consume it.

- **New tests:** `libs/editor/src/lib/editor/core/dom-mutations.spec.ts`
  - Call `flushMutations` directly with hand-rolled `MutationRecord`-like
    objects (jsdom supports `MutationObserver` for `characterData`, but
    direct invocation isolates the observer plumbing from the handler
    logic).
  - Spell-check style: change inner text node's `nodeValue` directly,
    expect `state.getText()` to reflect the new value after the callback.
  - No-op when DOM text matches model text.
  - No-op when the mutated DOM is outside any registered host.
  - Single `editor.update` call when two mutations target the same
    `TextNode`.

Acceptance:

- `npx nx test editor` is green.
- Manual demo: with Chrome's spell-check enabled, accepting a correction
  updates `editor.getEditorState().getText()`.
- Selection cache stays valid (or is invalidated cleanly via the existing
  `maybeInvalidatePendingSelection` path) after a characterData write.

### Phase 3 - ChildList Defense

Goal: revert structural mutations that did not come from the reconciler.

Lexical reference: the `childList` branch in the `flushMutations`
pseudocode in [§3 MutationObserver & WeakMaps](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps).
Note Lexical's two-step pattern: per-mutation revert/restore inline, then
a deferred pass over `badDOMTargets` that runs
`reconcileObservedMutation` once per affected model node. Our conservative
strategy collapses both steps into a single "rebuild the document from
state" call, which is correct but coarser. Upgrade to the per-host
pattern only if profiling shows the coarse approach is too expensive
(see open question #3).

Recommended strategy: **conservative full subtree re-render** rather than
precise additive/removable diffs. Detecting "this removed node used to be
ours" after the fact is unreliable (the `WeakMap` entry persists until GC
but the record itself does not preserve the key). A full re-render is
correct, easy to test, and acceptable because foreign childList mutations
are rare relative to keystrokes.

Files to add or change:

- **`libs/editor/src/lib/editor/core/reconciler.ts`**
  - Expose a narrow method `reconcileFromScratch(rootEl, state): void`
    that delegates to the existing private `render` path. The observer
    uses this to restore the DOM after any childList disturbance.
    Existing `update` and `mount` keep their semantics.

- **`libs/editor/src/lib/editor/core/dom-mutations.ts`**
  - Add `function handleChildListMutation(editor: Editor, mutation: MutationRecord): { needsFullRerender: boolean }`:
    - Resolve `mutation.target` with `editor.nearestManagedDomPair`. If
      the target is not inside managed editor DOM, ignore the mutation.
    - For each `addedNode` in the record:
      - If `editor.keyForExactDomNode(addedNode) === null` and the added
        node is not a managed line break (see phase 3 open question),
        remove it from its current parent via `addedNode.remove()`.
      - Do not use ancestor-walking `keyForDomNode` to classify added
        nodes. An extension node injected inside a managed host must still
        count as foreign.
    - For each `removedNode` in the record:
      - Do not inspect `removedNode.parentNode`; after removal it is
        usually `null`.
      - If the removed node is not a managed line break and
        `mutation.target` resolved to a managed editor DOM pair, set
        `needsFullRerender = true`.
  - Update `flushMutations` to collect `needsFullRerender` across all
    childList records in the batch. If any returned `true`, call
    `editor.reconcileFromScratch()` once at the end.
  - All DOM writes performed by childList defense run inside
    `editor.runWithObserverPaused(...)`: removing unknown nodes,
    restoring managed nodes, and full `reconcileFromScratch`.
  - After childList defense writes to DOM, call
    `editor.drainObserverRecords()` to discard cleanup records produced
    by the defense path.

- **`libs/editor/src/lib/editor/core/editor.ts`**
  - Add a private `reconcileFromScratch()` method that wraps
    `reconciler.reconcileFromScratch(this.root, this.state)` with
    `runWithObserverPaused`. Used only by the mutation handler.

- **New tests** (extend `dom-mutations.spec.ts`):
  - Browser injects a `<font>` wrapper inside a paragraph host - the
    observer removes it without touching the model.
  - Browser injects a `<br>` at the end of a paragraph (autocorrect
    behavior) - the observer removes it.
  - Browser removes a `TextNode`'s outer `<span>` - the observer triggers
    a full re-render that restores it; `editor.getEditorState()` is
    unchanged.
  - Browser removes a registered node and `removedNode.parentNode` is
    `null` - the observer still detects the managed `mutation.target` and
    triggers a full re-render.
  - Extension injects a sibling element outside any text node host - the
    observer removes it.
  - Extension injects an element inside a managed text host - exact lookup
    treats the injected element as foreign and removes it.
  - Mixed batch (one characterData + one childList) - text mutation
    applies and re-render still runs.

Acceptance:

- `npx nx test editor` is green.
- Demo: manual `root.appendChild(document.createElement('script'))` in
  DevTools is reverted in the same tick.
- Pasting plain text into the editor (default browser behavior) does not
  leave residual wrappers in the DOM.

### Phase 4 - Composition And Android Variance Guard

Goal: don't fight the IME.

Lexical reference:
[§3 "The Timing Contract"](LEXICAL_ARCHITECTURE.md#3-mutationobserver--weakmaps)
for the `TEXT_MUTATION_VARIANCE = 100ms` constant and Android rationale,
and [§13 "Full Flow"](LEXICAL_ARCHITECTURE.md#13-beforeinput-event)
for the exact per-keystroke ordering of `beforeinput` -> input -> the
observer callback. Note Lexical wires the variance timer to the
`window.addEventListener('textInput', updateTimeStamp, true)` capture
registered in [§2's initMutationObserver step](LEXICAL_ARCHITECTURE.md#2-editor-initialization);
our editor does not capture `textInput`, so we record `performance.now()`
when the `input` event fires. The variance check must use the same clock
source; do not compare `Date.now()` to `event.timeStamp`.

Files to change:

- **`libs/editor/src/lib/editor/core/dom-mutations.ts`**
  - Add `const TEXT_MUTATION_VARIANCE = 100;`
  - In `flushMutations`, skip `characterData` handling when either:
    - `editor.isComposing()` returns `true`, OR
    - `performance.now() - editor.getLastInputTimeStamp() < TEXT_MUTATION_VARIANCE`.
  - When deferred, push the records into a module-local
    `pendingDeferredRecords` queue keyed by `editor` identity. Schedule a
    `setTimeout(retry, TEXT_MUTATION_VARIANCE)` to retry. On
    `compositionend`, drain immediately.
  - ChildList handling is **not** deferred; structural defense runs
    regardless of composition state.

- **`libs/editor/src/lib/editor/core/editor.ts`**
  - Expose `isComposing(): boolean` driven by a private flag.
  - Expose `getLastInputTimeStamp(): number` driven by a private number
    recorded from `performance.now()`.
  - Both are intentionally observer-internal helpers. Do not export them
    from the package barrel.

- **`libs/editor/src/lib/editor/core/editor-events.ts`**
  - Move the `isComposing` closure variable onto the `Editor` instance
    (via a new internal setter or by writing to a private field directly
    if the file already has access).
  - On `input` (or a future `textInput` capture listener), record
    `performance.now()` into the editor's `inputEventTimeStamp`.
    Do not mix `Date.now()` with `event.timeStamp`.
  - On `compositionend`, call `flushMutations(editor, [])` (or expose a
    `flushDeferredMutations` hook) so any deferred records replay
    immediately.

- **New tests:**
  - Synthetic `characterData` mutation while `isComposing` is true is
    deferred; flushed at `compositionend`.
  - Synthetic mutation arriving within 100ms of a recorded input is
    deferred and replayed after the variance window expires (use
    fake timers).
  - The variance check uses one clock source; a test should fail if
    `Date.now()` epoch milliseconds are compared to an event timestamp.
  - Synthetic mutation outside the window is handled immediately.
  - Childlist mutation during composition is handled immediately (not
    deferred).

Acceptance:

- `npx nx test editor` is green.
- Existing composition tests in `editor-events.spec.ts` still pass.
- Manual IME smoke test (e.g., macOS Japanese input or Android Gboard
  emulator) does not double-insert text and does not leave the model out
  of sync after composition ends.

### Phase 5 - Recovery And Teardown Polish

Goal: make the defense layer robust to its own bugs.

Lexical reference: the error-recovery branch of
[§6 $commitPendingUpdates Stage 2](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates)
which calls `initMutationObserver(editor)` and forces
`_dirtyType = FULL_RECONCILE` after a reconciler throw. Our equivalent
is `observer.stop()` + `observer.start(this.root)` followed by
`reconcileFromScratch()`.

Files to change:

- **`libs/editor/src/lib/editor/core/editor.ts`**
  - Wrap the observer callback in `try`/`catch`. On exception:
    - Log via `console.error` (the editor has no public error hook yet
      - see open question #4).
    - Call `observer.stop()` then `observer.start(this.root)` to re-arm.
    - Call `this.reconcileFromScratch()` so DOM matches the current
      `EditorState`.
  - Ensure `setRoot(null)` always disconnects the observer even if a
    prior callback threw or the observer is mid-pause.

- **`libs/editor/src/lib/editor/core/dom-observer.ts`**
  - On `stop()`, call `drain()` before disconnecting so a final burst
    does not slip through after teardown.
  - On `start()`, reset the pause counter to zero (defensive against a
    teardown that left the counter inconsistent).

- **New tests:**
  - Force the observer callback to throw once (e.g., via a spy that
    throws on first call, succeeds on second). Assert that:
    - The next foreign mutation is still observed.
    - `editor.update(...)` still reconciles correctly.
    - The DOM matches the model after the throw.
  - `setRoot(null)` removes the observer; subsequent `appendChild` on the
    detached root does not throw and does not schedule editor work.
  - Root swap (set root A, set root B) detaches A's observer and only
    observes B going forward.

Acceptance:

- `npx nx test editor` is green.
- A simulated callback exception does not leave the editor in a torn
  state: subsequent typing works, formatting works, selection sync works.

## Testing Strategy

Across phases, prefer these test shapes:

- **Unit tests** for `DomObserver` (pause/resume/drain accounting) and
  for `flushMutations` (called directly with hand-rolled `MutationRecord`s,
  no real `MutationObserver` needed). Direct invocation keeps the
  handler-logic spec isolated from observer plumbing.
- **Integration tests** in `core/editor.spec.ts` that mount a real
  contenteditable in jsdom, mutate the DOM directly, and observe model
  effects via `editor.getEditorState()`.
- **Selection regression tests** to confirm mutations do not leave
  `Editor.getSelection()` pointing at gone keys. The existing stale-key
  invariants in `docs/selection-state-design.md` cover the assertions; no
  new selection plumbing should be required.
- **Multi-editor tests** mirroring `plugins/selection-sync.plugin.spec.ts`
  to confirm one editor's mutations do not flow to another.

For each phase, add the spec file before changing implementation files.
All tests run under jsdom; no real-browser harness is required.

## Open Questions

These should be resolved by the agent picking up phase 1 before phase 2
starts. Capture decisions in this doc inline (the same pattern
`docs/selection-state-design.md` uses).

1. **Plugin vs core placement.** Phase 1 puts the observer in core,
   mirroring ADR-002's reasoning for input listeners (the disconnect /
   reconnect contract is tightly coupled to `Reconciler.update`).
   Confirm the same reasoning applies, or write a follow-up ADR if the
   observer should live in a `DomDefensePlugin` instead.
2. **Managed line breaks.** Lexical's defense distinguishes "managed
   `<br>`" from "foreign `<br>`". We do not yet have managed line breaks
   (`LineBreakNode` is not implemented). Phase 3 treats every
   unregistered node as foreign. Document this and re-open when
   `LineBreakNode` lands.
3. **Re-reconcile granularity.** Phase 3 recommends the conservative
   "full re-render via `reconcileFromScratch`" path. Confirm or upgrade
   to a per-host rebuild strategy after profiling. The precise strategy
   requires a `WeakSet<Node>` of currently-rendered DOM nodes updated by
   `Reconciler.registerDom` and cleared on full render.
4. **Error surface.** Phase 5 logs via `console.error`. The editor has
   no public error hook today. Decide whether to add an `onError`
   listener as part of this roadmap or defer to a separate effort.
5. **Paste interaction.** When paste handling lands, decide whether the
   observer's childList defense is sufficient to strip foreign wrappers
   or whether paste needs its own normalizer running before the
   observer sees the mutation.
6. **Unmanaged DOM opt-out.** Lexical has `isDOMUnmanaged` so decorations,
   autocomplete ghosts, or extension-rendered overlays can live inside
   editor DOM without being removed. We do not support unmanaged DOM yet.
   Phase 3 may remove all unknown nodes, but before adding suggestions,
   decorators, or autocomplete ghost text, add an unmanaged marker API.
7. **Selection restore after structural repair.** Lexical snapshots
   selection before childList repair and restores it after cleanup. Until
   `docs/input-selection-roadmap.md` lands the DOM selection writer,
   childList repair should rely on existing stale-selection invalidation.
   Once the writer exists, childList repair should preserve editor-owned
   selection and write it back after observer-paused DOM repair.

## Relationship To Other Work

- `docs/LEXICAL_ARCHITECTURE.md` is the canonical reference for every
  decision in this roadmap. Each phase above cites the specific section
  that documents the behavior being copied. When in doubt, the Lexical
  source-of-truth wins; deviations from the reference shape should be
  recorded inline in this file (the same pattern
  `docs/selection-state-design.md` uses for "Decisions Taken").
- `docs/input-selection-roadmap.md` is independent in scope but shares
  the disconnect/reconnect contract. The observer protects the DOM
  regardless of how input commands are routed. **When the input-selection
  roadmap lands its DOM selection writer (its "step 3"), that writer
  must also run inside `runWithObserverPaused`** - this is what
  `LEXICAL_ARCHITECTURE.md` [§6 Stage 6](LEXICAL_ARCHITECTURE.md#6-commitpendingupdates)
  does. Phase 1 of this roadmap is responsible for shipping the helper
  in a shape that supports both callers.
- ADR-002 (`docs/decisions/ADR-002-editor-owns-input-listeners.md`)
  narrowed "no DOM listeners in core" to permit input listeners. Phase 1
  likely narrows it again for `MutationObserver`. A new ADR is
  appropriate when phase 1 ships.
- `docs/selection-state-design.md` already handles stale-key
  invalidation. The observer should not need to touch the selection
  cache directly; running its writes through `editor.update` triggers
  the existing invariants.
- `docs/architecture.md` "System Properties Worth Preserving" needs an
  update after phase 1 to mention the observer alongside the input
  listeners.
