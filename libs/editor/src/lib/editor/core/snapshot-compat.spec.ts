import { EditorStateSnapshot } from './snapshot';
import { EditorState } from './state';
import { TextFormat } from './text-format';
import { TextNode } from './nodes/text-node';

/**
 * V1 fixture: a pre-rich-text snapshot with TextNode version 1 and no
 * `format` field. This is the shape any editor shipped before V2 would have
 * written. The V2 import path must accept this snapshot and default its text
 * nodes to TextFormat.NONE so older documents continue to open.
 */
const V1_SNAPSHOT: EditorStateSnapshot = {
  version: 1,
  rootKey: 'root',
  nodes: {
    root: {
      type: 'root',
      version: 1,
      key: 'root',
      parent: null,
      prev: null,
      next: null,
      first: 'p1',
      last: 'p2',
      size: 2,
    },
    p1: {
      type: 'paragraph',
      version: 1,
      key: 'p1',
      parent: 'root',
      prev: null,
      next: 'p2',
      first: 't1',
      last: 't1',
      size: 1,
    },
    t1: {
      type: 'text',
      version: 1,
      key: 't1',
      parent: 'p1',
      prev: null,
      next: null,
      text: 'hello',
    },
    p2: {
      type: 'paragraph',
      version: 1,
      key: 'p2',
      parent: 'root',
      prev: 'p1',
      next: null,
      first: 't2',
      last: 't2',
      size: 1,
    },
    t2: {
      type: 'text',
      version: 1,
      key: 't2',
      parent: 'p2',
      prev: null,
      next: null,
      text: 'world',
    },
  },
};

/**
 * V2 fixture: the same graph but with TextNode version 2 and explicit
 * `format` fields, including a node with multiple bits set.
 */
const V2_SNAPSHOT: EditorStateSnapshot = {
  version: 1,
  rootKey: 'root',
  nodes: {
    root: {
      type: 'root',
      version: 1,
      key: 'root',
      parent: null,
      prev: null,
      next: null,
      first: 'p1',
      last: 'p1',
      size: 1,
    },
    p1: {
      type: 'paragraph',
      version: 1,
      key: 'p1',
      parent: 'root',
      prev: null,
      next: null,
      first: 't1',
      last: 't2',
      size: 2,
    },
    t1: {
      type: 'text',
      version: 2,
      key: 't1',
      parent: 'p1',
      prev: null,
      next: 't2',
      text: 'bold',
      format: TextFormat.BOLD,
    },
    t2: {
      type: 'text',
      version: 2,
      key: 't2',
      parent: 'p1',
      prev: 't1',
      next: null,
      text: 'plain',
      format: TextFormat.NONE,
    },
  },
};

describe('JSON back-compat', () => {
  it('loads a V1 text node snapshot and defaults format to NONE', () => {
    const state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(V1_SNAPSHOT)),
    );

    const texts = state.getTextNodesInDocumentOrder();
    expect(texts.map((t) => t.text)).toEqual(['hello', 'world']);
    expect(texts.every((t) => t.format === TextFormat.NONE)).toBe(true);
    // getText() concatenates the run contents; paragraph boundaries are
    // reflected by the linked-list structure, not in the flat text.
    expect(state.getText()).toBe('helloworld');
  });

  it('writes V2 snapshots that always include the format field', () => {
    const state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(V1_SNAPSHOT)),
    );
    const roundTripped = state.toJSON();

    for (const node of Object.values(roundTripped.nodes)) {
      if (node.type === 'text') {
        expect(typeof node.format).toBe('number');
        expect(node.version).toBe(TextNode.version);
      }
    }
  });

  it('round-trips a V2 snapshot with explicit format bits', () => {
    const state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(V2_SNAPSHOT)),
    );
    const out = state.toJSON();

    const t1 = out.nodes['t1'];
    const t2 = out.nodes['t2'];
    if (t1.type !== 'text' || t2.type !== 'text') {
      throw new Error('expected text nodes');
    }
    expect(t1.format).toBe(TextFormat.BOLD);
    expect(t2.format).toBe(TextFormat.NONE);
    expect(t1.text).toBe('bold');
    expect(t2.text).toBe('plain');
  });

  it('preserves linked-list sibling pointers across V1 -> V2 import', () => {
    const state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(V1_SNAPSHOT)),
    );
    const out = state.toJSON();

    const p1 = out.nodes['p1'];
    const p2 = out.nodes['p2'];
    if (p1.type !== 'paragraph' || p2.type !== 'paragraph') {
      throw new Error('expected paragraphs');
    }
    expect(p1.prev).toBeNull();
    expect(p1.next).toBe('p2');
    expect(p2.prev).toBe('p1');
    expect(p2.next).toBeNull();

    const t1 = out.nodes['t1'];
    if (t1.type !== 'text') throw new Error('expected text');
    expect(t1.parent).toBe('p1');
    expect(t1.prev).toBeNull();
    expect(t1.next).toBeNull();
  });

  it('rejects snapshots whose text format is not a non-negative integer', () => {
    const bad = JSON.parse(JSON.stringify(V2_SNAPSHOT)) as EditorStateSnapshot;
    (bad.nodes['t1'] as unknown as { format: unknown }).format = -1;
    expect(() => EditorState.fromJSON(bad)).toThrow(/malformed format/);

    const badFloat = JSON.parse(JSON.stringify(V2_SNAPSHOT)) as EditorStateSnapshot;
    (badFloat.nodes['t1'] as unknown as { format: unknown }).format = 1.5;
    expect(() => EditorState.fromJSON(badFloat)).toThrow(/malformed format/);
  });

  it('tolerates V1 mixed with V2 text nodes in the same document', () => {
    const mixed = JSON.parse(JSON.stringify(V2_SNAPSHOT)) as EditorStateSnapshot;
    // Simulate a node that was written by an older client (no format, v1) but
    // now co-exists with v2 siblings in the same document.
    const t2 = mixed.nodes['t2'];
    if (t2.type !== 'text') throw new Error('expected text');
    t2.version = 1;
    delete (t2 as unknown as { format?: number }).format;

    const state = EditorState.fromJSON(mixed);
    const [a, b] = state.getTextNodesInDocumentOrder();
    expect(a.format).toBe(TextFormat.BOLD);
    expect(b.format).toBe(TextFormat.NONE);
  });
});
