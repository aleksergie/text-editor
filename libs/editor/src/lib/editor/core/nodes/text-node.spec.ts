import { TextFormat } from '../text-format';
import { TextNode } from './text-node';

describe('TextNode (formatted rendering)', () => {
  it('createDOM returns a plain <span> when no format is set', () => {
    const node = new TextNode('t1', 'hello');
    const dom = node.createDOM();
    expect(dom.tagName).toBe('SPAN');
    expect(dom.textContent).toBe('hello');
    expect(dom.children.length).toBe(0);
  });

  it('createDOM wraps text in <strong> for bold', () => {
    const node = new TextNode('t1', 'hi', TextFormat.BOLD);
    const dom = node.createDOM();
    expect(dom.tagName).toBe('SPAN');
    expect(dom.children.length).toBe(1);
    expect(dom.firstElementChild?.tagName).toBe('STRONG');
    expect(dom.textContent).toBe('hi');
  });

  it('createDOM produces canonical nested order for combined formats', () => {
    const node = new TextNode(
      't1',
      'x',
      TextFormat.BOLD | TextFormat.ITALIC | TextFormat.CODE,
    );
    const dom = node.createDOM();
    // Canonical order: bold > italic > code. Underline/strikethrough absent.
    expect(dom.firstElementChild?.tagName).toBe('STRONG');
    const em = dom.firstElementChild?.firstElementChild;
    expect(em?.tagName).toBe('EM');
    const code = em?.firstElementChild;
    expect(code?.tagName).toBe('CODE');
    expect(code?.textContent).toBe('x');
  });

  it('maps each single-flag format to the expected tag', () => {
    const cases: Array<[number, string]> = [
      [TextFormat.BOLD, 'STRONG'],
      [TextFormat.ITALIC, 'EM'],
      [TextFormat.UNDERLINE, 'U'],
      [TextFormat.STRIKETHROUGH, 'S'],
      [TextFormat.CODE, 'CODE'],
    ];
    for (const [flag, tag] of cases) {
      const dom = new TextNode('t', 'x', flag).createDOM();
      expect(dom.firstElementChild?.tagName).toBe(tag);
    }
  });

  it('updateDOM rebuilds the tag stack when format changes', () => {
    const node = new TextNode('t1', 'hi');
    const dom = node.createDOM();
    expect(dom.children.length).toBe(0);

    node.format = TextFormat.BOLD;
    const mutated = node.updateDOM(dom);

    expect(mutated).toBe(true);
    expect(dom.firstElementChild?.tagName).toBe('STRONG');
    expect(dom.textContent).toBe('hi');
  });

  it('updateDOM with unchanged format only rewrites innermost text', () => {
    const node = new TextNode('t1', 'hi', TextFormat.BOLD);
    const dom = node.createDOM();
    const strongBefore = dom.firstElementChild;

    node.text = 'hello';
    const mutated = node.updateDOM(dom);

    expect(mutated).toBe(true);
    expect(dom.firstElementChild).toBe(strongBefore);
    expect(dom.textContent).toBe('hello');
  });

  it('updateDOM returns false when nothing changed', () => {
    const node = new TextNode('t1', 'hi', TextFormat.BOLD);
    const dom = node.createDOM();
    expect(node.updateDOM(dom)).toBe(false);
  });

  it('JSON round-trip preserves format', () => {
    const node = new TextNode('t1', 'hi', TextFormat.BOLD | TextFormat.ITALIC);
    const json = node.exportJSON();
    expect(json.format).toBe(TextFormat.BOLD | TextFormat.ITALIC);
    expect(json.version).toBe(2);

    const restored = TextNode.importJSON(json);
    expect(restored.format).toBe(TextFormat.BOLD | TextFormat.ITALIC);
    expect(restored.text).toBe('hi');
  });

  it('importJSON defaults missing format to 0 for V1 back-compat', () => {
    const v1Record = {
      type: 'text' as const,
      version: 1,
      key: 't1',
      parent: 'p1' as string | null,
      prev: null as string | null,
      next: null as string | null,
      text: 'hi',
    };
    const restored = TextNode.importJSON(v1Record);
    expect(restored.format).toBe(0);
    expect(restored.text).toBe('hi');
  });
});
