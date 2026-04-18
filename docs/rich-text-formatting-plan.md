# Angular Lexical-Like Editor - Rich Text Formatting (V2) Implementation Plan

Related execution backlog: `docs/rich-text-formatting-milestones.md`

Prior work: `docs/angular-lexical-editor-plan.md` (V1 minimal engine, already landed).

## Summary

- Extend the V1 minimal engine with inline text formatting (bold, italic, underline, strikethrough, code) while keeping the editor's architectural commitments intact: headless runtime, typed commands, plugin-first composition, transactional updates, dirty-node reconciliation, and JSON round-trip.
- Keep formatting state on `TextNode` as a compact bitfield; render formats via semantic HTML tags (`<strong>`, `<em>`, `<u>`, `<s>`, `<code>`) so we stay accessible by default.
- Introduce a `TextRange` payload and a DOM-to-model selection resolver rather than adding a persistent selection to `EditorState`; this keeps the core stateless with respect to caret position and delays the full selection-model work to a later milestone.
- Add a single `FORMAT_TEXT` command with a default handler that splits and merges text runs across the range. Toggle semantics follow the Lexical convention: if every character in the range already has the format, remove it; otherwise apply it to everything.
- Expose the feature through a reusable `FormattingKeyboardPlugin` (Ctrl/Cmd+B/I/U/E/Shift+X) and a minimal toolbar component. The plugin uses only the public `EditorPluginContext`, proving the plugin API holds up under a real feature.
- Bump TextNode serialization to `version: 2`; accept V1 snapshots unchanged by defaulting `format` to `0` on import. No data migration is required.

## Implementation Changes

### Text format model

- Add `TextFormat` bitflag constants: `NONE = 0`, `BOLD = 1`, `ITALIC = 2`, `UNDERLINE = 4`, `STRIKETHROUGH = 8`, `CODE = 16`. Reserve bits 32+ for future formats (superscript/subscript/highlight) without breaking schema.
- Add helpers: `hasFormat(bits, flag)`, `toggleFormat(bits, flag)`, `applyFormat(bits, flag)`, `removeFormat(bits, flag)`.
- Add `TextNode.format: number` field (default `0`), plus `getFormat()` / `setFormat(bits)` accessors that mark the node dirty.

### TextNode DOM mapping

- `TextNode.createDOM()` returns the outermost wrapper span. Format tags are nested in a **stable canonical order** (bold > italic > underline > strikethrough > code) so adjacent equal-format nodes produce identical DOM, which keeps the reconciler's dirty-only path hot.
- `TextNode.updateDOM(dom)` compares the previous format bitfield (stored on the DOM node via a private property) against the current one; if they differ, it rebuilds the nested tag stack. Text-only changes continue to flip `textContent` without touching the stack.
- Reconciler remains untouched. The format rebuild is entirely owned by `updateDOM`, preserving the dirty-node contract.

### Range payload + DOM-to-model selection bridge

- Add `TextRange` type: `{ anchor: TextPoint; focus: TextPoint; isCollapsed: boolean; isBackward: boolean }` where `TextPoint = { key: NodeKey; offset: number }`.
- Maintain a DOM->model reverse map as a private `WeakMap<Node, NodeKey>` on the `Reconciler`, populated during `createDOM` for every element and text DOM node, cleared implicitly by GC when the node is detached. No DOM pollution.
- Add a tiny helper `keyForDomNode(reconciler, node): NodeKey | null` that walks up from an arbitrary descendant (e.g. a `<strong>` emitted by a TextNode's formatting stack) to the nearest ancestor present in the WeakMap.
- Add `resolveDomSelection(editor, window = globalThis.window): TextRange | null` that reads `window.getSelection()`, walks up from the anchor/focus DOM nodes via `keyForDomNode`, normalizes anchor/focus offsets, and returns a `TextRange` bound to `TextNode`s only (selections partially outside text content are rejected).
- Keep the range payload transient. `EditorState` stays selection-free for V2.

### FORMAT_TEXT command

- Add `FORMAT_TEXT: EditorCommand<{ format: TextFormat; range: TextRange }>`.
- Default handler at `CommandPriority.Editor`:
  1. Split the start and end text nodes at the range boundaries so the range aligns exactly to whole text nodes.
  2. Walk the now-aligned text nodes in document order. If every node already has the format bit set, remove it on all; otherwise apply it on all. Collapsed ranges are a no-op in V2 (pending/caret format is deferred, see Open Questions).
  3. Merge adjacent text nodes that share the same format bitfield to keep the node graph compact.
- Split/merge operations use the existing `state.insertAfter`, `state.remove`, `state.replace` helpers and reuse the runtime `createNodeKey()` generator, so dirty tracking just works.
- The handler is a plain state mutator: no DOM knowledge, no reliance on browser globals. The only surface that touches DOM is `resolveDomSelection` in the bridge layer.

### Plugin + Angular surface

- Add `FormattingKeyboardPlugin` in `libs/editor/src/lib/editor/plugins/formatting-keyboard.plugin.ts`. It only uses `EditorPluginContext`: it registers no commands at setup, instead subscribing to `keydown` on the currently attached root element via a small `onRootKeydown` callback that the runtime service exposes (addition to `EditorRuntimeService`). On Ctrl/Cmd+B/I/U/E/Shift+X it calls `resolveDomSelection` and dispatches `FORMAT_TEXT`.
- Add a standalone `FormattingToolbarComponent` in `libs/editor/src/lib/editor/ui/components/formatting-toolbar/` that injects `EditorRuntimeService`, renders five buttons, and dispatches `FORMAT_TEXT` the same way. Active-state classes (aria-pressed=true) are derived from a `registerUpdateListener` callback plus a DOM-selection reader.
- Wire both into the `text-editor` app via a demo route so the feature is visible from the running dev server without being forced into `EditorComponent`'s always-on surface.

### Serialization

- Bump `TextNode.version` to `2` (element versions remain `1`).
- `TextNode.exportJSON` always emits `format` (default 0 in the baseline path).
- `TextNode.importJSON` tolerates missing `format` and treats it as `0`. This means V1 snapshots deserialize without change, and V2 snapshots written out will simply include the new field.
- `SNAPSHOT_VERSION` stays at `1` for the envelope (nothing else about the envelope changed). Per-node `version` carries the record-level compat story, matching the original doc's "version field exists for each exported node type" commitment.
- `validateSnapshot` gets one additional check: if a text record's `format` is present, it must be a non-negative integer.

## Public APIs / Interfaces

### Command API (additions)

- `FORMAT_TEXT: EditorCommand<{ format: TextFormat; range: TextRange }>`.
- `TextFormat` constants: `NONE`, `BOLD`, `ITALIC`, `UNDERLINE`, `STRIKETHROUGH`, `CODE`.
- Helpers: `hasFormat`, `toggleFormat`, `applyFormat`, `removeFormat`.

### Selection helpers (new module `core/selection.ts`)

- `TextPoint`, `TextRange` types.
- `resolveDomSelection(editor, win?): TextRange | null`.
- Internal utility `keyForDomNode(reconciler, node): NodeKey | null` that walks up to the nearest ancestor present in the reconciler's DOM->key `WeakMap`.

### Plugin API additions

- `EditorPluginContext` gains `onRootElement(cb): () => void` - fires whenever the editor root element changes (attach or detach), so plugins can attach native listeners without reaching into the directive.
- `EditorRuntimeService` exposes an internal subject so this hook stays implemented on top of public surface only.

### Node API additions

- `TextNode.format: number`, `getFormat()`, `setFormat(bits)`.
- `TextNode.createDOM` / `updateDOM` updated behavior (not a new surface, but now format-aware).

### Angular surface additions

- `FormattingKeyboardPlugin` value export.
- `FormattingToolbarComponent` standalone component.
- `provideFormattingKeyboardPlugin()` ergonomic helper that wraps `providePlugin`.

## Test Plan

- **TextFormat model**: bitfield helpers for every flag combination, idempotence of toggle, and commutativity with `applyFormat` + `removeFormat`.
- **TextNode DOM**: createDOM produces canonical-order nested tags for every single-flag case and a few combined cases; updateDOM flips tag stacks on format change without replacing the reconciler-owned outer span.
- **JSON round-trip**: V2 TextNode with non-zero format round-trips; V1 snapshot (no `format` field) reads back with `format === 0`; V2 validateSnapshot rejects negative/non-integer `format`.
- **FORMAT_TEXT default handler**:
  - Range fully inside one text node splits into 1/2/3 siblings depending on anchor/focus position, with expected formats.
  - Range spanning multiple text nodes within one paragraph formats the middle whole nodes and splits only the edges.
  - Mixed-format range (some bold, some not) applies the format everywhere.
  - Fully-bold range un-bolds everywhere.
  - Adjacent same-format siblings merge after mutation.
  - Collapsed range is a no-op in V2.
  - Range spanning across paragraph boundaries formats correctly on both sides.
- **DOM selection bridge**: mock a selection within one text node, across sibling text nodes, across paragraphs; verify `TextPoint` offsets match; verify selection partially outside a text node (e.g., anchored on a `<p>` boundary) returns `null`.
- **Reverse lookup**: data-key attributes appear on every rendered node; `keyForDomNode` returns the key even when called on a deeply nested formatting element (`<strong><em>x</em></strong>`).
- **Plugin**: `FormattingKeyboardPlugin` dispatches `FORMAT_TEXT` on Ctrl+B / Cmd+B; does nothing when no selection; stops listening after teardown.
- **Integration**: in a harness component with `FormattingToolbarComponent`, select a range, click Bold, assert the emitted DOM has `<strong>` wrapping the selected characters and surrounding text nodes are untouched.

## Resolved Decisions

Locked scope for the V2 build:

1. **Format set**: `BOLD`, `ITALIC`, `UNDERLINE`, `STRIKETHROUGH`, `CODE`.
2. **Rendering**: nested semantic tags (`<strong>`, `<em>`, `<u>`, `<s>`, `<code>`) in canonical order.
3. **Collapsed-caret formatting**: no-op in V2; deferred to the selection-model milestone.
4. **DOM->model reverse lookup**: `WeakMap<Node, NodeKey>` owned by the reconciler (no DOM attribute pollution).
5. **User-facing surface**: keyboard plugin + standalone `FormattingToolbarComponent` + demo route in `apps/text-editor`.
6. **Schema versioning**: bump `TextNode.version` to 2, keep `SNAPSHOT_VERSION` at 1, treat missing `format` as 0.
7. **Delivery cadence**: straight-through execution of F1-F5 without per-ticket checkpoints.