# Angular Lexical-Like Editor (V1 Minimal Engine) Implementation Plan

Related execution backlog: `docs/angular-lexical-editor-milestones.md`

## Summary

- Build a headless editor runtime that mirrors Lexical concepts (`Editor` instance, node registry, command bus with priority, update transactions, dirty-node reconciliation), then expose it through Angular DI and a thin UI adapter.
- Keep canonical document state as Lexical-style JSON-backed node map with doubly linked sibling pointers; use DOM Selection as v1 source of truth.
- Implement plugin extensibility through Angular multi-providers so each editor instance composes its own plugin set at creation time.
- Limit v1 behavior to a minimal engine: root/paragraph/text nodes, text input and deletion flows, command dispatch, plugin lifecycle, JSON snapshots, and plain-text import/export.

## Implementation Changes

### Core runtime architecture

- Introduce `EditorConfig` with `namespace`, `nodes`, `plugins`, and optional runtime flags.
- Keep `EditorState` as transaction snapshot with `NodeMap`, `rootKey`, and per-transaction dirty keys; retain mutable-draft update model.
- Add a `NodeRegistry` that validates registered node types at startup and maps type -> constructor/factory.
- Add transactional APIs: `editor.update(fn)`, `editor.read(fn)`, `editor.getEditorState()`, `editor.setEditorState(snapshot)`.
- Keep reconciliation strategy: full render on structural order mismatch, otherwise `updateDOM` only for dirty keys.

### Command system (Lexical-like)

- Replace string-only commands with typed command objects (`createCommand<TPayload>(name)`).
- Add `CommandPriority` enum (`Critical`, `High`, `Normal`, `Low`, `Editor`) and priority-sorted handler lists.
- Implement `registerCommand(command, handler, priority)` returning unregister callback; dispatch short-circuits when a handler returns `true`.
- Provide v1 core commands: `INSERT_TEXT`, `DELETE_CHARACTER`, `SET_TEXT_CONTENT`, `APPLY_EDITOR_STATE`, `CLEAR_EDITOR`.

### Plugin system (Angular-first)

- Define plugin contract: `EditorPlugin` with `key`, `setup(context)`, optional `destroy()`.
- Define Angular multi-provider token `EDITOR_PLUGINS` for plugin registration.
- Add `EditorRuntimeService` that instantiates editor, injects plugin list, executes plugin `setup`, and disposes on destroy.
- Plugin context exposes safe APIs only: command registration, update/read hooks, node registration checks, and event subscriptions.

### Angular integration

- Keep `lib-editor` as host component that owns one editor instance via `EditorRuntimeService`.
- Keep contenteditable directive as DOM bridge; route `beforeinput/input/keydown/composition/selectionchange` into core commands/update pipeline.
- Keep `ControlValueAccessor` bridge; `writeValue` restores JSON or plain text based on configured value mode.
- Avoid direct toolbar logic in component for now; toolbar buttons dispatch commands through editor instance.

### Serialization and I/O

- Define canonical JSON snapshot format with root key, node records, and per-node `type/version/key/parent/prev/next` plus node-specific payload.
- Implement `exportJSON` and `importJSON` on node classes (root/paragraph/text in v1).
- Provide plain-text adapters: `toPlainText(state)` and `fromPlainText(text)` for forms/interoperability.

## Public APIs / Interfaces

### `Editor` (or `EditorRuntime`) public surface

- `update(fn)`, `read(fn)`, `dispatchCommand(command, payload)`, `registerCommand(...)`, `setRootElement(el)`, `getEditorState()`, `setEditorState(state)`, `registerUpdateListener(listener)`.

### Command API

- `createCommand<TPayload>(name)`, `CommandPriority`, `CommandHandler<TPayload>`, and unregister function.

### Plugin API

- `EditorPlugin`, `EditorPluginContext`, and Angular DI token `EDITOR_PLUGINS` (multi-provider).

### Node API (Lexical-like shape for v1)

- `NodeBase` with key/parent/prev/next/type plus `createDOM`, `updateDOM`, `exportJSON`, static `getType`, static `clone`, static `importJSON`.

### Serialization API

- `EditorState.toJSON()`, `EditorState.fromJSON(snapshot)`, `toPlainText()`, `fromPlainText()`.

## Test Plan

- Node graph integrity tests for append/insert/remove/replace and linked-list invariants (`first/last/prev/next/size`).
- Dirty-set reconciliation tests verifying only dirty rendered nodes call `updateDOM`, while structural changes trigger full rerender.
- Command bus tests for priority ordering, short-circuit semantics, typed payload behavior, and unregister cleanup.
- Plugin lifecycle tests verifying DI multi-provider composition, `setup` invocation order, and destroy/unsubscribe behavior.
- Serialization tests for JSON round-trip stability, unknown-node rejection behavior, and plain-text conversion correctness.
- Angular integration tests for directive event bridging, CVA write/read behavior, and per-component editor instance isolation.
- Minimal E2E scenario tests for typing, backspace, paragraph creation baseline behavior, and command-driven updates.

## Assumptions and Defaults

- V1 scope is minimal engine only; advanced formatting, lists, links, history stacks, and collaboration are deferred.
- Plugin model is Angular-first via DI multi-providers, while runtime contracts remain framework-agnostic.
- Selection source is DOM-first in v1; model-level selection is postponed until command/edit features require it.
- State update model remains mutable draft + transaction-scoped dirty tracking.
- Canonical interchange is Lexical-style JSON, with plain-text import/export included in v1 and HTML import/export deferred.
