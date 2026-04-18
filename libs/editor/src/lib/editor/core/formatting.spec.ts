import { FORMAT_TEXT } from './commands';
import { Editor } from './editor';
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
} from './nodes/node-utils';
import { TextNode } from './nodes/text-node';
import { TextRange, createTextRange } from './selection';
import { EditorState } from './state';
import { TextFormat, hasFormat } from './text-format';

/**
 * Build a fixture document: root > paragraph > text nodes with given runs.
 * Returns the editor and the keys of the seeded text nodes in order.
 */
function seedEditor(
  runs: Array<{ text: string; format?: number }>,
): { editor: Editor; keys: string[] } {
  const editor = new Editor();
  editor.update((state) => {
    // Reuse baseline paragraph + empty text node, then append more siblings.
    const baselineText = state.getTextNodesInDocumentOrder()[0];
    baselineText.text = runs[0].text;
    baselineText.setFormat(runs[0].format ?? 0);
    state.markDirty(baselineText.key);

    let prev: TextNode = baselineText;
    for (let i = 1; i < runs.length; i += 1) {
      const next = $createTextNode(`seed_t${i}`, runs[i].text, runs[i].format ?? 0);
      state.insertAfter(prev, next);
      prev = next;
    }
  });
  const keys = editor
    .getEditorState()
    .getTextNodesInDocumentOrder()
    .map((n) => n.key);
  return { editor, keys };
}

function rangeBetween(
  anchorKey: string,
  anchorOffset: number,
  focusKey: string,
  focusOffset: number,
): TextRange {
  return createTextRange(
    { key: anchorKey, offset: anchorOffset },
    { key: focusKey, offset: focusOffset },
    false,
  );
}

function snapshotRuns(state: EditorState): Array<{ text: string; format: number }> {
  return state.getTextNodesInDocumentOrder().map((n) => ({
    text: n.text,
    format: n.format,
  }));
}

describe('FORMAT_TEXT command', () => {
  it('formats a sub-range inside a single text node by splitting into 3 runs', () => {
    const { editor, keys } = seedEditor([{ text: 'helloworld' }]);
    const range = rangeBetween(keys[0], 2, keys[0], 7);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const runs = snapshotRuns(editor.getEditorState());
    expect(runs.map((r) => r.text)).toEqual(['he', 'llowo', 'rld']);
    expect(runs[0].format).toBe(0);
    expect(runs[1].format).toBe(TextFormat.BOLD);
    expect(runs[2].format).toBe(0);
  });

  it('formats a range exactly spanning one text node without extra splits', () => {
    const { editor, keys } = seedEditor([{ text: 'abc' }]);
    const range = rangeBetween(keys[0], 0, keys[0], 3);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const runs = snapshotRuns(editor.getEditorState());
    expect(runs).toEqual([{ text: 'abc', format: TextFormat.BOLD }]);
  });

  it('formats a range spanning two text nodes by splitting only the edges', () => {
    const { editor, keys } = seedEditor([{ text: 'alpha' }, { text: 'beta' }]);
    // Cover "pha" + "be"
    const range = rangeBetween(keys[0], 2, keys[1], 2);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    // The two bolded halves share a parent paragraph and the same format,
    // so the merge pass folds them into a single run - exactly the behavior
    // we want so the node graph stays compact.
    const runs = snapshotRuns(editor.getEditorState());
    expect(runs.map((r) => r.text)).toEqual(['al', 'phabe', 'ta']);
    expect(runs[0].format).toBe(0);
    expect(runs[1].format).toBe(TextFormat.BOLD);
    expect(runs[2].format).toBe(0);
  });

  it('does not merge same-format runs across paragraph boundaries', () => {
    const editor = new Editor();
    editor.update((state) => {
      const firstText = state.getTextNodesInDocumentOrder()[0];
      firstText.text = 'left';
      firstText.setFormat(TextFormat.BOLD);
      state.markDirty(firstText.key);

      const p2 = $createParagraphNode('p2');
      const t2 = $createTextNode('t2', 'right', TextFormat.BOLD);
      state.registerNode(p2);
      state.registerNode(t2);
      p2.append(state.nodes, t2);
      const root = state.nodes.get(state.rootKey);
      if ($isElementNode(root)) {
        root.append(state.nodes, p2);
        state.markDirty(state.rootKey);
      }
    });

    // Dispatch a no-op format change over just the first paragraph's run.
    const range = rangeBetween('t1', 0, 't1', 4);
    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.ITALIC, range });

    const nodes = editor.getEditorState().getTextNodesInDocumentOrder();
    // Still two separate text nodes in two paragraphs.
    expect(nodes.length).toBe(2);
    expect(nodes[0].parent).not.toBe(nodes[1].parent);
  });

  it('removes the flag when every covered node already has it', () => {
    const { editor, keys } = seedEditor([
      { text: 'aaa', format: TextFormat.BOLD },
      { text: 'bbb', format: TextFormat.BOLD },
    ]);
    const range = rangeBetween(keys[0], 0, keys[1], 3);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const runs = snapshotRuns(editor.getEditorState());
    // After removing bold from everything, the two runs should merge.
    expect(runs).toEqual([{ text: 'aaabbb', format: 0 }]);
  });

  it('applies the flag to all when any covered char is missing it', () => {
    const { editor, keys } = seedEditor([
      { text: 'aaa', format: TextFormat.BOLD },
      { text: 'bbb' },
    ]);
    const range = rangeBetween(keys[0], 0, keys[1], 3);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const runs = snapshotRuns(editor.getEditorState());
    // Everything bold now, so runs merge.
    expect(runs).toEqual([{ text: 'aaabbb', format: TextFormat.BOLD }]);
  });

  it('merges adjacent same-format siblings after mutation', () => {
    const { editor, keys } = seedEditor([
      { text: 'pre', format: TextFormat.BOLD },
      { text: 'post' },
    ]);
    // Format "post" bold -> should merge with "pre"
    const range = rangeBetween(keys[1], 0, keys[1], 4);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const runs = snapshotRuns(editor.getEditorState());
    expect(runs).toEqual([{ text: 'prepost', format: TextFormat.BOLD }]);
  });

  it('is a no-op for collapsed ranges', () => {
    const { editor, keys } = seedEditor([{ text: 'abc' }]);
    const range = rangeBetween(keys[0], 1, keys[0], 1);

    const before = snapshotRuns(editor.getEditorState());
    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });
    const after = snapshotRuns(editor.getEditorState());

    expect(after).toEqual(before);
  });

  it('composes format bits when applied sequentially', () => {
    const { editor, keys } = seedEditor([{ text: 'hello' }]);
    const range = rangeBetween(keys[0], 0, keys[0], 5);

    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });
    // Re-derive key after first format (the node was in-place updated, same key).
    const updatedKeys = editor
      .getEditorState()
      .getTextNodesInDocumentOrder()
      .map((n) => n.key);
    const nextRange = rangeBetween(updatedKeys[0], 0, updatedKeys[0], 5);
    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.ITALIC, range: nextRange });

    const runs = snapshotRuns(editor.getEditorState());
    expect(runs).toHaveLength(1);
    expect(hasFormat(runs[0].format, TextFormat.BOLD)).toBe(true);
    expect(hasFormat(runs[0].format, TextFormat.ITALIC)).toBe(true);
  });

  it('formats a range that spans across two paragraphs', () => {
    const editor = new Editor();
    editor.update((state) => {
      // baseline has "" in p1; append p2 > "world"
      const firstText = state.getTextNodesInDocumentOrder()[0];
      firstText.text = 'hello';
      state.markDirty(firstText.key);

      const p2 = $createParagraphNode('p2');
      const t2 = $createTextNode('t2', 'world');
      state.registerNode(p2);
      state.registerNode(t2);
      p2.append(state.nodes, t2);
      const root = state.nodes.get(state.rootKey);
      if ($isElementNode(root)) {
        root.append(state.nodes, p2);
        state.markDirty(state.rootKey);
      }
    });

    // Range covers "llo" (in p1) + "wo" (in p2)
    const range = rangeBetween('t1', 2, 't2', 2);
    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });

    const nodes = editor.getEditorState().getTextNodesInDocumentOrder();
    const runs = nodes.map((n) => ({
      text: n.text,
      format: n.format,
      parent: n.parent,
    }));
    // Expect: p1 > "he" + "llo"(bold) ; p2 > "wo"(bold) + "rld"
    expect(runs.map((r) => r.text)).toEqual(['he', 'llo', 'wo', 'rld']);
    expect(runs[0].format).toBe(0);
    expect(runs[1].format).toBe(TextFormat.BOLD);
    expect(runs[2].format).toBe(TextFormat.BOLD);
    expect(runs[3].format).toBe(0);
    // Paragraph boundary preserved: the two bolded runs have different parents.
    expect(runs[1].parent).not.toBe(runs[2].parent);
  });

  it('handler returns true to short-circuit the bus', () => {
    const { editor, keys } = seedEditor([{ text: 'abc' }]);
    let lowerHandlerRan = false;
    // Register a lower-priority handler -- should NOT run because default
    // handler returns true.
    editor.registerCommand(
      FORMAT_TEXT,
      () => {
        lowerHandlerRan = true;
        return false;
      },
      0,
    );
    const range = rangeBetween(keys[0], 0, keys[0], 3);
    const result = editor.dispatchCommand(FORMAT_TEXT, {
      format: TextFormat.BOLD,
      range,
    });

    expect(result).toBe(true);
    expect(lowerHandlerRan).toBe(false);
  });
});

describe('EditorState.splitTextNodeAt', () => {
  it('splits in the middle and preserves format on both halves', () => {
    const state = EditorState.createEmpty();
    const t = state.getTextNodesInDocumentOrder()[0];
    t.text = 'helloworld';
    t.setFormat(TextFormat.ITALIC);

    const { left, right } = state.splitTextNodeAt(t, 5);

    expect(left).toBe(t);
    expect(left?.text).toBe('hello');
    expect(right?.text).toBe('world');
    expect(right?.format).toBe(TextFormat.ITALIC);
    // Insertion order preserved: left.next === right.key
    expect(left?.next).toBe(right?.key);
  });

  it('returns { left: null, right: node } for offset 0', () => {
    const state = EditorState.createEmpty();
    const t = state.getTextNodesInDocumentOrder()[0];
    t.text = 'xy';
    const result = state.splitTextNodeAt(t, 0);
    expect(result.left).toBeNull();
    expect(result.right).toBe(t);
  });

  it('returns { left: node, right: null } for offset === text.length', () => {
    const state = EditorState.createEmpty();
    const t = state.getTextNodesInDocumentOrder()[0];
    t.text = 'xy';
    const result = state.splitTextNodeAt(t, 2);
    expect(result.left).toBe(t);
    expect(result.right).toBeNull();
  });
});
