# Rich Text Formatting (V2) Milestones

## How to Use This

- This backlog is derived from `docs/rich-text-formatting-plan.md`.
- Each ticket is decision-complete pending the Open Questions in the plan doc. Lock those before executing.
- Execute milestones in order; tickets list dependencies where relevant.

## Milestone F1: Text Format Model

### Goal

- Add a compact, serialization-stable text formatting model to `TextNode` without changing the public surface of other node types.

### Exit Criteria

- `TextNode` carries a numeric `format` bitfield with typed helpers.
- JSON round-trip preserves formatting on V2 snapshots and safely defaults V1 snapshots to `format = 0`.
- Existing reconciler paths continue to update text-only changes without touching the tag stack.

### Tickets

#### F1-T1: Introduce `TextFormat` Bitfield + Helpers

- Scope:
- Add `TextFormat` constants: `NONE`, `BOLD`, `ITALIC`, `UNDERLINE`, `STRIKETHROUGH`, `CODE`.
- Add pure helpers: `hasFormat`, `toggleFormat`, `applyFormat`, `removeFormat`.
- Export from the library barrel.
- Dependencies:
- None.
- Acceptance Criteria:
- Helpers are pure functions with no runtime state.
- Unit tests cover every flag, toggle idempotence, and combined-format cases.
- TypeScript treats `TextFormat` values as a discriminated number type usable with bitwise ops.

#### F1-T2: Add `format` Field to `TextNode` + JSON Compat

- Scope:
- Add `format: number` to `TextNode` with default `0`.
- Add `getFormat()` / `setFormat(bits)` that mark the node dirty when they change.
- Bump `TextNode.version` to `2`.
- Update `TextNode.exportJSON` to always emit `format`.
- Update `TextNode.importJSON` to default `format` to `0` when absent.
- Extend `validateSnapshot` to reject negative or non-integer `format` values.
- Dependencies:
- F1-T1.
- Acceptance Criteria:
- V2 snapshots round-trip with arbitrary `format` bitfields.
- V1 snapshots (no `format` field) import with `format === 0` and re-export with `format === 0`.
- Invalid `format` values throw `InvalidSnapshotError` during validation.

#### F1-T3: Render `TextNode` Formats via Nested Semantic Tags

- Scope:
- Update `TextNode.createDOM` to wrap the innermost text span in semantic tags in canonical order: bold > italic > underline > strikethrough > code.
- Update `TextNode.updateDOM` to rebuild the nested tag stack when `format` changes, but keep the outer element identity stable for the reconciler.
- Store the last-rendered format on the DOM element (private symbol property) to detect format changes on subsequent patches.
- Dependencies:
- F1-T2.
- Acceptance Criteria:
- Each single-flag format maps to the expected tag.
- Combined formats produce nested tags in canonical order, making sibling text nodes with identical formats DOM-equivalent.
- Text-only changes (`format` unchanged) continue to touch only `textContent` on the innermost text node.
- Unit tests assert the rendered DOM for several combinations.

## Milestone F2: Range Model + DOM-to-Model Selection Bridge

### Goal

- Provide a thin, testable bridge from live DOM selection to a normalized model-level range payload that commands can consume, without adding selection to `EditorState`.

### Exit Criteria

- The reconciler maintains a private `WeakMap<Node, NodeKey>` populated during `createDOM` for every element and text DOM node.
- A `TextRange` type is defined and a `resolveDomSelection` function returns one from a live DOM selection or `null`.
- The runtime service exposes an `onRootElement` hook so plugins can attach native listeners without reaching into the directive.

### Tickets

#### F2-T1: Define `TextPoint` and `TextRange` Types

- Scope:
- Add `TextPoint = { key: NodeKey; offset: number }`.
- Add `TextRange = { anchor: TextPoint; focus: TextPoint; isCollapsed: boolean; isBackward: boolean }`.
- Export from the library barrel.
- Dependencies:
- None.
- Acceptance Criteria:
- Type exports are stable and tree-shakeable.
- Unit tests cover constructor helpers for collapsed and directional ranges (if any are added as part of this ticket).

#### F2-T2: Maintain DOM->Key WeakMap in the Reconciler

- Scope:
- Add a private `WeakMap<Node, NodeKey>` to `Reconciler` populated during `createDOM` for every element and text DOM node.
- Add a public method `keyForDomNode(node: Node | null): NodeKey | null` that walks ancestors looking up the WeakMap, so callers can pass arbitrary descendants (e.g. a `<strong>` emitted by TextNode's format stack).
- Ensure the WeakMap survives structural re-renders by re-populating on mount.
- Dependencies:
- None.
- Acceptance Criteria:
- Every element and text node emitted by the reconciler is registered in the WeakMap with its model key.
- `keyForDomNode` returns the key even when called on a deeply nested formatting element inside a TextNode subtree.
- Unit tests cover multi-paragraph + multi-format cases.
- No `data-*` attributes are added to rendered elements by the reconciler.

#### F2-T3: Add `resolveDomSelection` Helper

- Scope:
- Add `resolveDomSelection(editor, win?: Window & typeof globalThis): TextRange | null`.
- Walk from anchor/focus DOM nodes up to the nearest `data-key`; reject the selection if the resolved node is not a `TextNode`.
- Normalize anchor/focus offsets relative to the resolved TextNode's text content.
- Compute `isBackward` using DOM position comparisons (`compareDocumentPosition`).
- Dependencies:
- F2-T1, F2-T2.
- Acceptance Criteria:
- Returns a `TextRange` for selections strictly inside text content.
- Returns `null` for selections anchored on structural elements (e.g. paragraph-level).
- `isCollapsed` and `isBackward` match what native browsers report.
- Unit tests cover same-node, sibling-node, cross-paragraph, and reversed selections.

#### F2-T4: Add `onRootElement` Hook to Plugin Context

- Scope:
- Add `onRootElement(cb: (root: HTMLElement | null) => void): () => void` to `EditorPluginContext`.
- Implement it on top of public runtime surface: a private subject in `Editor` that emits inside `setRoot` before/after state changes.
- Update `EditorRuntimeService` to expose no new public surface - the hook lives in `getPluginContext()` only.
- Dependencies:
- Plugin system (V1 M2).
- Acceptance Criteria:
- Plugins receive the current root element on subscription (if any) and on every subsequent attach/detach.
- The returned unsubscribe function stops notifications.
- Unit tests cover attach/detach/re-attach sequences and plugin teardown.

## Milestone F3: `FORMAT_TEXT` Command

### Goal

- Provide a single, composable formatting command with a well-defined default handler that mutates the text run graph cleanly and preserves reconciler invariants.

### Exit Criteria

- `FORMAT_TEXT` is registered at `CommandPriority.Editor` by default.
- Default handler splits, formats, and merges text nodes across arbitrary ranges.
- Adjacent same-format text nodes are merged after every mutation so the node graph does not drift.

### Tickets

#### F3-T1: Introduce `FORMAT_TEXT` Command

- Scope:
- Add `FORMAT_TEXT: EditorCommand<{ format: TextFormat; range: TextRange }>` using `createCommand`.
- Register the command with a stub default handler (returns false) so the bus route is wired.
- Export from the library barrel.
- Dependencies:
- F1-T1, F2-T1.
- Acceptance Criteria:
- The command is dispatchable with type-correct payload.
- An explicit unit test asserts it is registered as a known command.

#### F3-T2: Implement Split-Apply-Merge Default Handler

- Scope:
- Replace the stub with a handler that:
  1. Splits the start and end text nodes at the range boundaries (skipping the split if the boundary is already at a run edge).
  2. Walks the resulting contiguous text nodes in document order.
  3. Decides toggle intent: if every visited node already has the target flag, remove it; otherwise apply it.
  4. Merges adjacent text nodes that share the same `format` bitfield and same parent.
- All mutations run inside `editor.update` so dirty tracking is correct.
- Dependencies:
- F3-T1, F1-T3.
- Acceptance Criteria:
- Same-text-node sub-range splits into expected 1/2/3 runs.
- Cross-text-node range formats middles and only splits the edges.
- Fully-formatted range toggles off; partially-formatted range applies to all.
- Adjacent same-format runs merge.
- Collapsed range is a no-op (pending/caret format is out of scope in V2).
- Handler returns `true` to short-circuit the bus.

#### F3-T3: Cross-Paragraph Range Support

- Scope:
- Extend F3-T2 to correctly handle ranges whose anchor and focus live in different paragraphs.
- Constraint: paragraphs themselves are not split or merged; only their contained text runs are mutated.
- Dependencies:
- F3-T2.
- Acceptance Criteria:
- Bolding a range that spans `[p1.t2, p2.t1]` formats every text node between anchor and focus inclusive and only splits the two edges.
- No paragraph-level mutation occurs.
- Unit test fixture with multi-paragraph state covers this case.

## Milestone F4: User-Facing Surface

### Goal

- Expose formatting through both keyboard shortcuts and a drop-in toolbar component, each composed as plugins/standalone Angular components with no privileged access to editor internals.

### Exit Criteria

- A keyboard plugin dispatches `FORMAT_TEXT` for B/I/U/E/Shift+X on both Ctrl and Cmd modifiers.
- A toolbar component renders buttons, reports active state live, and dispatches the same command.
- Both are wired through `providePlugin` / standard standalone component usage.

### Tickets

#### F4-T1: `FormattingKeyboardPlugin`

- Scope:
- Implement the plugin using only `EditorPluginContext`.
- Attach `keydown` to the current root via `onRootElement`, re-attaching on swap.
- On Ctrl/Cmd+B/I/U/E/Shift+X: call `resolveDomSelection`, dispatch `FORMAT_TEXT`, `preventDefault` on match.
- Dependencies:
- F2-T3, F2-T4, F3-T2.
- Acceptance Criteria:
- All five shortcuts dispatch `FORMAT_TEXT` with the expected format flag.
- No dispatch when `resolveDomSelection` returns `null`.
- Teardown removes listeners and the root-element subscription.
- Cmd (Mac) and Ctrl (Windows/Linux) both trigger.

#### F4-T2: `FormattingToolbarComponent`

- Scope:
- Standalone Angular component that injects `EditorRuntimeService`.
- Renders five buttons with ARIA labels and `aria-pressed` bound to the current format state of the active selection.
- Uses `registerUpdateListener` plus a DOM `selectionchange` listener to refresh active state.
- Dispatches `FORMAT_TEXT` on click.
- Dependencies:
- F2-T3, F3-T2.
- Acceptance Criteria:
- Buttons reflect active format state live.
- Clicking a button toggles the format on the current DOM selection.
- Component tests cover button-click dispatch and active-state refresh.

#### F4-T3: Demo Route Wiring

- Scope:
- Add a route to `apps/text-editor` that renders the editor plus the toolbar and registers the keyboard plugin via `providePlugin(FormattingKeyboardPlugin)`.
- No changes to the library-level `EditorComponent`.
- Dependencies:
- F4-T1, F4-T2.
- Acceptance Criteria:
- Dev server at `/` (or chosen demo path) shows the editor with a working toolbar.
- Keyboard shortcuts work inside the editable area.
- No regression in existing app-level tests.

## Milestone F5: Quality Gate and Back-Compat

### Goal

- Validate that V2 is safe to ship alongside V1 consumers by locking down test coverage and schema behavior.

### Exit Criteria

- V1 snapshots load into V2 without manual migration.
- Every new command, helper, and plugin has direct unit tests.
- Integration tests prove the typed-toolbar-keyboard surfaces stay isolated per editor instance.

### Tickets

#### F5-T1: Model Coverage - Formats + Node DOM

- Scope:
- Tests for `TextFormat` helpers.
- Tests for `TextNode.createDOM` / `updateDOM` with every combination we explicitly support.
- Dependencies:
- F1-T3.
- Acceptance Criteria:
- Coverage for both single-flag and multi-flag cases.

#### F5-T2: `FORMAT_TEXT` Handler Coverage

- Scope:
- Tests for the default handler covering split, merge, toggle (all three intents), collapsed range, and cross-paragraph range.
- Dependencies:
- F3-T3.
- Acceptance Criteria:
- Each scenario has a dedicated test.
- Post-mutation state matches expected node count (merge worked).

#### F5-T3: Selection Bridge Coverage

- Scope:
- Tests for `keyForDomNode` across nested formatting elements.
- Tests for `resolveDomSelection` across same-node, sibling-node, cross-paragraph, reversed, and rejected cases.
- Dependencies:
- F2-T3.
- Acceptance Criteria:
- All branches in the resolver are exercised.

#### F5-T4: Integration - Toolbar + Keyboard + Plugin Lifecycle

- Scope:
- Integration test: render harness with toolbar + keyboard plugin on two independent editors; format text in one, assert the other is untouched.
- Integration test: destroy a fixture and confirm keyboard listeners and update-listener callbacks are removed.
- Dependencies:
- F4-T2.
- Acceptance Criteria:
- Coverage proves per-instance isolation under formatting flows.
- No listener leaks after teardown.

#### F5-T5: JSON Back-Compat

- Scope:
- Test: load a frozen V1 snapshot fixture (no `format` field) and assert round-trip with `format === 0`.
- Test: write a V2 snapshot with mixed formats, re-import, assert exact equality.
- Dependencies:
- F1-T2.
- Acceptance Criteria:
- Both fixtures live under `libs/editor/src/lib/editor/core/__fixtures__/`.
- Any future schema change that breaks V1 compat fails the first test.

## Suggested Delivery Sequence

- Sprint 1: F1-T1 through F1-T3 (model + DOM).
- Sprint 2: F2-T1 through F2-T4 (range + bridge).
- Sprint 3: F3-T1 through F3-T3 (command).
- Sprint 4: F4-T1 through F4-T3 (plugin + toolbar + demo).
- Sprint 5: F5-T1 through F5-T5 (tests + back-compat).