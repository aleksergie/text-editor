# Line Breaks and Managed Line Breaks Plan

## Objective

This document outlines the implementation plan for handling line breaks in the editor. This consists of two separate but related concepts that mirror Lexical's architecture:

1. **`LineBreakNode`**: An explicit node in the state graph representing a soft line break (e.g., triggered by `Shift+Enter`).
2. **Managed Line Breaks**: A DOM-only rendering mechanism to prop open empty block elements (like `<p>`) so they do not collapse in the browser, ensuring they remain clickable and display a cursor.

## Architecture

### 1. `LineBreakNode` (Core Model)

- **Type**: Leaf node.
- **Purpose**: Represents an intentional soft break in the text flow.
- **Rendering**: Reconciles to a standard `<br>` DOM element.
- **State Integration**: Stored in the `EditorState` graph. Selection treats it as a discrete entity for cursor movement and offsets.

### 2. Managed Line Breaks (DOM Reconciler)

- **The Problem**: In `contenteditable`, an empty `<p></p>` collapses to `0px` height.
- **The Solution**: The `Reconciler` dynamically injects a `<br>` element into the DOM when an `ElementNode` has no children (`node.__size === 0`).
- **State Purity**: This `<br>` does **not** exist in the `EditorState`. It is purely an illusion maintained by the reconciler.
- **Tracking**: The reconciler must flag this `<br>` so the rest of the system knows it is "managed" and not a user-inserted foreign element.

## Implementation Phases

### Phase 1: Core Node Implementation

- Create `libs/editor/src/lib/editor/core/nodes/line-break-node.ts`.
- Implement `exportJSON`, `importJSON`, and `createDOM`.
- Export `LineBreakNode` and `$createLineBreakNode` via node utilities and the public index.
- Update `snapshot.ts` to include `SerializedLineBreakNode` in the node type unions.

### Phase 2: Reconciler Updates

- Update `reconciler.ts` to handle rendering the explicit `LineBreakNode`.
- Add logic to the reconciler's element rendering path:
  - When rendering an `ElementNode`, if it is empty, append a `<br>` DOM element.
  - Remove this `<br>` dynamically if the `ElementNode` gains children.
- Flag the managed `<br>` (e.g., via a WeakMap or a custom property) so it can be identified.

### Phase 3: Selection and Mutation Defense

- **Selection Bridge**: Update the DOM-to-model selection logic. If the browser reports a native selection anchoring on or inside a managed `<br>`, map that selection to `offset: 0` of the parent `ElementNode`.
- **Mutation Observer**: Update the mutation observer (or prepare for its implementation per `mutation-observer-roadmap.md`) to ignore DOM additions/removals involving managed line breaks, ensuring they are not mistakenly stripped as foreign HTML.

### Phase 4: Commands and Keybindings

- Implement a command (e.g., `INSERT_LINE_BREAK_COMMAND`) to use `$createLineBreakNode` and bind it to `Shift+Enter`.
- Implement a command (e.g., `INSERT_TAB_COMMAND`) and logic regarding this command to handle tab insertion.

## Acceptance Criteria

- [ ] `$createLineBreakNode()` creates a valid leaf node.
- [ ] Inserting a `LineBreakNode` outputs a `<br>` tag in the DOM.
- [ ] Creating an empty paragraph node automatically renders `<p><br></p>` in the DOM.
- [ ] Typing into the empty paragraph removes the managed `<br>` tag, rendering `<p>text</p>`.
- [ ] Deleting all text in a paragraph restores the managed `<br>` tag.
- [ ] Clicking on an empty paragraph successfully places the cursor inside it.
- [ ] Serializing and deserializing state containing `LineBreakNode`s works flawlessly.
- [ ] `Shift+Enter` successfully triggers the line break command.
- [ ] Tab command is implemented and handles tab insertion correctly.
