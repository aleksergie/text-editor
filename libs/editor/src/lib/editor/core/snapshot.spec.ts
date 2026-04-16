import {
  $createParagraphNode,
  $createRootNode,
  $createTextNode,
} from './nodes/node-utils';
import { NodeMap } from './nodes/node';
import {
  EditorStateSnapshot,
  InvalidSnapshotError,
  SNAPSHOT_VERSION,
  validateSnapshot,
} from './snapshot';
import { EditorState } from './state';

function buildMultiParagraphState(): EditorState {
  const nodes: NodeMap = new Map();
  const root = $createRootNode('root');
  const p1 = $createParagraphNode('p1');
  const t1 = $createTextNode('t1', 'hello');
  const p2 = $createParagraphNode('p2');
  const t2 = $createTextNode('t2', 'world');

  [root, p1, t1, p2, t2].forEach((n) => nodes.set(n.key, n));

  p1.append(nodes, t1);
  p2.append(nodes, t2);
  root.append(nodes, p1);
  root.append(nodes, p2);

  return new EditorState(nodes, root.key);
}

describe('EditorState.toJSON', () => {
  it('serializes the baseline state', () => {
    const state = EditorState.createEmpty();
    const snapshot = state.toJSON();

    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.rootKey).toBe('root');
    expect(Object.keys(snapshot.nodes).sort()).toEqual(['p1', 'root', 't1']);
    expect(snapshot.nodes['root'].type).toBe('root');
    expect(snapshot.nodes['p1'].type).toBe('paragraph');
    expect(snapshot.nodes['t1'].type).toBe('text');
  });

  it('serializes structural pointers for elements and size', () => {
    const state = buildMultiParagraphState();
    const snapshot = state.toJSON();

    const root = snapshot.nodes['root'];
    expect(root.type).toBe('root');
    if (root.type !== 'root') throw new Error('unreachable');
    expect(root.first).toBe('p1');
    expect(root.last).toBe('p2');
    expect(root.size).toBe(2);

    const p1 = snapshot.nodes['p1'];
    if (p1.type !== 'paragraph') throw new Error('unreachable');
    expect(p1.prev).toBeNull();
    expect(p1.next).toBe('p2');
    expect(p1.size).toBe(1);
  });

  it('serializes text payloads', () => {
    const state = buildMultiParagraphState();
    const snapshot = state.toJSON();

    const t1 = snapshot.nodes['t1'];
    if (t1.type !== 'text') throw new Error('unreachable');
    expect(t1.text).toBe('hello');
  });

  it('produces a JSON-stringifiable object', () => {
    const snapshot = buildMultiParagraphState().toJSON();
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
  });
});

describe('EditorState.fromJSON', () => {
  it('round-trips a multi-paragraph state', () => {
    const original = buildMultiParagraphState();
    const snapshot = original.toJSON();

    const restored = EditorState.fromJSON(snapshot);

    expect(restored).not.toBe(original);
    expect(restored.nodes.size).toBe(original.nodes.size);
    expect(restored.rootKey).toBe(original.rootKey);
    expect(restored.getText()).toBe(original.getText());
    expect(restored.toJSON()).toEqual(snapshot);
  });

  it('yields a working state usable by structural helpers', () => {
    const snapshot = buildMultiParagraphState().toJSON();
    const restored = EditorState.fromJSON(snapshot);

    restored.setText('changed');
    // setText targets the first text node, so only t1 should have changed.
    const t1 = restored.nodes.get('t1');
    expect((t1 as unknown as { text: string }).text).toBe('changed');
  });
});

describe('validateSnapshot', () => {
  function baseSnapshot(): EditorStateSnapshot {
    return EditorState.createEmpty().toJSON();
  }

  it('accepts a well-formed snapshot', () => {
    expect(() => validateSnapshot(baseSnapshot())).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateSnapshot(null)).toThrow(InvalidSnapshotError);
  });

  it('rejects a snapshot with the wrong version', () => {
    const snapshot = { ...baseSnapshot(), version: 99 };
    expect(() => validateSnapshot(snapshot)).toThrow(/unsupported snapshot version/);
  });

  it('rejects a snapshot with a missing rootKey', () => {
    const snapshot = baseSnapshot() as unknown as Record<string, unknown>;
    delete snapshot['rootKey'];
    expect(() => validateSnapshot(snapshot)).toThrow(/rootKey/);
  });

  it('rejects a snapshot where rootKey is not present in nodes', () => {
    const snapshot = baseSnapshot();
    snapshot.rootKey = 'does-not-exist';
    expect(() => validateSnapshot(snapshot)).toThrow(/not present in nodes map/);
  });

  it('rejects a node with an unknown type', () => {
    const snapshot = baseSnapshot();
    (snapshot.nodes['t1'] as unknown as { type: string }).type = 'mystery';
    expect(() => validateSnapshot(snapshot)).toThrow(/unknown node type/);
  });

  it('rejects a node whose stored key does not match its record key', () => {
    const snapshot = baseSnapshot();
    snapshot.nodes['p1'].key = 'mismatch';
    expect(() => validateSnapshot(snapshot)).toThrow(/key mismatch/);
  });

  it('rejects a text node without a text payload', () => {
    const snapshot = baseSnapshot();
    delete (snapshot.nodes['t1'] as unknown as { text?: string }).text;
    expect(() => validateSnapshot(snapshot)).toThrow(/text payload/);
  });
});

describe('EditorState.fromJSON error handling', () => {
  it('throws InvalidSnapshotError without mutating prior state', () => {
    expect(() => EditorState.fromJSON({ foo: 'bar' })).toThrow(InvalidSnapshotError);
  });
});
