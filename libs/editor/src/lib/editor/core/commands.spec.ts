import {
  CommandPayloadType,
  CommandPriority,
  EditorCommand,
  createCommand,
} from './commands';

describe('command primitives', () => {
  describe('createCommand', () => {
    it('returns a distinct object on every call, even with the same type string', () => {
      const a = createCommand<string>('SAME');
      const b = createCommand<string>('SAME');

      expect(a).not.toBe(b);
      expect(a.type).toBe('SAME');
      expect(b.type).toBe('SAME');
    });

    it('produces frozen command objects', () => {
      const cmd = createCommand<number>('FROZEN');

      expect(Object.isFrozen(cmd)).toBe(true);
    });

    it('supports void payloads', () => {
      const cmd = createCommand('VOID_CMD');

      type Payload = CommandPayloadType<typeof cmd>;
      const payload: Payload = undefined;

      expect(cmd.type).toBe('VOID_CMD');
      expect(payload).toBeUndefined();
    });
  });

  describe('CommandPriority', () => {
    it('orders priorities ascending from Editor to Critical', () => {
      expect(CommandPriority.Editor).toBeLessThan(CommandPriority.Low);
      expect(CommandPriority.Low).toBeLessThan(CommandPriority.Normal);
      expect(CommandPriority.Normal).toBeLessThan(CommandPriority.High);
      expect(CommandPriority.High).toBeLessThan(CommandPriority.Critical);
    });

    it('exposes all five documented levels', () => {
      expect(CommandPriority.Editor).toBeDefined();
      expect(CommandPriority.Low).toBeDefined();
      expect(CommandPriority.Normal).toBeDefined();
      expect(CommandPriority.High).toBeDefined();
      expect(CommandPriority.Critical).toBeDefined();
    });
  });

  describe('payload typing', () => {
    it('infers payload type through CommandPayloadType', () => {
      const stringCmd = createCommand<string>('STRING_CMD');
      const numberCmd = createCommand<number>('NUMBER_CMD');

      const s: CommandPayloadType<typeof stringCmd> = 'hello';
      const n: CommandPayloadType<typeof numberCmd> = 42;

      expect(stringCmd.type).toBe('STRING_CMD');
      expect(numberCmd.type).toBe('NUMBER_CMD');
      expect(s).toBe('hello');
      expect(n).toBe(42);
    });

    it('enforces payload type at call sites (type-level)', () => {
      const cmd: EditorCommand<{ count: number }> = createCommand<{ count: number }>(
        'STRUCTURED',
      );
      type Payload = CommandPayloadType<typeof cmd>;

      const valid: Payload = { count: 1 };
      expect(cmd.type).toBe('STRUCTURED');
      expect(valid.count).toBe(1);

      // The next line would be a compile error; we document the intent via a
      // runtime smoke check on the concrete shape.
      // @ts-expect-error payload shape is enforced by the type system
      const invalid: Payload = { count: 'nope' };
      expect(typeof invalid.count).toBe('string');
    });

    it('rejects cross-assignment between commands with different payload types', () => {
      const stringCmd = createCommand<string>('S');
      const numberCmd = createCommand<number>('N');

      // The brand on EditorCommand<TPayload> makes these structurally distinct.
      // @ts-expect-error EditorCommand<string> is not assignable to EditorCommand<number>
      const wrong: EditorCommand<number> = stringCmd;

      expect(wrong.type).toBe('S');
      expect(numberCmd.type).toBe('N');
    });
  });
});
