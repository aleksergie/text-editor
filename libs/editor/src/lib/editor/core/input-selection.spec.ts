import { createTextRange } from './selection';
import { EditorState } from './state';
import { $isElementNode, $isTextNode } from './nodes/node-utils';
import { TextNode } from './nodes/text-node';
import { TextFormat } from './text-format';

function paragraphTexts(state: EditorState): string[][] {
  const root = state.nodes.get(state.rootKey);
  if (!$isElementNode(root)) {
    return [];
  }

  const result: string[][] = [];
  let blockKey = root.__first;
  while (blockKey) {
    const block = state.nodes.get(blockKey);
    const paragraph: string[] = [];
    if ($isElementNode(block)) {
      let textKey = block.__first;
      while (textKey) {
        const node = state.nodes.get(textKey);
        if ($isTextNode(node)) {
          paragraph.push(node.text);
        }
        textKey = node?.__next ?? null;
      }
    }
    result.push(paragraph);
    blockKey = block?.__next ?? null;
  }
  return result;
}

function paragraphRuns(state: EditorState): Array<Array<{ text: string; format: number }>> {
  const root = state.nodes.get(state.rootKey);
  if (!$isElementNode(root)) {
    return [];
  }

  const result: Array<Array<{ text: string; format: number }>> = [];
  let blockKey = root.__first;
  while (blockKey) {
    const block = state.nodes.get(blockKey);
    const paragraph: Array<{ text: string; format: number }> = [];
    if ($isElementNode(block)) {
      let textKey = block.__first;
      while (textKey) {
        const node = state.nodes.get(textKey);
        if ($isTextNode(node)) {
          paragraph.push({ text: node.text, format: node.format });
        }
        textKey = node?.__next ?? null;
      }
    }
    result.push(paragraph);
    blockKey = block?.__next ?? null;
  }
  return result;
}

function splitTextIntoRuns(state: EditorState, first: TextNode): TextNode[] {
  const { right: tail } = state.splitTextNodeAt(first, 2);
  if (!tail) {
    return [first];
  }
  tail.format = TextFormat.BOLD;
  const { right: finalRun } = state.splitTextNodeAt(tail, 2);
  if (finalRun) {
    finalRun.format = TextFormat.ITALIC;
    return [first, tail, finalRun];
  }
  return [first, tail];
}

function splitBaselineTextIntoRuns(state: EditorState): TextNode[] {
  return splitTextIntoRuns(state, state.nodes.get('t1') as TextNode);
}

describe('selection-aware EditorState mutations', () => {
  let state: EditorState;

  beforeEach(() => {
    state = EditorState.createEmpty();
    state.setText('abcdef');
    state.clearDirtyNodeKeys();
  });

  it('insertTextAtRange inserts at a collapsed middle caret', () => {
    const range = createTextRange(
      { key: 't1', offset: 3 },
      { key: 't1', offset: 3 },
      false,
    );

    const next = state.insertTextAtRange(range, 'X');

    expect(state.getText()).toBe('abcXdef');
    expect(next.anchor.offset).toBe(4);
  });

  it('insertTextAtRange replaces an expanded range', () => {
    const range = createTextRange(
      { key: 't1', offset: 1 },
      { key: 't1', offset: 4 },
      false,
    );

    const next = state.insertTextAtRange(range, 'Y');

    expect(state.getText()).toBe('aYef');
    expect(next.anchor.offset).toBe(2);
  });

  it('deleteCharacterAtRange removes the character before a collapsed caret', () => {
    const range = createTextRange(
      { key: 't1', offset: 3 },
      { key: 't1', offset: 3 },
      false,
    );

    const next = state.deleteCharacterAtRange(range, true);

    expect(state.getText()).toBe('abdef');
    expect(next?.anchor.offset).toBe(2);
  });

  it('deleteCharacterAtRange clears an expanded range', () => {
    const range = createTextRange(
      { key: 't1', offset: 1 },
      { key: 't1', offset: 4 },
      false,
    );

    const next = state.deleteCharacterAtRange(range, true);

    expect(state.getText()).toBe('aef');
    expect(next?.anchor.offset).toBe(1);
  });

  it('insertParagraphAtRange splits a paragraph in the middle', () => {
    const range = createTextRange(
      { key: 't1', offset: 3 },
      { key: 't1', offset: 3 },
      false,
    );

    const next = state.insertParagraphAtRange(range);

    expect(state.getText()).toBe('abcdef');
    expect(state.getTextNodesInDocumentOrder()).toHaveLength(2);
    expect(next?.anchor.offset).toBe(0);
  });

  it('insertParagraphAtRange moves every trailing text run into the new paragraph', () => {
    const [first] = splitBaselineTextIntoRuns(state);
    const range = createTextRange(
      { key: first.key, offset: 1 },
      { key: first.key, offset: 1 },
      false,
    );

    const next = state.insertParagraphAtRange(range);

    expect(paragraphTexts(state)).toEqual([['a'], ['b', 'cd', 'ef']]);
    expect(next?.anchor.key).toBe(state.getTextNodesInDocumentOrder()[1].key);
    expect(next?.anchor.offset).toBe(0);
  });

  it('insertParagraphAtRange splits before an interior text run at offset zero', () => {
    const [, middle] = splitBaselineTextIntoRuns(state);

    const next = state.insertParagraphAtRange(
      createTextRange(
        { key: middle.key, offset: 0 },
        { key: middle.key, offset: 0 },
        false,
      ),
    );

    expect(paragraphTexts(state)).toEqual([['ab'], ['cd', 'ef']]);
    expect(next?.anchor.key).toBe(middle.key);
    expect(next?.anchor.offset).toBe(0);
  });

  it('insertParagraphAtRange splits after an interior text run at its end', () => {
    const [, middle, finalRun] = splitBaselineTextIntoRuns(state);

    const next = state.insertParagraphAtRange(
      createTextRange(
        { key: middle.key, offset: middle.text.length },
        { key: middle.key, offset: middle.text.length },
        false,
      ),
    );

    expect(paragraphTexts(state)).toEqual([['ab', 'cd'], ['ef']]);
    expect(next?.anchor.key).toBe(finalRun.key);
    expect(next?.anchor.offset).toBe(0);
  });

  it('deleteCharacterAtRange backspaces across text runs before merging paragraphs', () => {
    state.setText('xx');
    const secondParagraphSelection = state.insertParagraphAtRange(
      createTextRange(
        { key: 't1', offset: 2 },
        { key: 't1', offset: 2 },
        false,
      ),
    );
    expect(secondParagraphSelection).not.toBeNull();
    state.insertTextAtRange(secondParagraphSelection!, 'abcdef');
    const secondText = state.nodes.get(secondParagraphSelection!.anchor.key) as TextNode;
    const [firstRun, middle] = splitTextIntoRuns(state, secondText);

    const next = state.deleteCharacterAtRange(
      createTextRange(
        { key: middle.key, offset: 0 },
        { key: middle.key, offset: 0 },
        false,
      ),
      true,
    );

    expect(paragraphTexts(state)).toEqual([['xx'], ['a', 'cd', 'ef']]);
    expect(next?.anchor.key).toBe(firstRun.key);
    expect(next?.anchor.offset).toBe(1);
  });

  it('deleteCharacterAtRange deletes forward across text runs before merging paragraphs', () => {
    const [, middle, finalRun] = splitBaselineTextIntoRuns(state);
    const secondParagraphSelection = state.insertParagraphAtRange(
      createTextRange(
        { key: finalRun.key, offset: finalRun.text.length },
        { key: finalRun.key, offset: finalRun.text.length },
        false,
      ),
    );
    expect(secondParagraphSelection).not.toBeNull();
    state.insertTextAtRange(secondParagraphSelection!, 'zz');

    const next = state.deleteCharacterAtRange(
      createTextRange(
        { key: middle.key, offset: middle.text.length },
        { key: middle.key, offset: middle.text.length },
        false,
      ),
      false,
    );

    expect(paragraphTexts(state)).toEqual([['ab', 'cd', 'f'], ['zz']]);
    expect(next?.anchor.key).toBe(middle.key);
    expect(next?.anchor.offset).toBe(2);
  });

  it('deleteTextInRange preserves the unselected suffix text run format', () => {
    const [first, middle] = splitBaselineTextIntoRuns(state);

    const next = state.deleteTextInRange(
      createTextRange(
        { key: first.key, offset: 1 },
        { key: middle.key, offset: 1 },
        false,
      ),
    );

    expect(paragraphRuns(state)).toEqual([
      [
        { text: 'a', format: TextFormat.NONE },
        { text: 'd', format: TextFormat.BOLD },
        { text: 'ef', format: TextFormat.ITALIC },
      ],
    ]);
    expect(next).toEqual({ key: first.key, offset: 1 });
  });

  it('deleteTextInRange preserves suffix format when removing a paragraph boundary', () => {
    state.setText('ab');
    const secondParagraphSelection = state.insertParagraphAtRange(
      createTextRange(
        { key: 't1', offset: 2 },
        { key: 't1', offset: 2 },
        false,
      ),
    );
    expect(secondParagraphSelection).not.toBeNull();
    state.insertTextAtRange(secondParagraphSelection!, 'cd');
    const secondText = state.nodes.get(secondParagraphSelection!.anchor.key) as TextNode;
    secondText.format = TextFormat.BOLD;

    const next = state.deleteTextInRange(
      createTextRange(
        { key: 't1', offset: 1 },
        { key: secondText.key, offset: 1 },
        false,
      ),
    );

    expect(paragraphRuns(state)).toEqual([
      [
        { text: 'a', format: TextFormat.NONE },
        { text: 'd', format: TextFormat.BOLD },
      ],
    ]);
    expect(next).toEqual({ key: 't1', offset: 1 });
  });

  it('deleteCharacterAtRange at paragraph start merges the whole paragraph backward', () => {
    state.setText('ab');
    const secondParagraphSelection = state.insertParagraphAtRange(
      createTextRange(
        { key: 't1', offset: 2 },
        { key: 't1', offset: 2 },
        false,
      ),
    );
    expect(secondParagraphSelection).not.toBeNull();
    state.insertTextAtRange(secondParagraphSelection!, 'cd');
    const secondText = state.nodes.get(secondParagraphSelection!.anchor.key) as TextNode;
    const { right } = state.splitTextNodeAt(secondText, 1);
    if (right) {
      right.format = TextFormat.BOLD;
    }

    const next = state.deleteCharacterAtRange(
      createTextRange(
        { key: secondText.key, offset: 0 },
        { key: secondText.key, offset: 0 },
        false,
      ),
      true,
    );

    expect(paragraphTexts(state)).toEqual([['abc', 'd']]);
    expect(next?.anchor.key).toBe('t1');
    expect(next?.anchor.offset).toBe(2);
  });

  it('deleteCharacterAtRange at paragraph end merges the whole next paragraph forward', () => {
    state.setText('ab');
    const secondParagraphSelection = state.insertParagraphAtRange(
      createTextRange(
        { key: 't1', offset: 2 },
        { key: 't1', offset: 2 },
        false,
      ),
    );
    expect(secondParagraphSelection).not.toBeNull();
    state.insertTextAtRange(secondParagraphSelection!, 'cd');
    const secondText = state.nodes.get(secondParagraphSelection!.anchor.key) as TextNode;
    const { right } = state.splitTextNodeAt(secondText, 1);
    if (right) {
      right.format = TextFormat.BOLD;
    }

    const next = state.deleteCharacterAtRange(
      createTextRange(
        { key: 't1', offset: 2 },
        { key: 't1', offset: 2 },
        false,
      ),
      false,
    );

    expect(paragraphTexts(state)).toEqual([['abc', 'd']]);
    expect(next?.anchor.key).toBe('t1');
    expect(next?.anchor.offset).toBe(2);
  });
});
