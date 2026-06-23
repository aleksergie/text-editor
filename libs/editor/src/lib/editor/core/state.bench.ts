import { bench, describe } from 'vitest';
import { EditorState } from './state';
import { createTextRange } from './selection';
import { TextFormat } from './text-format';

function buildLargeDoc(paragraphs: number, charsPerParagraph: number): EditorState {
  const state = EditorState.createEmpty();
  const filler = 'x'.repeat(charsPerParagraph);
  for (let i = 0; i < paragraphs; i += 1) {
    state.insertText(filler);
    if (i < paragraphs - 1) {
      state.insertParagraph();
    }
  }
  state.clearDirtyNodeKeys();
  return state;
}

describe('EditorState construction', () => {
  bench('build 100 paragraphs x 80 chars', () => {
    buildLargeDoc(100, 80);
  });

  bench('build 1000 paragraphs x 80 chars', () => {
    buildLargeDoc(1000, 80);
  });
});

describe('EditorState edit ops on large doc', () => {
  const docSmall = buildLargeDoc(100, 80);
  const docLarge = buildLargeDoc(1000, 80);

  bench('insertText tail on 100-paragraph doc', () => {
    docSmall.insertText('a');
    docSmall.clearDirtyNodeKeys();
  });

  bench('insertText tail on 1000-paragraph doc', () => {
    docLarge.insertText('a');
    docLarge.clearDirtyNodeKeys();
  });

  bench('applyFormat BOLD across full 100-paragraph doc', () => {
    const all = docSmall.getTextNodesInDocumentOrder();
    const first = all[0];
    const last = all[all.length - 1];
    const range = createTextRange(
      { key: first.key, offset: 0 },
      { key: last.key, offset: last.text.length },
      false,
    );
    docSmall.applyFormatToRange(range, TextFormat.BOLD);
    docSmall.clearDirtyNodeKeys();
  });
});

describe('EditorState COW-sensitive scenarios', () => {
  const midInsertDoc = buildLargeDoc(1000, 80);
  const midInsertTargets = midInsertDoc.getTextNodesInDocumentOrder();
  const midNode = midInsertTargets[Math.floor(midInsertTargets.length / 2)];

  bench('single-char mid-doc insert (1000 paragraphs)', () => {
    const range = createTextRange(
      { key: midNode.key, offset: 0 },
      { key: midNode.key, offset: 0 },
      false,
    );
    midInsertDoc.insertTextAtRange(range, 'a');
    midInsertDoc.clearDirtyNodeKeys();
  });

  const localFormatDoc = buildLargeDoc(1000, 80);
  const localFormatTargets = localFormatDoc.getTextNodesInDocumentOrder();
  const localTarget = localFormatTargets[Math.floor(localFormatTargets.length / 2)];

  bench('repeated BOLD toggle on one mid-doc paragraph (1000 paragraphs)', () => {
    const range = createTextRange(
      { key: localTarget.key, offset: 0 },
      { key: localTarget.key, offset: localTarget.text.length },
      false,
    );
    localFormatDoc.applyFormatToRange(range, TextFormat.BOLD);
    localFormatDoc.clearDirtyNodeKeys();
  });

  bench(
    'typing burst: 50 tail appends on 500-paragraph doc',
    () => {
      const doc = buildLargeDoc(500, 80);
      for (let i = 0; i < 50; i += 1) {
        doc.insertText('a');
        doc.clearDirtyNodeKeys();
      }
    },
    { iterations: 20 },
  );
});
