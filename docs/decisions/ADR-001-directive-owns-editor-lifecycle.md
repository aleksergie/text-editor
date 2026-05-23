# ADR-001: Directive Owns Editor Lifecycle

## Status

Accepted

## Date

2026-05-23

## Context

The Angular integration previously split one editor instance across two owners:

- `EditorRuntimeService` constructed the `Editor`, collected `EDITOR_PLUGINS`,
  ran plugin `setup`, exposed the editor to sibling UI, and handled teardown.
- `ContentEditableDirective` received that editor through an `[editor]` input,
  mounted the DOM root, translated browser input into commands, and implemented
  `ControlValueAccessor`.

That made the directive dependent on an externally-created editor even though
the directive is the only Angular surface that can safely bind the editor to the
contenteditable host. It also forced templates to pass `[editor]` everywhere.

One Angular constraint shaped the replacement: providers declared on a directive
are visible only from that directive's host element and descendants. Sibling
components such as `FormattingToolbarComponent` cannot inject a token provided
only by the contenteditable directive, because their injector lookup does not
pass through the directive host element.

## Decision

Use three small pieces:

- `createEditor()` in core, with no arguments, returning a new `Editor`.
- `ContentEditableDirective` as the lifecycle owner. It calls `createEditor()`,
  injects `EDITOR_PLUGINS`, runs plugin setup before mounting the root, publishes
  the editor, and performs teardown.
- `EditorRef`, provided by `provideEditor()` on the host component, as a
  signal-backed DI handle. The directive writes the created editor into it, and
  sibling components react when the editor becomes available.

`createEditor()` deliberately does not accept plugins. Plugins are a host
integration and lifecycle concern, so Angular DI stays at the Angular boundary
instead of leaking into the core factory shape.

## Alternatives Considered

### `createEditor(plugins)`

Rejected. It would make construction own plugin setup and teardown policy. That
couples a framework-agnostic core entry point to a host-lifecycle concern that
belongs at the adapter boundary.

### Keep `EditorRuntimeService` as the eager constructor

Rejected. This preserves the original split ownership: the service creates the
editor while the directive mounts the DOM root. The refactor goal is to make the
directive the only place where the Angular editor surface is assembled.

### Provide the editor token from the directive only

Rejected for the current template shape. Toolbar and debug-panel components are
siblings of the contenteditable element, so they cannot see tokens provided only
on the directive host.

### Parent uses `@ViewChild(ContentEditableDirective)`

Rejected. This removes DI but pushes editor plumbing into every host template and
component. It also makes peer components depend on parent coordination instead
of a scoped editor handle.

## Consequences

- Hosts that compose editor UI must provide `provideEditor()` in the component
  provider scope shared by the contenteditable directive and sibling consumers.
- The directive owns plugin lifecycle ordering:
  setup runs in provider order, setup-returned teardowns run in reverse order,
  then `plugin.destroy?.()` runs for each plugin.
- Peer components subscribe to `EditorRef.editor()` and must tolerate `null`
  before the contenteditable directive initializes and after it is destroyed.
- Core remains framework-neutral: `createEditor()` is just a named constructor
  wrapper.
