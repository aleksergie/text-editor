# ADR-003: Editor Owns MutationObserver

## Status

Accepted

## Date

2026-05-27

## Context

The browser can mutate `contenteditable` DOM without flowing through the
editor's `beforeinput` / `input` bridge: spell-check, autocorrect, IME
commits, browser extensions, and default paste/drag behavior. Without
observation, the model and DOM diverge silently.

ADR-002 moved input listeners into core because basic typing is not an
optional plugin concern. The mutation observer shares the same coupling:
every reconciler DOM write must pause observation so editor-owned updates
do not feed back into defense logic, and future DOM selection writers need
the same pause/resume contract.

## Decision

The core `Editor` owns a `DomObserver` instance that wraps a native
`MutationObserver` on the mounted root:

- `setRoot(root)` starts observation after the initial reconciler mount.
- `setRoot(null)` and root swaps call `observer.stop()`.
- All `reconciler.mount` and `reconciler.update` calls run inside
  `runWithObserverPaused`, a public-on-`Editor` helper that is not
  exported from the package barrel.
- Phase 1 wires a no-op callback (debug logging only). Defensive handling
  ships in later phases of `docs/mutation-observer-roadmap.md`.

The observer lives in core rather than a plugin because the disconnect /
reconnect contract is tightly coupled to reconciler writes, mirroring
ADR-002's reasoning for input listeners.

## Alternatives Considered

### DomDefensePlugin

Rejected for phase 1. A plugin could preserve the "no DOM observers in
core" invariant, but it would need private access to pause/resume around
every reconciler write or duplicate reconciler entry points. The contract
belongs next to `Editor.update` and `setRoot`.

### Global Document Observer

Rejected. Each editor must observe only its own root so multi-editor pages
stay isolated.

## Consequences

- ADR-002's "core owns input bridging only" invariant is narrowed again.
  Core now owns input listeners and the mutation observer for mounted roots.
- `runWithObserverPaused` is available for the input-selection roadmap's
  DOM selection writer without exporting observer primitives publicly.
- `drainObserverRecords()` exists for mutation-defense cleanup paths in
  later phases; reconciler writes do not drain by default.
