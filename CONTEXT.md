# Editor

A Lexical-inspired rich-text editor. The model is a doubly-linked tree of
typed nodes; the DOM is treated as a derived, reconciled view of the model.
This document pins down the vocabulary used in core (`libs/editor/src/lib/editor/core/`).

## Language

### Reconciliation

**Reconciler**:
The DOM writer that translates an `EditorState` transition into the minimum
DOM mutations needed to bring the rendered tree in line with the new state.
_Avoid_: renderer, diff engine.

**Reconciliation**:
The act of running the reconciler against a prev/next state pair.
_Avoid_: re-render (which implies wholesale replacement; the reconciler only
re-renders as a fallback).

**Render Order**:
The flat, depth-first sequence of `NodeKey`s the reconciler would write into
the DOM, in document order. Mismatch between prev and next render order is
the reconciler's structural-change fallback signal.
_Avoid_: render list, key order.

### Dirty Tracking

**Dirty Leaf**:
A `TextNode` (or future `LineBreak`/`Decorator`) whose content or attributes
changed in the current transaction. Stored in `EditorState.dirtyLeaves`.

**Dirty Element**:
An `ElementNode` that appears in `EditorState.dirtyElements`. Either
**intentional** (its own structure or attributes changed) or **bubble** (it
sits on the parent chain above a dirty descendant and exists so the reconciler
will descend through it). The boolean value distinguishes the two kinds.

**Intentional Dirty**:
A dirty entry produced by a *direct* `markDirty(key)` call on that key -
the node itself changed. For an element, recorded as
`dirtyElements.set(key, true)`. For a leaf, every entry in `dirtyLeaves` is
intentional by construction (leaves have no bubble form). Read by update
listeners via `getDirtyNodeKeys()`; the reconciler runs `updateDOM` on it.
_Avoid_: "real dirty", "user dirty".

**Bubble Dirty**:
A dirty-element entry produced as a *side effect* of marking a descendant -
every ancestor on the path from the root to the dirty descendant is
recorded as `dirtyElements.set(ancestorKey, false)`. The ancestor itself
did not change; the entry exists only as a path marker. Hidden from update
listeners; the reconciler walks **through** it to reach the intentional
descendant but does not call `updateDOM` on it.
_Avoid_: "ancestor dirty", "pass-through dirty".

> **Difference in one line:** *intentional* answers "this node changed";
> *bubble* answers "a descendant changed". The boolean in `dirtyElements`
> is the only thing distinguishing them at runtime, and it determines
> whether external observers ever see the key.

**Dirty Type**:
A three-state enum on `EditorState` (`NO_DIRTY_NODES | HAS_DIRTY_NODES |
FULL_RECONCILE`) that summarises whether reconciliation has work to do.
`FULL_RECONCILE` is reserved for Phase 4 mutation defense; PR-1 only ever
sets the first two.

### DOM Bridge

**Managed DOM Pair**:
A `{ dom, key }` tuple where `dom` is a rendered element the reconciler owns
and `key` is the model node it represents. Returned by
`Reconciler.nearestManagedDomPair`.

**Host Element**:
The outer DOM element the reconciler tracks for a given `NodeKey`. For a
formatted `TextNode`, this is the outer `<span>` - not the inner format
wrappers.

**Format Stack**:
The nested chain of presentational tags (`<strong><em><code>...</code></em></strong>`)
emitted inside a `TextNode`'s host element when its format bitfield is
non-zero. Rebuilt whenever the format changes; never present in the model
as nodes.

## Relationships

- A **Dirty Leaf** always implies at least one **Bubble Dirty** entry (one
  per ancestor element, up to and including the root).
- An **Intentional Dirty** element can coexist with **Bubble Dirty** state on
  the same key only as a transition - `markDirty` upgrades a bubble entry to
  intentional in place; it never downgrades.
- The **Reconciler** treats `dirtyLeaves ∪ dirtyElements` as the set of keys
  to *visit*. It treats only **Intentional Dirty** entries as the set of
  keys to *act on*.
- A **Format Stack** lives entirely inside a single **Host Element** and is
  invisible to the model layer.

## Example dialogue

> **Dev:** "If I call `markDirty('t1')`, does that mark the paragraph too?"
> **Domain expert:** "It marks the paragraph as **Bubble Dirty**, not
> **Intentional Dirty**. The reconciler will descend through the paragraph
> to reach `t1`, but update listeners won't see the paragraph in their
> payload."

> **Dev:** "What if I then call `markDirty('p1')`?"
> **Domain expert:** "The paragraph's entry upgrades from `false` to `true`.
> It's now **Intentional Dirty** - update listeners will see it. The root
> stays **Bubble Dirty** because nothing intentionally changed at the root."

> **Dev:** "When does the reconciler ever see `FULL_RECONCILE`?"
> **Domain expert:** "Not yet. Phase 4 mutation defense will produce it when
> the browser writes something we can't reverse-engineer into a targeted
> patch. PR-1 reserves the value; nothing emits it."

## Flagged ambiguities

- "dirty" by itself is ambiguous between **Dirty Leaf**, **Intentional
  Dirty** element, and **Bubble Dirty** element. Always qualify when the
  distinction matters - the boolean in `dirtyElements` is load-bearing.
- "render" and "reconcile" are not synonyms. `Reconciler.render` performs a
  full DOM rebuild; `Reconciler.update` performs targeted **Reconciliation**.
  The former is the fallback path, the latter is the hot path.
