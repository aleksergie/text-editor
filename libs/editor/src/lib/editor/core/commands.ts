import type { EditorState } from './state';

/**
 * Module-private brand symbol. Declared with `unique symbol` so its type is
 * nominal, and intentionally not exported so no code outside this module can
 * reference the key to forge or satisfy the brand property.
 */
declare const COMMAND_PAYLOAD_BRAND: unique symbol;

/**
 * Opaque, typed command object.
 *
 * Matching at dispatch time is done by object identity (`===`), not by `type`.
 * The `type` string is a debugging/inspection aid and is not required to be unique
 * across commands.
 *
 * The `TPayload` parameter is carried in the type via a brand keyed by the
 * module-private symbol `COMMAND_PAYLOAD_BRAND`. This:
 *   - prevents structural cross-assignment between commands of different
 *     payload types (e.g. `EditorCommand<string>` is not assignable to
 *     `EditorCommand<number>`),
 *   - lets `CommandPayloadType<T>` recover the payload via `infer`,
 *   - is invisible at runtime and to JSON serializers (the property is `?:`
 *     and never assigned).
 */
export interface EditorCommand<TPayload> {
  readonly type: string;
  readonly [COMMAND_PAYLOAD_BRAND]?: TPayload;
}

/**
 * Extracts the payload type of an `EditorCommand`.
 */
export type CommandPayloadType<TCommand> = TCommand extends EditorCommand<infer TPayload>
  ? TPayload
  : never;

/**
 * Priority buckets for command handlers. Higher numeric value = higher priority
 * and runs earlier. Handlers registered at the same priority run in
 * registration order.
 */
export enum CommandPriority {
  Editor = 0,
  Low = 1,
  Normal = 2,
  High = 3,
  Critical = 4,
}

/**
 * Command handler contract. Return `true` to stop further handlers from running
 * (short-circuit); return `false` (or nothing) to let the next handler run.
 */
export type CommandHandler<TPayload> = (payload: TPayload) => boolean;

/**
 * Mints a new typed command. Each call returns a distinct object, even if
 * called with the same `type` string, so callers should export and share a
 * single command constant.
 */
export function createCommand<TPayload = void>(type: string): EditorCommand<TPayload> {
  return Object.freeze({ type });
}

// --- V1 core commands -------------------------------------------------------

/** Insert text at the current (v1 DOM-derived) insertion point. */
export const INSERT_TEXT: EditorCommand<{ text: string }> =
  createCommand<{ text: string }>('INSERT_TEXT');

/** Delete one character. `isBackward` mirrors the browser's `deleteContentBackward`. */
export const DELETE_CHARACTER: EditorCommand<{ isBackward: boolean }> =
  createCommand<{ isBackward: boolean }>('DELETE_CHARACTER');

/** Insert a new empty paragraph at the end of the document (v1 scope). */
export const INSERT_PARAGRAPH: EditorCommand<void> =
  createCommand<void>('INSERT_PARAGRAPH');

/** Replace the document's text content (non-structural). */
export const SET_TEXT_CONTENT: EditorCommand<string> =
  createCommand<string>('SET_TEXT_CONTENT');

/** Apply a whole-editor-state snapshot (in-memory state for v1; JSON in M3). */
export const APPLY_EDITOR_STATE: EditorCommand<EditorState> =
  createCommand<EditorState>('APPLY_EDITOR_STATE');

/** Reset to the v1 baseline: `root > paragraph > empty text node`. */
export const CLEAR_EDITOR: EditorCommand<void> = createCommand<void>('CLEAR_EDITOR');

/**
 * @deprecated Use `SET_TEXT_CONTENT` instead. Retained as an alias so existing
 * input-flow call sites keep working during the M1 migration.
 */
export const SET_TEXT: EditorCommand<string> = SET_TEXT_CONTENT;
