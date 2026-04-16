import { fromPlainText, toPlainText } from './plain-text';
import { EditorState } from './state';

describe('toPlainText', () => {
  it('returns empty string for the baseline empty state', () => {
    expect(toPlainText(EditorState.createEmpty())).toBe('');
  });

  it('joins paragraph text with \\n', () => {
    const state = fromPlainText('one\ntwo\nthree');
    expect(toPlainText(state)).toBe('one\ntwo\nthree');
  });

  it('preserves empty paragraphs as empty lines', () => {
    const state = fromPlainText('line1\n\nline3');
    expect(toPlainText(state)).toBe('line1\n\nline3');
  });
});

describe('fromPlainText', () => {
  it('produces a single empty paragraph for empty input', () => {
    const state = fromPlainText('');
    expect(state.getText()).toBe('');
    expect(toPlainText(state)).toBe('');
  });

  it('creates one paragraph per newline-delimited line', () => {
    const state = fromPlainText('a\nb\nc');

    const root = state.nodes.get(state.rootKey) as unknown as { __size: number };
    expect(root.__size).toBe(3);
  });

  it('round-trips through toPlainText', () => {
    const cases = [
      '',
      'hello',
      'hello\nworld',
      'line1\n\nline3',
      'trailing\n',
    ];

    for (const input of cases) {
      expect(toPlainText(fromPlainText(input))).toBe(input);
    }
  });

  it('survives a JSON round-trip', () => {
    const original = fromPlainText('serialize\nme\nplease');
    const snapshot = original.toJSON();

    const restored = EditorState.fromJSON(snapshot);

    expect(toPlainText(restored)).toBe('serialize\nme\nplease');
  });
});
