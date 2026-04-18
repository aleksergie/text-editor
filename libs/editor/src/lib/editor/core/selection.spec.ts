import { Editor } from './editor';
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
} from './nodes/node-utils';
import { resolveDomSelection } from './selection';
import { TextFormat } from './text-format';

/**
 * Build a helper that mounts a configured Editor into a detached HTMLElement
 * and returns a synthetic window exposing `getSelection()`. This lets us
 * exercise `resolveDomSelection` against real rendered DOM without a real
 * browser selection (which jsdom does not fully model).
 */
function mount(text: string, format: number = TextFormat.NONE) {
  const editor = new Editor();
  const container = document.createElement('div');
  editor.setRoot(container);
  editor.update((state) => {
    const t = state.getTextNodesInDocumentOrder()[0];
    t.text = text;
    t.setFormat(format);
    state.markDirty(t.key);
  });
  return { editor, container };
}

function makeWindow(selection: Partial<Selection>): Window & typeof globalThis {
  return {
    getSelection: () => selection as Selection,
  } as unknown as Window & typeof globalThis;
}

describe('resolveDomSelection', () => {
  it('returns null when there is no active selection', () => {
    const { editor } = mount('hello');
    const win = makeWindow({ rangeCount: 0 });
    expect(resolveDomSelection(editor, win)).toBeNull();
  });

  /**
   * Walk `container > <p> > <span> > (format stack?) > text node` so tests
   * can anchor selections at the innermost DOM text node.
   */
  function getInnermostText(container: HTMLElement): Text {
    const paragraph = container.firstElementChild as HTMLElement;
    const span = paragraph.firstElementChild as HTMLElement;
    let cursor: Node = span;
    while (cursor.firstChild && cursor.firstChild.nodeType === Node.ELEMENT_NODE) {
      cursor = cursor.firstChild;
    }
    return cursor.firstChild as Text;
  }

  it('maps a same-node selection into model offsets', () => {
    const { editor, container } = mount('helloworld');
    const textNode = getInnermostText(container);

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 2,
      focusNode: textNode,
      focusOffset: 7,
    });

    const range = resolveDomSelection(editor, win);
    expect(range).not.toBeNull();
    expect(range?.anchor).toEqual({ key: 't1', offset: 2 });
    expect(range?.focus).toEqual({ key: 't1', offset: 7 });
    expect(range?.isCollapsed).toBe(false);
    expect(range?.isBackward).toBe(false);
  });

  it('detects collapsed selections', () => {
    const { editor, container } = mount('abc');
    const textNode = getInnermostText(container);

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 1,
      focusNode: textNode,
      focusOffset: 1,
    });

    const range = resolveDomSelection(editor, win);
    expect(range?.isCollapsed).toBe(true);
  });

  it('detects backward selections within a single text node', () => {
    const { editor, container } = mount('abcdef');
    const textNode = getInnermostText(container);

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: textNode,
      anchorOffset: 4,
      focusNode: textNode,
      focusOffset: 1,
    });

    const range = resolveDomSelection(editor, win);
    expect(range?.isBackward).toBe(true);
    expect(range?.anchor.offset).toBe(4);
    expect(range?.focus.offset).toBe(1);
  });

  it('walks up through nested formatting tags to find the TextNode key', () => {
    const { editor, container } = mount('bold', TextFormat.BOLD);
    // Rendered: <p><span><strong>bold</strong></span></p>
    const text = getInnermostText(container);

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: text,
      anchorOffset: 1,
      focusNode: text,
      focusOffset: 3,
    });

    const range = resolveDomSelection(editor, win);
    expect(range?.anchor.key).toBe('t1');
    expect(range?.anchor.offset).toBe(1);
    expect(range?.focus.offset).toBe(3);
  });

  it('returns null when selection is anchored on a non-text model node', () => {
    const { editor, container } = mount('abc');
    // Anchor the paragraph <p>, which is an element node in the model.
    const paragraph = container.firstElementChild;

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: paragraph,
      anchorOffset: 0,
      focusNode: paragraph,
      focusOffset: 0,
    });

    expect(resolveDomSelection(editor, win)).toBeNull();
  });

  it('resolves selections spanning two sibling text nodes', () => {
    const editor = new Editor();
    const container = document.createElement('div');
    editor.setRoot(container);
    editor.update((state) => {
      const first = state.getTextNodesInDocumentOrder()[0];
      first.text = 'alpha';
      state.markDirty(first.key);
      const second = $createTextNode('seed_t2', 'beta');
      state.insertAfter(first, second);
    });

    // Paragraph > [<span>alpha</span>, <span>beta</span>]
    const paragraph = container.firstElementChild as HTMLElement;
    const firstSpan = paragraph.firstElementChild as HTMLElement;
    const secondSpan = firstSpan.nextElementSibling as HTMLElement;
    const firstText = firstSpan.firstChild as Text;
    const secondText = secondSpan.firstChild as Text;

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: firstText,
      anchorOffset: 2,
      focusNode: secondText,
      focusOffset: 2,
    });

    const range = resolveDomSelection(editor, win);
    expect(range?.anchor.key).toBe('t1');
    expect(range?.focus.key).toBe('seed_t2');
    expect(range?.isBackward).toBe(false);
  });

  it('resolves cross-paragraph selections', () => {
    const editor = new Editor();
    const container = document.createElement('div');
    editor.setRoot(container);
    editor.update((state) => {
      const first = state.getTextNodesInDocumentOrder()[0];
      first.text = 'hello';
      state.markDirty(first.key);

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

    const p1 = container.firstElementChild as HTMLElement;
    const p2 = p1.nextElementSibling as HTMLElement;
    const text1 = p1.firstElementChild?.firstChild as Text;
    const text2 = p2.firstElementChild?.firstChild as Text;

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: text1,
      anchorOffset: 2,
      focusNode: text2,
      focusOffset: 3,
    });

    const range = resolveDomSelection(editor, win);
    expect(range?.anchor).toEqual({ key: 't1', offset: 2 });
    expect(range?.focus).toEqual({ key: 't2', offset: 3 });
    expect(range?.isBackward).toBe(false);
  });

  it('returns null when the selection is outside the editor root', () => {
    const { editor } = mount('abc');
    const outside = document.createElement('div');
    outside.textContent = 'nope';
    const outsideText = outside.firstChild as Text;

    const win = makeWindow({
      rangeCount: 1,
      anchorNode: outsideText,
      anchorOffset: 0,
      focusNode: outsideText,
      focusOffset: 2,
    });

    expect(resolveDomSelection(editor, win)).toBeNull();
  });
});

describe('Editor.keyForDomNode', () => {
  it('walks from a nested formatting descendant back to the TextNode key', () => {
    const { editor, container } = mount('hi', TextFormat.BOLD | TextFormat.CODE);
    // <p><span><strong><code>hi</code></strong></span></p>
    const paragraph = container.firstElementChild as HTMLElement;
    const span = paragraph.firstElementChild as HTMLElement;
    const strong = span.firstElementChild as HTMLElement;
    const code = strong.firstElementChild as HTMLElement;
    const text = code.firstChild as Text;

    expect(editor.keyForDomNode(text)).toBe('t1');
    expect(editor.keyForDomNode(code)).toBe('t1');
    expect(editor.keyForDomNode(strong)).toBe('t1');
    expect(editor.keyForDomNode(span)).toBe('t1');
    // Walking past the span should find the paragraph's key.
    expect(editor.keyForDomNode(paragraph)).toBe('p1');
  });

  it('returns null for nodes outside the rendered tree', () => {
    const { editor } = mount('hi');
    const stray = document.createElement('div');
    expect(editor.keyForDomNode(stray)).toBeNull();
    expect(editor.keyForDomNode(null)).toBeNull();
  });
});
