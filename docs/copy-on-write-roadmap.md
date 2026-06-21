# Copy-on-Write Roadmap (PR-3)

Captures the design and phasing for adopting Lexical-style copy-on-write
node semantics. Drafted during the PR-2 review; not yet started.

## Status

**Not started.** Sequenced after PR-1 (committed as `5892fc6`) and PR-2
(in-flight on this branch). Resume here when ready to begin Phase A.

## Why This Exists

### What problem it solves

`EditorState.clone()` currently does a shallow Map clone (`new Map(this.nodes)`)
that shares `NodeBase` instances between `prev` and `next`. Any in-place
mutation of a node's `__first` / `__next` / `__parent` pointers is visible
to both states. Consequences:

- **The recursive reconciler in `Reconciler.reconcileChildren` cannot trust
  `prev.nodes.get(key).__first` to reflect the pre-mutation tree shape.** The
  PR-2 workaround uses `keyToDom` as the prev snapshot. Correct but indirect
  - documented in `docs/architecture.md` lines ~195-210 and in the reconciler's
  own jsdoc.
- **No basis for snapshot-based undo/redo.** A `prev` state captured by a
  consumer is silently mutated by the next transaction.
- **Update-listener payloads cannot safely carry prev state references.**
  Same root cause.
- **No path to time-travel debugging, transaction replay, or speculative
  state operations.**

Per-node COW (via `getWritable`) resolves all four by ensuring every node
mutation produces a fresh instance, leaving prev's references unchanged.

A fifth, orthogonal win comes from **container-level COW** via Lexical's
`GenMap`: `EditorState.clone()` currently does `new Map(this.nodes)` -
O(n) for a document with n nodes. With GenMap (which our roadmap adopts in
Phase A), `clone()` is O(1) for documents larger than 1000 nodes, because
the source and clone share storage until the first write triggers lazy
isolation. The two layers (container + per-node) are independent but pair
naturally.

### What it does NOT solve

- Current correctness. PR-2's reconciler works under shared instances; no
  test fails today because of this constraint.
- Performance for typical text editing. The recursive walk is already fast.
- Anything not gated on a stable `prev` snapshot.

### Why defer until now

COW's value is realized incrementally as features that consume `prev` land
(undo/redo, time-travel, transaction replay). Implementing it speculatively
means paying the full refactor cost without the test coverage those features
bring - a forgotten `getWritable()` call would be a silent correctness bug
with no consumer to surface it. Land COW when the first consumer is
imminent, not before.

## Lexical Reference

Lexical's COW story has **two orthogonal layers** that pair together:

1. **Container-level COW: `GenMap` + `cloneMap()`.** Makes
   `EditorState.clone()` O(1) for large docs by sharing storage between
   the source and clone until the first write triggers lazy isolation.
   Source: [`packages/lexical/src/LexicalGenMap.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical/src/LexicalGenMap.ts).
2. **Per-node COW: `getWritable()` + `static clone()` + `_cloneNotNeeded`.**
   Ensures every mutation produces a fresh `NodeBase` instance, leaving
   prev's references unchanged. Full reference:
   `docs/LEXICAL_ARCHITECTURE.md` §10 (Immutability & getWritable),
   lines ~1375-1646.

Either layer is useful alone; together they're Lexical's full COW story.

### Container-level (GenMap)

| Lexical symbol | Purpose |
|---|---|
| `cloneMap(map, minGenMapSize = 1000)` | Entry point. Three branches: source is GenMap → `map.clone()` (O(1)); plain Map below threshold → `new Map(map)` (GenMap overhead not worth it on small docs); plain Map above threshold → wrap in fresh GenMap. |
| `GenMap<K, V>` | Implements full `Map<K, V>` interface. Two-tier storage: `_old` (immutable snapshot) + `_nursery` (writes since last compaction). `TOMBSTONE = null` marks deletions in the nursery so iteration can skip them. |
| `_mutable: boolean` | Per-GenMap flag. `false` after a clone (shared storage); flipped to `true` lazily inside `getNursery()` after a fresh nursery is allocated. |
| `getNursery()` | Returns the nursery for in-place writes. If sharing with an ancestor, either compacts (when `_nursery.size * 2 > _size`) or shallow-copies. The lazy-isolation gate. |
| `compact(force?)` | Folds `_nursery` into a new `_old` snapshot. Triggered automatically when the nursery grows past half the total size; can be forced. |
| Iteration semantics | `entries()` walks `_old`, applying `_nursery` overrides per-key; then walks `_nursery` for keys not in `_old`. Native Map iteration order is preserved including the `delete; set` re-insertion behaviour. |

### Per-node (getWritable)

| Lexical symbol | Purpose |
|---|---|
| `getWritable()` | Per-node gate: if not already cloned this transaction, clone via `static clone` + `afterCloneFrom`, swap into nodeMap, mark dirty, return clone. |
| `getLatest()` | Returns canonical instance for a key by reading the active state. Needed because callers may hold stale references after a clone happened. |
| `static clone(node)` | Per-node-class factory producing a fresh instance with the same key. |
| `afterCloneFrom(prev)` | Copies properties the constructor didn't set (parent/next/prev links, format, custom fields). |
| `_cloneNotNeeded: Set<NodeKey>` | Per-transaction set tracking keys already cloned. Cleared at commit. |
| Module-level active editor/state globals | Set inside `editor.update(fn)`. `getWritable` reads them to find the current transaction context. |

Every mutating method in Lexical calls `getWritable()` first. `node.replace()`
calls it on five different nodes (replaced, replacement, parent, prev sibling,
next sibling).

### How the two layers interact

A mutation flows: caller invokes a mutator → mutator calls `node.getWritable()`
→ getWritable clones the NodeBase, calls `state.nodes.set(key, clonedNode)` →
the underlying GenMap's `set()` lazily isolates its nursery from sibling
clones via `getNursery()`. Prev's view of `state.nodes` continues to see the
*pre-mutation* NodeBase via `_old`; next's view sees the *cloned* NodeBase
via `_nursery`.

The reconciler benefit: under both layers, `prev.nodes.get(key).__first`
genuinely reflects the pre-mutation tree shape, retiring PR-2's
`keyToDom`-as-prev-snapshot workaround.

## Cost Analysis

### What it touches

- **New file `libs/editor/src/lib/editor/core/gen-map.ts`** (~200 lines,
  ported from Lexical with attribution) plus its spec.
- **`EditorState.clone()` in `state.ts`** - one-line swap from
  `new Map(this.nodes)` to `cloneMap(this.nodes)`.
- **~25 structural helpers in `libs/editor/src/lib/editor/core/state.ts`**
  (insertAfter, insertBefore, remove, replace, the split/merge/format-range
  operations) - each must route mutations through `node.getWritable()`.
- **Four node classes** (`NodeBase`, `ElementNode` + subclasses
  `RootNode` / `ParagraphNode`, `TextNode`) need `static clone()` and
  `afterCloneFrom()` implementations.
- **Public mutable fields** must become private (`TextNode.text` is currently
  `public text: string`) and route external access through methods that call
  `getWritable()`. Estimated ~10 spec files have direct `node.text = ...`
  patterns.
- **Editor / state transaction wrappers** (`editor.ts:update`, `state.ts`
  internal patterns) - must establish and tear down active context.
- **Tests that construct states outside any transaction** - need a
  `withActiveContext(state, fn)` helper for legitimate direct-mutation
  scenarios.
- **Reconciler tightening** - drop the `keyToDom`-as-prev-snapshot workaround
  in `Reconciler.reconcileChildren`; consume `prev.nodes.get(key).__first`
  directly.

### What it does NOT touch

- The `EditorState.clone()` signature: still returns `EditorState`. The
  underlying Map implementation transparently upgrades to GenMap above the
  threshold via the `Map<K, V>` interface our `NodeMap` type alias already
  expresses.
- The public `Editor` / `Reconciler` surface.
- Any plugin or UI code.
- ADR-004's dirty-tracking design.

### Headless-property regression

Module-level globals are a small ergonomic regression for headless
consumers (jsdom, SSR, Node). Today our editor core is pleasingly explicit
about state ownership (Layer 1 in `docs/architecture.md`). After COW, any
code that constructs a node and tries to mutate it without first
establishing an active context will fail (under strict Q1) or silently
no-op (under permissive Q1).

Lexical has the same property and works around it via setup helpers. Our
existing test fixtures (`buildState` in `reconciler.spec.ts`, similar in
`state.spec.ts`) will need wrapping for any test that wants to mutate the
constructed nodes directly.

## Open Decisions

These must be locked before Phase A. Recommendations are the author's; the
final answer comes from whoever picks this up.

### Q1 - Strictness of ambient context when missing

**Options:**
- **(a) Strict:** `getWritable()` throws `invariant(false, 'no active context')`
  if called outside an active transaction.
- **(b) Permissive:** `getWritable()` silently no-ops, returning the node
  unchanged.

**Recommendation: (a) strict.** Silent failure means a mutation succeeds at
the instance level but does not get cloned, recreating exactly the kind of
shared-state bug COW is meant to prevent. The test-setup helper in Phase F
covers legitimate direct-mutation scenarios explicitly. This matches Lexical.

### Q2 - Public field encapsulation scope (Phase D)

**Options:**
- **(a) Full encapsulation:** Convert all public mutable fields to private
  (`__` prefix) and route through methods that call `getWritable()`.
- **(b) Internal-only:** Leave existing public fields alone; trust internal
  callers in `state.ts` to use `getWritable()`.

**Recommendation: (a) full encapsulation.** Half-measures rot the COW
invariant - one forgotten `node.text = ...` somewhere outside `state.ts`
and you have a silent corruption bug. Cost: ~10 spec files need a one-line
change each.

### Q3 - `state.markDirty(key)` API under COW

**Options:**
- **(a) Preserve signature:** `state.markDirty(key: NodeKey)` stays; internally
  calls `getWritable()` on the node.
- **(b) Deprecate in favor of `node.markDirty()`:** matches the Lexical
  idiom of `markDirty()` being an alias for `getWritable()`.
- **(c) Both:** preserve `state.markDirty(key)` for the ~30 existing call
  sites, add `NodeBase.markDirty()` as the Lexical-aligned shortcut for
  code that already has a node reference.

**Recommendation: (c) both.** No churn for existing callers; new Lexical-style
shortcut available. They do the same thing internally.

## Phasing

Each phase is independently verifiable - `npx nx test editor` should be green
at the end of each. Phase boundaries are natural pause points for review.

### Phase A - GenMap container (independent of `getWritable`)

- New file `libs/editor/src/lib/editor/core/gen-map.ts`. Port verbatim
  from [`packages/lexical/src/LexicalGenMap.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical/src/LexicalGenMap.ts)
  with attribution comment at the top. Includes `GenMap<K, V>` class and
  exported `cloneMap<K, V>(map, minGenMapSize = 1000)` helper.
- Change `EditorState.clone()` in `state.ts`: replace
  `new Map(this.nodes)` with `cloneMap(this.nodes)`. One-line change.
- Add unit tests for `GenMap` (clone-isolation, compaction at threshold,
  TOMBSTONE iteration, native-Map semantic parity). Port Lexical's tests
  if available; otherwise write a focused suite.
- **Verifiable outcome:** `npx nx test editor` green. `EditorState.clone()`
  is O(1) for documents larger than 1000 nodes (verifiable via a benchmark
  test). No mutation-path behavior change because GenMap implements the
  full `Map<K, V>` interface and our existing `.set` / `.delete` calls in
  `state.ts` work unchanged.
- **Independent value:** This phase delivers the container-level COW win
  on its own. If the rest of PR-3 stalls, Phase A still ships.

### Phase B - `getWritable` infrastructure (no behavior change)

- Add `NodeBase.getWritable()`, `NodeBase.getLatest()`.
- Add `static clone(node)` and `afterCloneFrom(prev)` to each node class
  (`NodeBase`, `ElementNode`, `RootNode`, `ParagraphNode`, `TextNode`).
- Add `_cloneNotNeeded: Set<NodeKey>` to `EditorState`.
- No existing call site uses any of this yet. Tests pass unchanged.

### Phase C - Active-context globals

- New file `libs/editor/src/lib/editor/core/active-context.ts`:
  - `$setActiveContext(editor, state)`, `$clearActiveContext()`.
  - `$getActiveEditor()`, `$getActiveEditorState()`.
- Wire `$setActiveContext` / `$clearActiveContext` into `editor.ts:update`
  (and equivalent for `state.update` if separate).
- `getWritable()` starts consulting ambient context here.
- **Q1 lands here** (strict throw vs permissive no-op).

### Phase D - Migrate `state.ts` mutators

- Each of the ~25 structural helpers routes mutations through
  `node.getWritable()` before any `__field = ...` write.
- Bulk of the diff. Behavior preserved; tests still pass.
- `state.markDirty(key)` rewritten to use `getWritable()` internally per Q3.

### Phase E - Encapsulate public node fields

- `TextNode.text` becomes private `__text`; add `getText()` / `setText(text)`
  methods that go through `getWritable()`.
- Audit other public fields (`format` is already controlled via `setFormat`;
  `__type` is read-only; `__key` is read-only).
- Update spec files that did `node.text = '...'` to use the new methods.
  Estimated ~10 files.

### Phase F - Tighten the reconciler

- `Reconciler.reconcileChildren` now reads `prev.nodes.get(key).__first` for
  the true pre-mutation tree shape (no longer the post-mutation shared value).
- The `typeMatches` check in `reconcileChildren` becomes more accurate.
- `deleteKeyToDomSubtree` stays but its prev walk is now genuinely
  reading the pre-mutation subtree.
- Update the architecture-doc paragraph in `docs/architecture.md` (~lines
  195-210) - the "shared NodeBase instances" caveat becomes obsolete; replace
  with a brief mention of COW.

### Phase G - Tests

- Add `withActiveContext(state, fn)` helper for tests that mutate nodes
  outside an `editor.update` transaction.
- Update spec files: `reconciler.spec.ts`, `state.spec.ts`,
  `formatting.spec.ts`, `selection.spec.ts`, `editor.spec.ts`,
  `input-selection.spec.ts`, others as needed.
- Add new tests for COW invariants:
  - Mutating `next` does not affect `prev`.
  - Cloned-once-per-transaction: a key is only cloned once even when
    mutated multiple times in the same update.
  - `getWritable()` outside an active context throws (per Q1).
  - `getLatest()` returns the cloned instance after a mutation, not the
    pre-clone original.
  - GenMap interop: a state cloned from another state, then mutated, does
    not affect the original's view of `state.nodes`.

### Phase H - Docs

- **ADR-005 - Copy-on-Write Node Semantics.** Captures the decision, the
  rejected alternatives (shared mutable + keyToDom snapshot, deep-clone in
  `EditorState.clone`), and the consequences (headless property regression,
  the active-context invariant, GenMap threshold tuning).
- **CONTEXT.md** updates - new terms:
  - **Writable Node** - the cloned instance returned by `getWritable()`.
  - **Clone-not-needed** - the per-transaction set tracking already-cloned
    keys.
  - **Active Context** - the module-level binding established for the
    duration of an `editor.update` transaction.
  - **Latest Node** - the canonical current instance for a key, accessible
    via `getLatest()`.
  - **GenMap nursery / old snapshot** - GenMap's two-tier storage. Likely
    worth a "Storage" subsection rather than top-level terms.
- **`docs/architecture.md`** updates - replace the "shared NodeBase
  instances" paragraph in the lookup-maps section; add a "Copy-on-Write"
  subsection in the Reconciliation flow that covers both GenMap and
  `getWritable`.

## Sequencing Around PR-3

### Before

- **PR-1 (committed `5892fc6`).** Lexical-style dirty tracking. ADR-004.
  Establishes the vocabulary PR-3 builds on.
- **PR-2 (in-flight).** Recursive reconciler. Uses `keyToDom` as the prev
  snapshot - the workaround PR-3 will retire in Phase E.

### After

- **PR-4 - In-place DOM type-change replacement.** Originally planned as PR-3
  before scope shifted. Now trivial because Phase E gives `reconcileChildren`
  genuine prev/next semantics - the type-change branch becomes a
  `parentDom.replaceChild(newDom, oldDom)` plus `keyToDom` swap, ~20 lines.
- **Undo/Redo (future).** The first real consumer of stable `prev`
  snapshots. Validates the COW invariant in production by exercising it on
  every undo step.

## Cost Estimate

Multi-week work. Roughly the sum of PR-1 + PR-2 in scope:

- Phase A (GenMap): 1 day. Port from Lexical with attribution; one-line
  swap in `EditorState.clone`; write focused unit tests.
- Phase B (`getWritable` infrastructure): 1-2 days. Mostly mechanical.
- Phase C (active-context): 1 day. Small new file plus two wiring sites.
- Phase D (migrate `state.ts`): 3-5 days. Bulk of the diff; careful review
  per helper.
- Phase E (encapsulate public fields): 2-3 days. Touches several spec
  files; each is a small but manual edit.
- Phase F (reconciler tightening): 1 day. Localized to `reconciler.ts`.
- Phase G (tests): 2-3 days. Test helper plus per-spec migration plus new
  invariant tests.
- Phase H (docs): 1 day. ADR + doc updates.

**Total: 12-17 days.** Plan for two-and-a-half weeks if focused, longer if
interleaved with other work. Phase A is the natural stop-and-ship point if
the larger scope drifts - shipping just GenMap delivers a real perf win
for large-document use cases.

## Risks

- **Silent corruption from forgotten `getWritable()` calls.** Mitigated by
  Q1 strict mode + thorough Phase D review + Phase G's "prev unchanged
  after mutation" tests.
- **Test ergonomics regression.** `withActiveContext` adds boilerplate to
  every test that constructs and mutates a state directly. Acceptable cost.
- **Module-level globals interfering with multi-editor pages.** Lexical's
  single-active-editor model holds for us too (we never run multiple editor
  transactions simultaneously). Worth documenting in ADR-005.
- **Increased GC pressure.** Every transaction clones every mutated node.
  Lexical operates at this cost in production; should be fine for us.
- **GenMap threshold tuning (1000).** Inherited from Lexical. For documents
  smaller than 1000 nodes, `cloneMap` falls back to `new Map(map)` and
  GenMap is never instantiated. Our typical documents are well below this
  - Phase A's perf win is mostly future-facing. If we ever ship larger
  documents and find the threshold wrong, it's tuneable in one place.
- **GenMap iteration cost.** GenMap's `entries()` walks both `_old` and
  `_nursery`, which is marginally slower than native `Map` iteration. The
  per-write savings dominate for the workloads GenMap is meant for, but
  this is worth knowing if a profiler ever surfaces it.

## Resume Checklist

When picking this back up:

1. Confirm Q1, Q2, Q3 answers (or change them based on new context).
2. Read `LEXICAL_ARCHITECTURE.md` §10 in full.
3. Read [`LexicalGenMap.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical/src/LexicalGenMap.ts)
   in full. Phase A's implementation should track it closely.
4. Re-read PR-2's `Reconciler.reconcileChildren` and the architecture-doc
   paragraph it references - those are the pieces Phase F retires.
5. Start with Phase A (GenMap alone is shippable and unlocks the
   container-level win even if the rest of PR-3 stalls). Run `npx nx test
   editor` after each phase.
6. Draft ADR-005 in Phase H; update `CONTEXT.md` inline as new terms get
   resolved (don't batch).
