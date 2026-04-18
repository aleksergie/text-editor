/**
 * Inline text formatting, encoded as a bitfield so a `TextNode` can carry
 * arbitrary combinations of formats in a single 32-bit field. Values are
 * powers of two; bits 32+ are reserved for future formats.
 *
 * Kept as a plain `const` object (not a `const enum`) so constants survive
 * tree-shaking without TypeScript's isolated modules gotchas, and so
 * downstream consumers can compose new bitfields with `|` naturally.
 */
export const TextFormat = {
  NONE: 0,
  BOLD: 1 << 0,
  ITALIC: 1 << 1,
  UNDERLINE: 1 << 2,
  STRIKETHROUGH: 1 << 3,
  CODE: 1 << 4,
} as const;

/** Numeric type of a `TextFormat` value (one of the bit masks above). */
export type TextFormatFlag = (typeof TextFormat)[keyof typeof TextFormat];

/** A composite formatting bitfield. Zero means no formatting. */
export type TextFormatBits = number;

/** Returns `true` when every bit in `flag` is set on `bits`. */
export function hasFormat(bits: TextFormatBits, flag: TextFormatFlag): boolean {
  return (bits & flag) === flag && flag !== 0;
}

/** Returns a new bitfield with `flag` set. Idempotent. */
export function applyFormat(bits: TextFormatBits, flag: TextFormatFlag): TextFormatBits {
  return bits | flag;
}

/** Returns a new bitfield with `flag` cleared. Idempotent. */
export function removeFormat(bits: TextFormatBits, flag: TextFormatFlag): TextFormatBits {
  return bits & ~flag;
}

/** Returns a new bitfield with `flag` flipped. */
export function toggleFormat(bits: TextFormatBits, flag: TextFormatFlag): TextFormatBits {
  return bits ^ flag;
}

/**
 * Canonical rendering order for nested format tags. Bold is the outermost
 * wrapper, code is the innermost. Keeping this order stable ensures two
 * text nodes with identical format bits produce byte-identical DOM, which
 * keeps the reconciler's dirty-only patch path hot.
 */
export const FORMAT_RENDER_ORDER: readonly TextFormatFlag[] = [
  TextFormat.BOLD,
  TextFormat.ITALIC,
  TextFormat.UNDERLINE,
  TextFormat.STRIKETHROUGH,
  TextFormat.CODE,
];
