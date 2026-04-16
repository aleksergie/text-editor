import { NodeMap } from './node';
import {
  $createParagraphNode,
  $createRootNode,
  $createTextNode,
  $isElementNode,
  $isTextNode,
  $isRootNode,
  insertAfter,
  remove,
  replace,
} from './node-utils';

function buildParagraphWithChildren(
  nodeMap: NodeMap,
  paragraphKey: string,
  textKeys: string[],
) {
  const paragraph = $createParagraphNode(paragraphKey);
  nodeMap.set(paragraph.key, paragraph);
  for (const key of textKeys) {
    const text = $createTextNode(key, key);
    nodeMap.set(text.key, text);
    paragraph.append(nodeMap, text);
  }
  return paragraph;
}

function collectChildrenKeys(nodeMap: NodeMap, parentKey: string): string[] {
  const parent = nodeMap.get(parentKey);
  if (!$isElementNode(parent)) return [];
  const keys: string[] = [];
  let cur = parent.__first;
  while (cur) {
    keys.push(cur);
    const node = nodeMap.get(cur);
    cur = node?.__next ?? null;
  }
  return keys;
}

describe('node-utils type guards', () => {
  it('$isRootNode recognizes RootNode only', () => {
    expect($isRootNode($createRootNode('r'))).toBe(true);
    expect($isRootNode($createParagraphNode('p'))).toBe(false);
    expect($isRootNode($createTextNode('t', 'a'))).toBe(false);
    expect($isRootNode(null)).toBe(false);
    expect($isRootNode(undefined)).toBe(false);
  });

  it('$isElementNode covers Root + Paragraph', () => {
    expect($isElementNode($createRootNode('r'))).toBe(true);
    expect($isElementNode($createParagraphNode('p'))).toBe(true);
    expect($isElementNode($createTextNode('t', 'a'))).toBe(false);
  });

  it('$isTextNode recognizes TextNode only', () => {
    expect($isTextNode($createTextNode('t', 'a'))).toBe(true);
    expect($isTextNode($createParagraphNode('p'))).toBe(false);
  });
});

describe('node-utils insertAfter', () => {
  it('inserts a node after the target and updates the linked list', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b', 'c']);
    const n = $createTextNode('x', 'x');
    nodes.set(n.key, n);

    insertAfter(nodes, nodes.get('b')!, n);

    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'b', 'x', 'c']);
    expect(paragraph.__size).toBe(4);
  });

  it('updates last pointer when inserting after the current tail', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b']);
    const n = $createTextNode('z', 'z');
    nodes.set(n.key, n);

    insertAfter(nodes, nodes.get('b')!, n);

    expect(paragraph.__last).toBe('z');
    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'b', 'z']);
  });

  it('is a no-op when target === nodeToInsert', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a', 'b']);
    const a = nodes.get('a')!;

    expect(() => insertAfter(nodes, a, a)).not.toThrow();
    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'b']);
  });

  it('detaches the node from its current parent before re-inserting', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a', 'b']);
    const p2 = buildParagraphWithChildren(nodes, 'p2', ['x']);
    const root = $createRootNode('root');
    nodes.set(root.key, root);
    root.append(nodes, nodes.get('p1')!);
    root.append(nodes, p2);

    // Move 'x' from p2 into p1 after 'a'.
    insertAfter(nodes, nodes.get('a')!, nodes.get('x')!);

    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'x', 'b']);
    expect(collectChildrenKeys(nodes, 'p2')).toEqual([]);
    expect(p2.__size).toBe(0);
  });

  it('does nothing when target has no parent', () => {
    const nodes: NodeMap = new Map();
    const orphan = $createTextNode('orphan', '');
    const candidate = $createTextNode('cand', '');
    nodes.set(orphan.key, orphan);
    nodes.set(candidate.key, candidate);

    expect(() => insertAfter(nodes, orphan, candidate)).not.toThrow();
    expect(candidate.parent).toBeNull();
  });
});

describe('node-utils remove', () => {
  it('removes head and updates parent.first', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b', 'c']);
    remove(nodes, nodes.get('a')!);

    expect(paragraph.__first).toBe('b');
    expect(paragraph.__size).toBe(2);
    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['b', 'c']);
  });

  it('removes tail and updates parent.last', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b', 'c']);
    remove(nodes, nodes.get('c')!);

    expect(paragraph.__last).toBe('b');
    expect(paragraph.__size).toBe(2);
    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'b']);
  });

  it('removes middle node and re-links neighbors', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b', 'c']);
    remove(nodes, nodes.get('b')!);

    expect(nodes.get('a')?.next).toBe('c');
    expect(nodes.get('c')?.prev).toBe('a');
    expect(paragraph.__size).toBe(2);
  });

  it('detaches the node entirely (null parent/prev/next)', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a']);
    const a = nodes.get('a')!;
    remove(nodes, a);

    expect(a.parent).toBeNull();
    expect(a.prev).toBeNull();
    expect(a.next).toBeNull();
  });

  it('handles removing an orphan node gracefully', () => {
    const nodes: NodeMap = new Map();
    const orphan = $createTextNode('o', '');
    nodes.set(orphan.key, orphan);
    expect(() => remove(nodes, orphan)).not.toThrow();
  });
});

describe('node-utils replace', () => {
  it('replaces head', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b']);
    const rep = $createTextNode('rep', '');
    nodes.set(rep.key, rep);

    replace(nodes, nodes.get('a')!, rep);

    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['rep', 'b']);
    expect(paragraph.__first).toBe('rep');
  });

  it('replaces tail', () => {
    const nodes: NodeMap = new Map();
    const paragraph = buildParagraphWithChildren(nodes, 'p1', ['a', 'b']);
    const rep = $createTextNode('rep', '');
    nodes.set(rep.key, rep);

    replace(nodes, nodes.get('b')!, rep);

    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'rep']);
    expect(paragraph.__last).toBe('rep');
  });

  it('replaces middle', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a', 'b', 'c']);
    const rep = $createTextNode('rep', '');
    nodes.set(rep.key, rep);

    replace(nodes, nodes.get('b')!, rep);

    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a', 'rep', 'c']);
  });

  it('detaches the replaced node', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a']);
    const rep = $createTextNode('rep', '');
    nodes.set(rep.key, rep);

    const original = nodes.get('a')!;
    replace(nodes, original, rep);

    expect(original.parent).toBeNull();
    expect(original.prev).toBeNull();
    expect(original.next).toBeNull();
  });

  it('is a no-op when target === replacement', () => {
    const nodes: NodeMap = new Map();
    buildParagraphWithChildren(nodes, 'p1', ['a']);
    const a = nodes.get('a')!;

    expect(() => replace(nodes, a, a)).not.toThrow();
    expect(collectChildrenKeys(nodes, 'p1')).toEqual(['a']);
  });
});
