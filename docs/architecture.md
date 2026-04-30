# Editor Architecture Overview

Snapshot of the system as of V2 rich-text formatting. Companion notes:

- `docs/angular-lexical-editor-plan.md` - V1 design.
- `docs/rich-text-formatting-plan.md` - V2 rich-text design.
- `docs/selection-state-design.md` - in-flight refactor for editor-owned
selection state (Phase 1 landed, Phases 2-3 pending).

This document describes the system in three views:

1. **Static architecture** - what lives where, and what depends on what.
2. **Data shapes** - the node graph and the DOM <-> model bridge.
3. **Runtime dispatch** - how user input becomes a DOM change.

## 1. Static Architecture - Layers, Components, Dependencies

The system is organized into five concentric layers. Outer layers depend on
inner layers; inner layers never import outward.

### Layer 1: Editor Core (framework-agnostic)

Location: `libs/editor/src/lib/editor/core/`

No Angular, no DOM events, no framework assumptions beyond "there is a
`document` when rendering." Runnable headless (jsdom, SSR, Node).

- `**Editor`** - the orchestrator. Owns the current `EditorState`, the
`Reconciler`, the command bus, and the update/root listener sets. Exposes
a small plugin surface via `EditorPluginContext`.
- `**EditorState`** - the document graph. A `NodeMap` keyed by `NodeKey`
plus structural helpers (insert/remove/split/merge). Every mutation goes
through `insertAfterUtil` / `removeUtil` / `replaceUtil` so the
doubly-linked-list invariants stay intact.
- `**Reconciler**` - the DOM writer. Maintains `keyToDom: Map<NodeKey, HTMLElement>` and `domToKey: WeakMap<Node, NodeKey>`. Does dirty-node
updates on every editor transaction; falls back to a full render when the
document's render order changes.
- **Commands** - typed, priority-ordered dispatch bus. Payload types are
attached to the command via a phantom-type pattern so registration and
dispatch stay type-safe.
- **Nodes** - `NodeBase`, `ElementNode`, `RootNode`, `ParagraphNode`,
`TextNode`. Each node owns its `createDOM` / `updateDOM` / `exportJSON` /
`importJSON`.
- **Selection** - `TextPoint`, `TextRange`, `resolveDomSelection`,
`getFormatIntersection`, `SelectionResolverHost`. Transient for V2; a
design note covers moving cached selection onto `Editor` itself.
- **TextFormat** - bitfield constants and helpers (`hasFormat`,
`toggleFormat`, etc.).
- **Snapshot** - JSON schema plus `validateSnapshot`. Versioned.
- **Plain-Text adapters** - `toPlainText` / `fromPlainText`.
- **Plugin** - `EditorPlugin` / `EditorPluginContext` interfaces.

### Layer 2: Plugins

Location: `libs/editor/src/lib/editor/plugins/`

Plain-object `EditorPlugin` values that consume only `EditorPluginContext`.

- `**FormattingKeyboardPlugin`** - registers a `keydown` listener on the
editor root via the `onRootElement` hook and dispatches `FORMAT_TEXT` on
Ctrl/Cmd+B/I/U/E and Ctrl/Cmd+Shift+X.

Plugins are intentionally not coupled to Angular. The Angular integration
layer adapts them to DI via `providePlugin(...)`.

### Layer 3: UI Surface (components and directives)

Location: `libs/editor/src/lib/editor/feature/`,
`libs/editor/src/lib/editor/ui/`

Standalone Angular building blocks. Each one is framework-specific but
individually mountable; nothing forces you to use all three together.

- `**EditorComponent`** - the V1 "drop-in" host: provides
`EditorRuntimeService` and renders a `contenteditable` div wired to
`ContentEditableDirective`.
- `**ContentEditableDirective**` - attaches to any `contenteditable` host,
subscribes to editor updates, and translates native `beforeinput` events
into typed commands.
- `**FormattingToolbarComponent**` - standalone toolbar. Subscribes to
editor updates and native `selectionchange`, uses
`getFormatIntersection` to derive `activeFlags`, and dispatches
`FORMAT_TEXT` on button mousedown.

### Layer 4: Angular Integration

Location: `libs/editor/src/lib/editor/angular/`

- `**EditorRuntimeService**` - per-instance, DI-scoped service that owns a
single `Editor`. Registers default command handlers and any plugins
injected via `EDITOR_PLUGINS`.
- `**EDITOR_PLUGINS` token + `providePlugin()` helper** - the DI-shaped
way to register plugins. `provideFormattingKeyboardPlugin()` wraps it for
ergonomics.

### Layer 5: Application

Location: `apps/text-editor/`

- `**AppComponent` + router** with two routes:
  - `/` - `FormattingDemoComponent` providing `EditorRuntimeService`,
  `provideFormattingKeyboardPlugin()`, and rendering
  `FormattingToolbarComponent` alongside a `contenteditable` div.
  - `/plain` - `<lib-editor>` (the V1 baseline).

### Dependency rule

Arrows flow only **from outer layers into inner layers**. The editor core
never imports from Angular, components, or plugins; plugins never import
from Angular or components; the Angular layer never imports from the
application. This is what lets the core be headless-testable (the
`formatting.spec.ts` and `state.spec.ts` suites run without any Angular
TestBed) and what the selection-state design note preserves - the cached
selection lives on `Editor` but the DOM listener that feeds it lives in a
plugin, not in core.

## 2. Data Shapes - The Node Graph and the DOM <-> Model Bridge

### The node graph is a doubly-linked tree

`EditorState` holds a flat `NodeMap: Map<NodeKey, NodeBase>`. Tree
structure lives on the node instances themselves as pointer fields:

- `NodeBase.__prev`, `NodeBase.__next` - siblings.
- `NodeBase.__parent` - parent link.
- `ElementNode.__first`, `ElementNode.__last`, `ElementNode.__size` -
child-list endpoints plus size.

There are no children arrays. This mirrors Lexical's design and is
preserved as an invariant: every mutation goes through
`insertAfterUtil` / `removeUtil` / `replaceUtil` which update every pointer
atomically. Split / merge / applyFormatToRange in `EditorState` all build
on these utilities, so we never leak a half-linked list.

A typical document:

- `RootNode` (key=`root`) is always present and always an `ElementNode`.
- Its children are `ParagraphNode` instances linked via `__first` /
`__next` / `__last`.
- Each paragraph's children are `TextNode` instances linked the same way.
- `TextNode`s carry `text: string` and `format: TextFormatBits` but have
no further children in V2.

### Formatting tags have no model counterpart

When `TextNode.format` carries any flag, `TextNode.createDOM` emits a
canonical nested stack of semantic tags inside the outer `<span>`:

```
<span>               <- outer host, registered in keyToDom
  <strong>           <- emitted from format bits, no model node
    <code>           <- emitted from format bits, no model node
      "hello"        <- the actual text
    </code>
  </strong>
</span>
```

The render order is fixed (bold > italic > underline > strikethrough >
code) so adjacent same-format nodes produce byte-identical DOM, which lets
the reconciler's dirty-only path stay fast.

These intermediate wrappers are transient: they get rebuilt whenever the
format bitfield changes (handled inside `TextNode.updateDOM`). They are
not nodes in the model sense - there is no `StrongNode`.

### Two lookup maps bridge model and DOM

The reconciler maintains two coordinate-system mappings:

- `**keyToDom: Map<NodeKey, HTMLElement>**` - outward. Given a model key,
find the outer host element. Used by the selection bridge to confirm a
selection anchor maps to a still-mounted node, and by `updateDOM` to
locate the host it should mutate.
- `**domToKey: WeakMap<Node, NodeKey>**` - inward. Given any DOM node
(including nested formatting tags and the inner text nodes), find the
owning `TextNode`'s key. Populated by `Reconciler.indexSubtree`, which
walks every descendant of a rendered host with a `TreeWalker` and maps
each one back to the host's key.

`indexSubtree` runs on initial render and after every dirty `updateDOM`
call. This keeps the WeakMap coherent across format-stack rebuilds so that
a `selectionchange` anchored inside a newly-created `<strong>` still
resolves to the right `TextNode`. Detached DOM from previous renders gets
garbage-collected on its own - that is why `domToKey` is a `WeakMap`, not
a regular `Map`.

`keyToDom` is keyed by a string and cleared manually at the top of
`Reconciler.render`.

## 3. Runtime Dispatch - How Input Becomes a DOM Change

Every mutation in the editor follows the same pipeline: **input surface ->
command bus -> default handler -> state mutation -> reconciler -> DOM**.
Update listeners fire at the end so UI surfaces can refresh derived state.

### Entry points

Three surfaces feed commands into the bus, and they share the same
downstream path.

1. **Typing (`ContentEditableDirective`).** Native `beforeinput` events
  are captured on the contenteditable host. The directive calls
   `preventDefault` on the event (so the browser does not mutate the DOM)
   and translates `inputType` into a command:
  - `insertText` -> `INSERT_TEXT`
  - `insertParagraph` -> `INSERT_PARAGRAPH`
  - `deleteContentBackward` -> `DELETE_CHARACTER`
  - `insertReplacementText` / `insertFromPaste` -> `INSERT_TEXT` with
  clipboard data.
2. **Format shortcuts (`FormattingKeyboardPlugin`).** The plugin attaches
  a `keydown` listener via `onRootElement`. On a matching shortcut it
   resolves the current DOM selection via `resolveDomSelection` and
   dispatches `FORMAT_TEXT` with a `TextFormatFlag` and the `TextRange`.
3. **Toolbar (`FormattingToolbarComponent`).** On button `mousedown` it
  calls `preventDefault` (so focus stays in the editor), resolves the
   current DOM selection, and dispatches `FORMAT_TEXT`.

A fourth path - programmatic API calls - is available to any code holding
an `Editor` reference: `editor.dispatchCommand(CMD, payload)` bypasses the
DOM entirely and is the primary testing surface.

### Command bus

`Editor.dispatchCommand` walks registered handlers in priority order (high
-> low). Each handler may return `true` to signal "handled" and stop the
walk, or `false` / `void` to fall through. A default handler registered
by `registerDefaultHandlers` sits at the bottom of the stack for every
built-in command.

Plugins use this priority system to transform payloads before the default
handler sees them. The `uppercasingPlugin` in `integration.spec.ts`
demonstrates the pattern: register a `CommandPriority.High` handler for
`INSERT_TEXT`, mutate the text via a nested `ctx.update(...)`, and return
`true` to swallow the original command.

### State mutation

Every handler that writes state does so inside `state.update(mutator)`.
Within the transaction:

- Text nodes can be split / merged via `splitTextNodeAt` and
`mergeAdjacentSameFormatRuns`.
- Format bits are toggled via `applyFormatToRange` (the core of
`FORMAT_TEXT`).
- Nodes are inserted / removed via `insertAfter` / `remove` / `replace`
(each of which delegates to the matching `*Util` in `node-utils.ts`).
- `state.markDirty(key)` records which nodes changed.

Mutations never fire listeners or touch the DOM directly. Everything is
buffered until commit.

### Reconciliation

After the mutator returns, `Editor` passes the old and new states to
`Reconciler.update`:

- If `renderOrder` is unchanged, the reconciler walks dirty keys and calls
`node.updateDOM(host)` on each, then re-runs `indexSubtree(host, key)`
so `domToKey` stays coherent with any newly-created format wrappers.
- If `renderOrder` changed (paragraph split, node insertion or deletion),
the reconciler takes the full-render path: clears `innerHTML`, rebuilds
the DOM from scratch, repopulates both lookup maps.

Dirty-node reconciliation is the hot path. Full rendering is a known
scaling target; for typical user interactions (typing, format toggles) it
is not hit.

### Update listeners

After reconciliation, `Editor` notifies every registered `updateListener`.
Listeners fire **after** state commits and **after** the DOM is written,
so `editor.getEditorState()` returns the post-mutation state and any
DOM-dependent reads (element bounds, selection) see the final layout.

In the current code:

- `FormattingToolbarComponent` uses an update listener plus a native
`selectionchange` subscription to recompute `activeFlags`.
- `ContentEditableDirective` uses an update listener to coordinate its
mount lifecycle.

The in-flight selection-state refactor (Phase 2 in
`docs/selection-state-design.md`) introduces a dedicated selection
listener so consumers stop needing the `selectionchange` subscription.

## System Properties Worth Preserving

- **Core is DOM-rendering-only.** No DOM event listeners live in `core/`.
Formatting shortcuts, selection sync, clipboard handling all go through
plugins that own the DOM-event contract.
- **Plugins use only `EditorPluginContext`.** No plugin reaches into the
raw `Editor`. This is what lets the plugin API evolve without breaking
existing plugins.
- **All state mutation is transactional.** `state.update(mutator)` is the
only way to change the document. Listeners fire after commit. There is
no mid-transaction observer surface.
- **Doubly-linked-list invariants are utility-enforced.** No direct writes
to `__prev` / `__next` / `__first` / `__last` / `__size` happen outside
`node-utils.ts`. This is a hard rule that keeps the graph consistent
across all the split / merge / format operations added in V2.
- **JSON snapshots are versioned.** `SNAPSHOT_VERSION` is a global schema
version; individual node types carry their own `static version` (e.g.
`TextNode.version = 2` for rich-text). Import paths accept older
node-level versions by defaulting missing fields.
- **One editor per `EditorRuntimeService`.** DI scoping means multiple
editors on the same page get their own runtime, own plugin stack, own
DOM, own command bus. The selection-sync plugin planned for Phase 2
filters by `root.contains` so cross-talk is impossible.

