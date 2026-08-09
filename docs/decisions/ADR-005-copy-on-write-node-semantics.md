# ADR-005: Copy-on-Write Node Semantics

## Status
Accepted

## Context
Our V2 rich-text formatting required a robust way to isolate editor states across mutations, ensure that time-travel debugging and undo/redo histories are stable, and allow the reconciler to accurately trust `prev` state without complex DOM workarounds.

Previously, `EditorState.clone()` performed a shallow Map clone (`new Map(this.nodes)`), sharing `NodeBase` instances between the `prev` and `next` states. Mutating a node's linked list pointers (`__first`, `__next`, `__parent`) mutated the node for both states. As a result:
- The recursive reconciler couldn't trust `prev` to reflect the pre-mutation tree shape and relied on `keyToDom` as a workaround.
- Snapshot-based undo/redo was fundamentally impossible because `prev` states were silently corrupted by subsequent transactions.
- Update-listener payloads carried references to corrupted `prev` states.

Lexical solves this via a two-layer Copy-on-Write (COW) approach:
1. **Container-level COW (GenMap)**: `EditorState.clone()` becomes O(1) for large documents by sharing storage between source and clone until a write triggers lazy isolation.
2. **Per-node COW (`getWritable`)**: Ensures every mutation produces a fresh `NodeBase` instance, preserving the references of the previous state.

## Decision
We have adopted the Lexical-style two-layer Copy-on-Write node semantics in full.

### 1. GenMap
We introduced `GenMap` to replace the standard `Map` for our `NodeMap`. It maintains a two-tier storage system (`_old` and `_nursery`).

### 2. Active Context and `getWritable`
Every mutation must now route through `node.getWritable()`. `getWritable` requires an active context (established for the duration of an `editor.update` transaction via module-level globals). `getWritable()` strict mode has been enabled, meaning attempts to mutate a node outside an active context throw an error. 

## Consequences

- **Reconciler Simplification:** `Reconciler.reconcileChildren` now trusts `prev` as the genuine pre-mutation tree shape, successfully retiring the `keyToDom`-as-snapshot workaround.
- **Undo/Redo Readiness:** We have unlocked a safe path for transaction replay, time-travel, and speculative operations.
- **Headless Property Regression:** Since transactions rely on module-level globals for active context, testing mutations directly requires `withActiveContext()` wrapping or `$setActiveContext` boilerplate.
- **GenMap Tuning:** GenMap is configured with a threshold (1000 nodes). Below this, `cloneMap` falls back to `new Map(map)`. This is a tuneable parameter that can be adjusted based on profiling.
- **Public Field Encapsulation:** Publicly mutable node fields like `TextNode.text` have been encapsulated to prevent silent circumvention of `getWritable()`.

## Rejected Alternatives

- **Shared mutable + keyToDom snapshot:** The prior implementation. Kept because it worked for the immediate DOM rendering requirements of PR-2, but rejected for the long term because it blocks undo/redo entirely.
- **Deep-clone in `EditorState.clone()`:** Rejected due to O(N) performance overhead for every keystroke. Most nodes remain untouched during typical typing; eagerly cloning the entire document is unscalable.
