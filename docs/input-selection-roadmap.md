# Input Selection Roadmap

## Status

Future work. This note explains why the current input bridge uses a
temporary caret-to-end fallback and what must replace it before richer
editing behavior can be correct.

## Current V1 Behavior

The editor currently handles text input as a plain-text bridge:

1. A browser input event is observed on the contenteditable root.
2. The bridge dispatches a command such as `INSERT_TEXT`,
   `DELETE_CHARACTER`, `INSERT_PARAGRAPH`, or `SET_TEXT_CONTENT`.
3. The command mutates `EditorState`.
4. The reconciler updates the DOM.
5. If the update came from the input bridge, the bridge collapses the
   browser selection to the end of the root.

That last step is represented by `lastChangeFromBridge` and
`placeCursorAtEnd()`. The flag is not part of the editor's long-term
selection model. It is a v1 recovery mechanism that prevents every
programmatic update from stealing focus while still keeping simple tail
typing usable after DOM reconciliation.

This works for the early plain-text demo where typing appends at the end
of the document. It is not a general editing model.

## Why The Fallback Is Not Enough

`placeCursorAtEnd()` discards intent. It does not know where the user typed,
what range was selected, or how a command transformed the document. It can
only put the caret at the end of the contenteditable root.

That breaks down for:

- Middle-of-document typing, where `abc|def` plus `X` should become
  `abcX|def`, not `abcXdef|`.
- Selected-range replacement, where typing over `hello [world]` should
  replace only the selected range and collapse after the inserted text.
- Backspace/delete, where the caret should move relative to the deletion
  point, not to the document end.
- Multi-paragraph editing, where Enter should create a paragraph at the
  selection and place the caret inside the new paragraph.
- Rich text editing, where the next inserted text may need to inherit the
  active format/style at a collapsed selection.
- Future undo/redo and collaboration, where document and selection changes
  need to be replayable as coherent transactions.

## Target Behavior

The editor should treat selection as part of input handling, not as a
post-update DOM repair step.

Target flow:

1. Before handling input, resolve the current DOM selection into editor
   model coordinates.
2. Start an editor update transaction.
3. Run the input command against that model selection.
4. Mutate document state and update the model selection in the same
   transaction.
5. Reconcile the DOM from the committed document state.
6. Write the DOM selection from the committed model selection.

In that model, typing at offset `3` in a text node changes both the text and
the selection. If the inserted text has length `1`, the committed selection
ends at offset `4`. DOM selection sync then writes the browser caret to that
exact position.

## Lexical Reference Shape

`docs/LEXICAL_ARCHITECTURE.md` describes the flow this roadmap points
toward:

- `beforeinput` is observed before the browser mutates the contenteditable
  DOM.
- The event is routed through a command.
- Command dispatch runs inside an update cycle.
- Selection is resolved from the DOM into model points before command
  mutations run.
- Text operations update selection points as part of the mutation.
- The commit phase reconciles DOM, then writes DOM selection from the
  committed model selection.

Where a Lexical internal detail is a good fit for this project, copying
it is fine and often preferable to reinventing the shape. The important
idea is that text and selection move together in one transaction; the
Lexical implementation is a proven reference for how to get there.

## Desired Invariants

- Input commands should never need to guess the caret destination from DOM
  shape after reconciliation.
- A command that changes text should also leave the editor-owned selection
  in the correct post-command location.
- DOM selection should be an input/output boundary:
  - read from DOM before user input is interpreted;
  - written to DOM after committed editor state is reconciled.
- Programmatic document changes should not accidentally steal selection
  unless they explicitly set a new selection.
- Selection updates should remain per-editor and isolated across multiple
  editors on the same page.

## Implementation Direction

This likely needs a few steps rather than one large rewrite.

### Recommended Sequencing With Mutation Observer Roadmap

Recommended order:

1. Ship `docs/mutation-observer-roadmap.md` Phase 1 first. It adds the
   observer pause/resume contract and exact DOM lookup helpers.
2. Ship this input-selection roadmap. The DOM selection writer in step 3
   should call `runWithObserverPaused` so writing browser selection does
   not trigger mutation-observer feedback.
3. Return to `docs/mutation-observer-roadmap.md` Phases 2-5 for text
   mutation sync, childList defense, IME variance handling, and recovery.

If this roadmap ships before the observer Phase 1, retrofit the selection
writer to use `runWithObserverPaused` as soon as that helper exists.

### 1. Give input commands a selection source

Commands such as `INSERT_TEXT`, `DELETE_CHARACTER`, and
`INSERT_PARAGRAPH` need a current selection to operate on. The selection can
come from the cached editor-owned selection, or from a freshly resolved DOM
selection during input handling.

The input bridge should not infer insertion points from document text alone.
It should route commands with enough context for the command handler to know
where the user intended the edit.

### 2. Update selection inside mutations

State mutations should move selection as they edit:

- `INSERT_TEXT` replaces the selected range or inserts at a collapsed point,
  then collapses selection after the inserted text.
- `DELETE_CHARACTER` removes the selected range when expanded, otherwise
  deletes before/after the caret and moves the caret to the deletion point.
- `INSERT_PARAGRAPH` splits the current paragraph or inserts a new paragraph
  at the current position, then moves selection into the new paragraph.

These changes should use existing node/state utilities so linked-list
invariants stay intact.

### 3. Commit DOM selection from model selection

After reconciliation, the editor should translate the committed model
selection back into DOM nodes and offsets using the reconciler lookup APIs.
That replaces `placeCursorAtEnd()`.

The selection writer should handle at least:

- collapsed text selections;
- expanded text selections;
- stale selections that no longer resolve;
- root swaps and teardown.

### 4. Remove the bridge-local caret fallback

Once input commands update selection and commit writes DOM selection from
the model, `lastChangeFromBridge` and `placeCursorAtEnd()` should be
deleted. At that point the editor no longer needs to know that an update
"came from the bridge"; it only needs the committed selection.

## Testing Strategy

Regression tests should cover the cases that `placeCursorAtEnd()` cannot:

- Insert in the middle of a text node and keep the caret after the inserted
  text.
- Replace an expanded range and collapse after the replacement.
- Backspace/delete at the middle of text and at paragraph boundaries.
- Press Enter in the middle of a paragraph.
- Preserve rich-text format intent at a collapsed selection.
- Ensure programmatic `SET_TEXT_CONTENT` or snapshot replacement does not
  steal selection unless explicitly requested.
- Confirm multiple editor instances keep independent document and selection
  state.

## Relationship To Current Work

Moving browser input listeners into core editor events is an architectural
cleanup. It does not by itself solve selection correctness.

The cleanup is still useful because it puts input handling near command
dispatch and creates a single place where the future selection-aware input
flow can be implemented. The temporary caret fallback should move with that
bridge for now, then be removed when this roadmap ships.
