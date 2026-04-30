# Agent Guide

This repo is an Nx + Angular 19 text editor project. The editor library lives
under `libs/editor/src/lib/editor`; the demo app lives under `src/app`.

## Before Editing

- Read the local code first and follow existing patterns. Do not introduce new
abstractions unless they remove real duplication or match an established
pattern.
- Preserve unrelated user changes. Do not reset, restore, or rewrite files you
did not need to touch.
- Keep changes scoped. Design documents in `docs/` are part of the product and
should be updated when a shipped behavior or architectural decision changes.

## Commands

- Run editor tests: `npx nx test editor`
- Run a focused editor spec: `npx nx test editor --testPathPattern="pattern"`
- Build the demo app: `npx nx build text-editor --skip-nx-cache`
- Run the demo: `npx nx serve text-editor`

Use the full editor test suite after changes to `libs/editor/src/lib/editor`
unless the change is documentation-only.

## Editor Architecture

- Core editor code is framework-agnostic. Keep Angular-specific code in
`angular/`, `feature/`, `ui/`, or the app demo.
- `EditorState` stores a doubly-linked node graph. Maintain `__prev`, `__next`,
`__first`, `__last`, and `__size` through existing state/node utilities rather
than ad hoc map edits.
- Baseline document keys are deterministic: `root`, `p1`, `t1`. Runtime-created
nodes use `n*` keys from `createNodeKey()`. Do not assume a key proves a range
is still valid; offsets must fit the current text length too.
- The reconciler owns DOM rendering and DOM-to-model lookup maps. Do not expose
the reconciler directly; add narrow editor APIs when needed.
- Commands should flow through the command bus. Prefer one command path for
toolbar, keyboard, and programmatic behavior.

## Selection And Formatting

- Editor-owned selection is the source of truth: use `editor.getSelection()`,
`editor.setSelection(range, { source })`, and
`editor.registerSelectionListener(...)`.
- Native DOM selection sync belongs in `SelectionSyncPlugin`; core editor code
must not add `document` or `window` listeners.
- UI consumers such as `FormattingToolbarComponent` should subscribe to editor
selection/update listeners instead of listening to `selectionchange` directly.
- `FormattingToolbarComponent` requires `provideSelectionSyncPlugin()` in the
host providers. Keep that dependency explicit.
- Use `getFormatIntersection(state, range)` for active formatting flags. It
returns flags active across the entire selected range.
- Formatting uses `FORMAT_TEXT` and the split-apply-merge strategy. Preserve
cross-paragraph boundaries and merge adjacent same-format text runs only when
graph invariants allow it.

## Public API

- `libs/editor/src/index.ts` is the public API. Export provider helpers and
stable types intentionally.
- Raw plugin values are generally not public API; prefer provider helpers such
as `provideFormattingKeyboardPlugin()` and `provideSelectionSyncPlugin()`.
- If a consumer can deep-import an advanced primitive, document that choice in
the local barrel/JSDoc instead of exporting it casually from the root.

## Tests

- Core behavior belongs in `core/*.spec.ts`.
- DOM bridge behavior belongs in focused plugin or reconciler tests.
- Angular wiring belongs in `angular/*.spec.ts`.
- For selection tests, prefer real rendered DOM plus controlled
`window.getSelection()` stubs when jsdom cannot model native selection fully.
- Add regression tests for invariants discovered during debugging, especially
stale selections, offset bounds, multi-editor isolation, and teardown paths.

## Documentation Workflow

- For multi-step work, keep a design note in `docs/` with phases, risks, open
questions, acceptance criteria, and implementation notes.
- Resolve user-facing design questions before coding when the choice affects API
surface or architecture.
- When a phase ships, update the design note: mark it shipped, record decisions
taken, and summarize test coverage.