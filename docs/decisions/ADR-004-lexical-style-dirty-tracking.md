# ADR-004: Lexical-Style Dirty Tracking with Bubble-Up

## Status

Accepted

## Date

2026-06-15

## Context

Reconciliation runs on every editor transaction. The previous design held a
single flat `dirtyNodes: Set<NodeKey>` and forced the reconciler to walk the
entire document twice per commit (`getRenderOrder` + `isSameOrder`) before
touching any dirty node, just to detect whether structure had changed. Pure
text edits paid an O(document) cost per keystroke for a check that was almost
always a no-op.

The roadmap also calls for Phase 4 mutation defense, which needs to walk from a
mutated DOM node up to the nearest model-owned element and apply targeted
reconciliation. That work wants per-element membership tests on the dirty set
- exactly the shape the flat set cannot provide.

## Decision

`EditorState` adopts Lexical's three-collection dirty model
([LEXICAL_ARCHITECTURE.md §8](../LEXICAL_ARCHITECTURE.md#8-dirty-tracking--subtreetextcontent)):

- `dirtyLeaves: Set<NodeKey>` for `TextNode` and future leaf kinds.
- `dirtyElements: Map<NodeKey, boolean>` for `ElementNode`. The boolean
  separates **intentional** dirt (`true` - the element itself changed) from
  **bubble** dirt (`false` - exists so the reconciler walks through this
  ancestor to reach a dirty descendant).
- `dirtyType: 0 | 1 | 2` (`NO_DIRTY_NODES | HAS_DIRTY_NODES | FULL_RECONCILE`).
  Phase 1 only ever sets `NO_DIRTY_NODES` or `HAS_DIRTY_NODES`;
  `FULL_RECONCILE` is reserved for Phase 4.

`markDirty(key)` is the single mutation entry point. It dispatches by node
kind via `$isElementNode`, then walks the parent chain marking each ancestor
with `false` (bubble). The walk stops at the first already-marked ancestor -
an invariant maintained by `markDirty` being the only writer.

`getDirtyNodeKeys()` keeps its name but narrows its return to **intentional
dirt only** (`dirtyLeaves` plus elements whose entry is `true`). This is the
contract update listeners and external observers consume; bubble entries stay
internal to the reconciler. Two new accessors expose the raw collections to
the reconciler in PR-2: `getDirtyLeaves()` and `getDirtyElements()`.

## Alternatives Considered

### Flat dirty set with a `hasStructuralDirt` predicate

Rejected. Solved the per-keystroke `getRenderOrder` cost but left the
`keyToDom` stale-entry leak unaddressed and offered no path for Phase 4's
locality requirements. The predicate was a one-place patch; the underlying
asymmetry (no per-element introspection) remained.

### Slim split without `dirtyType`

Rejected. `dirtyType` is the cleanest contract for "did this transaction
touch anything reconcilable?" - `NO_DIRTY_NODES` lets the reconciler exit
before any map lookups. Matching Lexical verbatim also keeps the
`LEXICAL_ARCHITECTURE.md` reference doc usable as a single source of truth
for the dirty-tracking design.

## Consequences

- `markDirty` becomes the single invariant-maintaining writer. Any future
  shortcut that mutates the dirty collections directly must preserve the
  "ancestors of any dirty node are themselves marked" property.
- `getDirtyNodeKeys()` semantics tighten. All existing call sites benefit
  (update-listener payloads no longer risk leaking bubble parents) and none
  required modification.
- `FULL_RECONCILE` is reserved but has no producer in PR-1. Phase 4 mutation
  defense owns its first use; reading code that finds `dirtyType === 2`
  inside `state.ts` will not encounter it until that phase lands.
- The reconciler consumes `getDirtyLeaves()` / `getDirtyElements()` to drive
  a recursive walk gated on `dirtyElements.has(key)`. `getDirtyNodeKeys()`
  remains the public surface for update listeners; the raw accessors are
  for the reconciler only and should not be exported beyond core.
- A same-key model type change (e.g. swapping a TextNode for a ParagraphNode
  under the same `NodeKey`) is not produced by any `state.ts` helper and is
  documented as supported only insofar as the reconciler must not crash.
  PR-3 will add in-place DOM replacement for this case.
