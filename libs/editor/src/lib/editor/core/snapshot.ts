import { NodeKey } from './nodes/node';

/**
 * Canonical editor-state snapshot format (v1).
 *
 * The document graph is serialized as a flat record of node entries keyed by
 * NodeKey, each carrying its structural pointers (parent/prev/next and
 * element-specific first/last/size) and its type-specific payload. This mirrors
 * the in-memory NodeMap and avoids nested children arrays so round-trips are
 * free of tree-flattening.
 */
export const SNAPSHOT_VERSION = 1;

interface SerializedBaseNode<TType extends string> {
  type: TType;
  version: number;
  key: NodeKey;
  parent: NodeKey | null;
  prev: NodeKey | null;
  next: NodeKey | null;
}

export interface SerializedRootNode extends SerializedBaseNode<'root'> {
  first: NodeKey | null;
  last: NodeKey | null;
  size: number;
}

export interface SerializedParagraphNode extends SerializedBaseNode<'paragraph'> {
  first: NodeKey | null;
  last: NodeKey | null;
  size: number;
}

export interface SerializedTextNode extends SerializedBaseNode<'text'> {
  text: string;
}

export type SerializedNode =
  | SerializedRootNode
  | SerializedParagraphNode
  | SerializedTextNode;

export interface EditorStateSnapshot {
  version: number;
  rootKey: NodeKey;
  nodes: Record<NodeKey, SerializedNode>;
}

/**
 * Error thrown when a snapshot cannot be parsed or is structurally invalid.
 * Import paths must throw this class so callers can narrow on failure.
 */
export class InvalidSnapshotError extends Error {
  constructor(message: string) {
    super(`[InvalidSnapshotError] ${message}`);
    this.name = 'InvalidSnapshotError';
  }
}

/**
 * Type-narrow and shape-check a raw snapshot. Throws `InvalidSnapshotError`
 * for any missing/unknown fields. This is the only place importers should
 * have to trust the input.
 */
export function validateSnapshot(raw: unknown): EditorStateSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidSnapshotError('snapshot is not an object');
  }
  const snapshot = raw as Partial<EditorStateSnapshot>;

  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new InvalidSnapshotError(
      `unsupported snapshot version: ${String(snapshot.version)} (expected ${SNAPSHOT_VERSION})`,
    );
  }
  if (typeof snapshot.rootKey !== 'string') {
    throw new InvalidSnapshotError('rootKey is missing or not a string');
  }
  if (!snapshot.nodes || typeof snapshot.nodes !== 'object') {
    throw new InvalidSnapshotError('nodes map is missing');
  }

  const rootRecord = snapshot.nodes[snapshot.rootKey];
  if (!rootRecord) {
    throw new InvalidSnapshotError(`rootKey "${snapshot.rootKey}" not present in nodes map`);
  }
  if (rootRecord.type !== 'root') {
    throw new InvalidSnapshotError(
      `node at rootKey "${snapshot.rootKey}" has type "${rootRecord.type}", expected "root"`,
    );
  }

  for (const [key, record] of Object.entries(snapshot.nodes)) {
    validateNodeRecord(key, record);
  }

  return snapshot as EditorStateSnapshot;
}

function validateNodeRecord(key: string, record: unknown): void {
  if (!record || typeof record !== 'object') {
    throw new InvalidSnapshotError(`node "${key}" is not an object`);
  }
  const node = record as Partial<SerializedNode>;

  if (typeof node.type !== 'string') {
    throw new InvalidSnapshotError(`node "${key}" is missing type`);
  }
  if (typeof node.version !== 'number') {
    throw new InvalidSnapshotError(`node "${key}" is missing version`);
  }
  if (typeof node.key !== 'string' || node.key !== key) {
    throw new InvalidSnapshotError(
      `node "${key}" key mismatch: stored key is "${String(node.key)}"`,
    );
  }

  switch (node.type) {
    case 'root':
    case 'paragraph': {
      const asElement = node as Partial<SerializedRootNode>;
      if (asElement.first !== null && typeof asElement.first !== 'string') {
        throw new InvalidSnapshotError(`${node.type} "${key}" has malformed first pointer`);
      }
      if (asElement.last !== null && typeof asElement.last !== 'string') {
        throw new InvalidSnapshotError(`${node.type} "${key}" has malformed last pointer`);
      }
      if (typeof asElement.size !== 'number') {
        throw new InvalidSnapshotError(`${node.type} "${key}" is missing size`);
      }
      break;
    }
    case 'text': {
      const asText = node as Partial<SerializedTextNode>;
      if (typeof asText.text !== 'string') {
        throw new InvalidSnapshotError(`text "${key}" is missing text payload`);
      }
      break;
    }
    default:
      throw new InvalidSnapshotError(`unknown node type "${String(node.type)}" at "${key}"`);
  }
}
