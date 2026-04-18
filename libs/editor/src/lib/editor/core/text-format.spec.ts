import {
  FORMAT_RENDER_ORDER,
  TextFormat,
  applyFormat,
  hasFormat,
  removeFormat,
  toggleFormat,
} from './text-format';

describe('TextFormat helpers', () => {
  describe('hasFormat', () => {
    it('returns false for TextFormat.NONE against any flag', () => {
      for (const flag of FORMAT_RENDER_ORDER) {
        expect(hasFormat(TextFormat.NONE, flag)).toBe(false);
      }
    });

    it('returns true only for set flags', () => {
      const bits = TextFormat.BOLD | TextFormat.CODE;
      expect(hasFormat(bits, TextFormat.BOLD)).toBe(true);
      expect(hasFormat(bits, TextFormat.CODE)).toBe(true);
      expect(hasFormat(bits, TextFormat.ITALIC)).toBe(false);
      expect(hasFormat(bits, TextFormat.UNDERLINE)).toBe(false);
      expect(hasFormat(bits, TextFormat.STRIKETHROUGH)).toBe(false);
    });
  });

  describe('applyFormat', () => {
    it('is idempotent', () => {
      const once = applyFormat(TextFormat.NONE, TextFormat.BOLD);
      const twice = applyFormat(once, TextFormat.BOLD);
      expect(once).toBe(twice);
    });

    it('composes with other flags without clobbering them', () => {
      const bits = applyFormat(TextFormat.ITALIC, TextFormat.BOLD);
      expect(hasFormat(bits, TextFormat.BOLD)).toBe(true);
      expect(hasFormat(bits, TextFormat.ITALIC)).toBe(true);
    });
  });

  describe('removeFormat', () => {
    it('is idempotent', () => {
      const once = removeFormat(TextFormat.BOLD, TextFormat.BOLD);
      const twice = removeFormat(once, TextFormat.BOLD);
      expect(once).toBe(twice);
      expect(once).toBe(0);
    });

    it('leaves other flags intact', () => {
      const bits = TextFormat.BOLD | TextFormat.ITALIC;
      const cleared = removeFormat(bits, TextFormat.BOLD);
      expect(hasFormat(cleared, TextFormat.BOLD)).toBe(false);
      expect(hasFormat(cleared, TextFormat.ITALIC)).toBe(true);
    });
  });

  describe('toggleFormat', () => {
    it('applies when absent', () => {
      const bits = toggleFormat(TextFormat.NONE, TextFormat.BOLD);
      expect(hasFormat(bits, TextFormat.BOLD)).toBe(true);
    });

    it('removes when present', () => {
      const bits = toggleFormat(TextFormat.BOLD, TextFormat.BOLD);
      expect(hasFormat(bits, TextFormat.BOLD)).toBe(false);
    });

    it('round-trips back to starting bitfield', () => {
      const start = TextFormat.BOLD | TextFormat.CODE;
      const flipped = toggleFormat(start, TextFormat.ITALIC);
      const flippedBack = toggleFormat(flipped, TextFormat.ITALIC);
      expect(flippedBack).toBe(start);
    });
  });

  describe('constants', () => {
    it('assigns distinct non-zero bits to each flag', () => {
      const seen = new Set<number>();
      for (const flag of FORMAT_RENDER_ORDER) {
        expect(flag).not.toBe(0);
        expect(seen.has(flag)).toBe(false);
        seen.add(flag);
      }
    });

    it('uses powers of two', () => {
      for (const flag of FORMAT_RENDER_ORDER) {
        expect(flag & (flag - 1)).toBe(0);
      }
    });

    it('renders bold outside of code', () => {
      const boldIdx = FORMAT_RENDER_ORDER.indexOf(TextFormat.BOLD);
      const codeIdx = FORMAT_RENDER_ORDER.indexOf(TextFormat.CODE);
      expect(boldIdx).toBeLessThan(codeIdx);
    });
  });
});
