# ADR-002: Editor Owns Input Listeners

## Status

Accepted

## Date

2026-05-24

## Context

Until now, `ContentEditableDirective` owned the browser input bridge:
`beforeinput`, `compositionstart`, `compositionend`, and `input` listeners,
the handled-input routing table, composition state, DOM resync, and the v1
caret-to-end fallback.

That followed the prior architecture invariant that core was
DOM-rendering-only and no DOM event listeners lived in `core/`. It also left
the most fundamental editor behavior - translating user keystrokes into
commands - inside the Angular adapter.

Selection sync and formatting shortcuts already have good plugin boundaries:
they are optional behavior, use `EditorPluginContext`, and can be omitted by
headless consumers. Basic text input is different. An editor mounted to a
contenteditable root should type without every host framework reimplementing
the same routing table.

## Decision

The core `Editor` registers input listeners directly when `setRoot` mounts a
contenteditable root:

- `beforeinput`
- `compositionstart`
- `compositionend`
- `input`

Input event wiring lives in `core/editor-events.ts`. `beforeinput` dispatches
a new `BEFORE_INPUT_COMMAND` with the raw `InputEvent` payload for every
non-composition event. The default command handler runs at
`CommandPriority.Editor`, calls `preventDefault()` only for routes it handles,
and forwards to existing mutation commands:

- `insertText` -> `INSERT_TEXT`
- `deleteContentBackward` / `deleteContentForward` -> `DELETE_CHARACTER`
- `insertParagraph` -> `INSERT_PARAGRAPH`

Unsupported input types return `false`, so browser default behavior remains
available and higher-priority command handlers can intercept raw input events
before the default routing table.

`ContentEditableDirective` remains the Angular lifecycle owner: it creates the
editor, runs Angular-provided plugins, publishes `EditorRef`, mounts the DOM
root, and tears everything down.

Selection sync, formatting shortcuts, and clipboard behavior remain plugin
concerns.

## Alternatives Considered

### Keep The Bridge In The Directive

Rejected. It keeps the directive responsible for both Angular lifecycle and
core editor input semantics. Any future non-Angular host would need to copy
the same listener and routing behavior.

### Pure `InputBridgePlugin`

Rejected. A plugin would preserve the previous "no DOM listeners in core"
invariant, but it would make typing an opt-in feature. Basic text input is a
core editor responsibility once a root is mounted.

### Hybrid Listener Plugin Plus Core Command Handler

Rejected. A core default `BEFORE_INPUT_COMMAND` handler plus a DOM-listener
plugin creates two surfaces to wire and test. Since every mounted editor needs
the listener, moving both listener registration and default routing into core
is simpler.

## Consequences

- The old "Core is DOM-rendering-only" invariant is narrowed. Core owns input
  bridging for mounted roots; plugins own other DOM event contracts.
- `BEFORE_INPUT_COMMAND` becomes the interception point for raw browser input.
  Higher-priority handlers can override paste, custom IME behavior, or future
  rich-text composition before default routing runs.
- Unsupported `beforeinput` events are still observable through the command
  bus, but the default handler does not prevent default or mutate state.
- The v1 `placeCursorAtEnd` fallback moves with the input bridge for now. It
  should be removed when input commands update editor-owned selection and
  commit writes DOM selection from model state. See
  `docs/input-selection-roadmap.md`.
