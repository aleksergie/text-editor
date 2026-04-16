# Angular Lexical-Like Editor Milestones

## How to Use This

- This backlog is derived from `docs/angular-lexical-editor-plan.md`.
- Each ticket is decision-complete and includes acceptance criteria.
- Execute milestones in order; tickets list dependencies where relevant.

## Milestone M1: Core Runtime Foundation

### Goal

- Establish a stable Lexical-like headless runtime with transactional updates, command dispatch, and deterministic reconciliation.

### Exit Criteria

- Editor runtime exposes typed command registration/dispatch with priorities.
- Update transactions are isolated and only dirty nodes patch DOM when structure is unchanged.
- Existing `SET_TEXT` flow works through the new command system.

### Tickets

#### M1-T1: Introduce Typed Command Primitives

- Scope:
- Add `createCommand<TPayload>(name)` and typed command symbol/object.
- Add `CommandPriority` enum (`Critical`, `High`, `Normal`, `Low`, `Editor`).
- Define typed `CommandHandler<TPayload>` contracts.
- Dependencies:
- None.
- Acceptance Criteria:
- Commands are no longer plain strings in core runtime internals.
- TypeScript enforces payload type at command dispatch call sites.
- Unit tests cover command object identity and payload typing behavior.

#### M1-T2: Implement Priority Command Bus

- Scope:
- Add `registerCommand(command, handler, priority)` with unregister callback.
- Maintain per-command handler lists sorted by priority.
- Dispatch short-circuits on first handler returning `true`.
- Dependencies:
- M1-T1.
- Acceptance Criteria:
- Higher priority handlers run before lower priority handlers.
- Equal priority handlers run in registration order.
- Returning `true` prevents subsequent handlers from running.
- Unit tests verify priority ordering, short-circuiting, and unregister cleanup.

#### M1-T3: Add Editor Transaction API Surface

- Scope:
- Add `editor.read(fn)` and keep `editor.update(fn)` as mutating transaction.
- Add `getEditorState()` and `setEditorState(snapshot)`.
- Add update listener registration (`registerUpdateListener`).
- Dependencies:
- M1-T2.
- Acceptance Criteria:
- `update` is the only mutating entrypoint for state changes.
- `setEditorState` triggers reconciliation and update listeners.
- Unit tests verify listener invocation order and unsubscribe behavior.

#### M1-T4: Harden Dirty-Set Reconciliation

- Scope:
- Keep structural fallback render and dirty-key incremental patch behavior.
- Ensure structural operations can mark impacted node keys dirty.
- Ensure dirty keys are cleared after transaction completion.
- Dependencies:
- M1-T3.
- Acceptance Criteria:
- Non-structural text updates call `updateDOM` only on dirty nodes.
- Structural key-order changes cause full re-render path.
- Unit tests verify both paths and no stale dirty-state leakage.

#### M1-T5: Define V1 Core Commands

- Scope:
- Create v1 command constants/objects: `INSERT_TEXT`, `DELETE_CHARACTER`, `SET_TEXT_CONTENT`, `APPLY_EDITOR_STATE`, `CLEAR_EDITOR`.
- Register default handlers in editor initialization.
- Map existing `SET_TEXT` behavior to `SET_TEXT_CONTENT`.
- Dependencies:
- M1-T2.
- Acceptance Criteria:
- Existing input flow still updates text.
- `CLEAR_EDITOR` resets to empty root + paragraph + text baseline.
- Unit tests verify each core command has a working default handler.

## Milestone M2: Angular Integration + Plugin Architecture

### Goal

- Keep core runtime headless while exposing a clean Angular-first plugin and lifecycle API via DI.

### Exit Criteria

- Plugins load via Angular multi-provider token.
- `lib-editor` and contenteditable directive use runtime service boundaries.
- DOM event bridge dispatches editor commands rather than mutating view directly.

### Tickets

#### M2-T1: Define Plugin Interfaces and Context

- Scope:
- Add `EditorPlugin` contract: `key`, `setup(context)`, optional `destroy()`.
- Add `EditorPluginContext` with safe capabilities only.
- Include command registration and update listener hooks in context.
- Dependencies:
- M1 complete.
- Acceptance Criteria:
- Plugins cannot directly mutate private editor internals.
- Plugin context includes only documented public APIs.
- Unit tests verify plugin setup receives expected context methods.

#### M2-T2: Add Angular DI Plugin Token

- Scope:
- Add `EDITOR_PLUGINS` multi-provider token.
- Add helper for plugin provider ergonomics.
- Dependencies:
- M2-T1.
- Acceptance Criteria:
- Multiple plugin providers compose into one runtime instance.
- Token is tree-shake-friendly and library-exported.
- Angular unit test verifies multi-provider merge order.

#### M2-T3: Introduce `EditorRuntimeService`

- Scope:
- Service owns one editor runtime instance per host editor component instance.
- Service loads plugins from `EDITOR_PLUGINS`, runs `setup`, and handles teardown.
- Dependencies:
- M2-T2.
- Acceptance Criteria:
- Plugin `destroy` is called when service/editor host is destroyed.
- Service exposes editor instance for component/directive bridge.
- Tests verify no cross-instance state leakage.

#### M2-T4: Refactor `EditorComponent` to Runtime Service Boundary

- Scope:
- Move direct `new Editor()` creation from component into runtime service.
- Keep component API minimal and host-focused.
- Dependencies:
- M2-T3.
- Acceptance Criteria:
- Component no longer constructs editor directly.
- Existing editor rendering still initializes in template.
- Component test updated to assert service integration.

#### M2-T5: Upgrade ContentEditable Event Bridge

- Scope:
- Route `beforeinput`, `input`, `keydown`, `compositionstart`, `compositionend`, and selection changes into command/update pipeline.
- Keep `ControlValueAccessor` compatibility for forms.
- Dependencies:
- M2-T4, M1-T5.
- Acceptance Criteria:
- Typing and basic deletion dispatch core commands through runtime.
- IME composition does not produce duplicate insertions.
- Directive tests cover event-to-command wiring and CVA behavior.

## Milestone M3: State Serialization + Interop

### Goal

- Deliver canonical JSON persistence and plain-text interoperability for form and API usage.

### Exit Criteria

- Editor state round-trips through JSON with node fidelity.
- Plain-text import/export helpers are stable and tested.

### Tickets

#### M3-T1: Define Canonical JSON Snapshot Schema (V1)

- Scope:
- Add schema/type definitions for editor snapshots.
- Include root key, node records, type/version/key/parent/prev/next and node payload.
- Dependencies:
- M1 complete.
- Acceptance Criteria:
- Snapshot schema is exported and used across serializer code.
- Unknown or malformed node records fail with descriptive errors.
- Unit tests verify schema validation/rejection paths.

#### M3-T2: Implement Node JSON Serialization Hooks

- Scope:
- Add `exportJSON` and `importJSON` for root, paragraph, and text nodes.
- Add static node-type metadata needed for import dispatch.
- Dependencies:
- M3-T1.
- Acceptance Criteria:
- Node export/import preserves structural links and payload.
- Version field exists for each exported node type.
- Unit tests verify each node type round-trip.

#### M3-T3: Add `EditorState` JSON Round-Trip APIs

- Scope:
- Add `EditorState.toJSON()` and `EditorState.fromJSON(snapshot)`.
- Ensure `setEditorState` accepts validated JSON-derived snapshots.
- Dependencies:
- M3-T2, M1-T3.
- Acceptance Criteria:
- Full document round-trip preserves textual content and node topology.
- Invalid snapshots do not partially mutate active runtime state.
- Unit tests verify import failure isolation.

#### M3-T4: Add Plain Text Adapters

- Scope:
- Implement `toPlainText(state)` and `fromPlainText(text)` helpers.
- Define newline behavior for paragraph boundaries.
- Dependencies:
- M3-T3.
- Acceptance Criteria:
- Exported plain text is deterministic for same state.
- Import creates valid minimal structure from plain text input.
- Unit tests cover empty input, single paragraph, and multi-paragraph cases.

## Milestone M4: Quality Gate and Stabilization

### Goal

- Ensure the minimal engine is stable, test-covered, and implementation-ready for richer features.

### Exit Criteria

- All critical runtime, integration, and serialization paths are tested.
- The library exposes stable APIs for next-phase features (formatting, lists, links, history).

### Tickets

#### M4-T1: Core Runtime Test Coverage Completion

- Scope:
- Fill test gaps in node graph integrity and reconciliation behavior.
- Add regression tests for dirty-set and structural updates.
- Dependencies:
- M1-T4.
- Acceptance Criteria:
- Node and reconciler test suites cover happy path and failure path scenarios.
- No flaky tests across repeated local runs.

#### M4-T2: Angular Integration Test Coverage Completion

- Scope:
- Add host component + directive integration tests across plugin-enabled runtime.
- Verify per-instance isolation when multiple editors are rendered.
- Dependencies:
- M2 complete.
- Acceptance Criteria:
- Two editors on one page do not leak commands or state.
- Plugin load/unload lifecycle is fully covered by tests.

#### M4-T3: End-to-End Minimal User Flows

- Scope:
- Add minimal e2e scenarios for typing, deletion, reset/clear, and JSON restore.
- Dependencies:
- M3 complete.
- Acceptance Criteria:
- E2E tests pass for all v1 core flows.
- Snapshot import/export works in browser-level tests.

## Suggested Delivery Sequence

- Sprint 1:
- M1-T1 through M1-T3.
- Sprint 2:
- M1-T4, M1-T5, M2-T1, M2-T2.
- Sprint 3:
- M2-T3 through M2-T5 and start M3-T1.
- Sprint 4:
- M3-T2 through M3-T4 and M4 stabilization tickets.
