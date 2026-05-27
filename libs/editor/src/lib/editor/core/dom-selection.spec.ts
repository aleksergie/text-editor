import { createEditor } from './editor';
import { findDomPointInHost, writeDomSelection } from './dom-selection';
import { createTextRange } from './selection';

describe('dom-selection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('maps a model offset to a DOM text node inside a formatted host', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    document.body.appendChild(root);
    editor.setRoot(root);
    editor.update((state) => state.setText('abc'));

    const host = editor.getDomForKey('t1');
    expect(host).not.toBeNull();

    const point = findDomPointInHost(host!, 2, 3);
    expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
    expect(point?.offset).toBe(2);
  });

  it('returns null for hosts with no text nodes', () => {
    const point = findDomPointInHost(document.createElement('span'), 0, 0);
    expect(point).toBeNull();
  });
});

describe('writeDomSelection integration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not throw when the model selection is stale after a root swap', () => {
    const editor = createEditor();
    const rootA = document.createElement('div');
    const rootB = document.createElement('div');
    document.body.appendChild(rootA);
    document.body.appendChild(rootB);
    editor.setRoot(rootA);
    editor.update((state) => state.setText('hello'), { syncDomSelection: true });
    editor.setRoot(rootB);

    expect(() => {
      editor.update((state) => state.setText('next'), { syncDomSelection: true });
    }).not.toThrow();
  });

  it('preserves backward anchor and focus when writing DOM selection', () => {
    const editor = createEditor();
    const root = document.createElement('div');
    document.body.appendChild(root);
    editor.setRoot(root);
    editor.update((state) => state.setText('abcd'));

    const range = createTextRange(
      { key: 't1', offset: 3 },
      { key: 't1', offset: 1 },
      true,
    );

    expect(writeDomSelection(editor, root, range)).toBe(true);

    const selection = window.getSelection();
    expect(selection?.anchorOffset).toBe(3);
    expect(selection?.focusOffset).toBe(1);
  });
});
