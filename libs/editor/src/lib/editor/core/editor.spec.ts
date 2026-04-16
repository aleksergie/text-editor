import { CommandPriority, createCommand } from './commands';
import { Editor } from './editor';

describe('Editor command bus', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor();
  });

  describe('dispatchCommand', () => {
    it('returns false when no handlers are registered for the command', () => {
      const NOOP = createCommand<void>('NOOP');

      expect(editor.dispatchCommand(NOOP, undefined)).toBe(false);
    });

    it('invokes a single registered handler and returns its truthy result', () => {
      const CMD = createCommand<string>('CMD');
      const handler = jest.fn().mockReturnValue(true);

      editor.registerCommand(CMD, handler, CommandPriority.Normal);

      expect(editor.dispatchCommand(CMD, 'payload')).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('payload');
    });

    it('returns false when every handler returns false', () => {
      const CMD = createCommand<void>('CMD');
      const a = jest.fn().mockReturnValue(false);
      const b = jest.fn().mockReturnValue(false);

      editor.registerCommand(CMD, a, CommandPriority.Normal);
      editor.registerCommand(CMD, b, CommandPriority.Normal);

      expect(editor.dispatchCommand(CMD, undefined)).toBe(false);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });
  });

  describe('priority ordering', () => {
    it('runs higher-priority handlers before lower-priority handlers', () => {
      const CMD = createCommand<void>('CMD');
      const calls: string[] = [];
      const make = (label: string) => (): boolean => {
        calls.push(label);
        return false;
      };

      editor.registerCommand(CMD, make('editor'), CommandPriority.Editor);
      editor.registerCommand(CMD, make('low'), CommandPriority.Low);
      editor.registerCommand(CMD, make('critical'), CommandPriority.Critical);
      editor.registerCommand(CMD, make('normal'), CommandPriority.Normal);
      editor.registerCommand(CMD, make('high'), CommandPriority.High);

      editor.dispatchCommand(CMD, undefined);

      expect(calls).toEqual(['critical', 'high', 'normal', 'low', 'editor']);
    });

    it('runs equal-priority handlers in registration order', () => {
      const CMD = createCommand<void>('CMD');
      const calls: string[] = [];
      const make = (label: string) => (): boolean => {
        calls.push(label);
        return false;
      };

      editor.registerCommand(CMD, make('first'), CommandPriority.Normal);
      editor.registerCommand(CMD, make('second'), CommandPriority.Normal);
      editor.registerCommand(CMD, make('third'), CommandPriority.Normal);

      editor.dispatchCommand(CMD, undefined);

      expect(calls).toEqual(['first', 'second', 'third']);
    });

    it('interleaves priorities and registration order correctly', () => {
      const CMD = createCommand<void>('CMD');
      const calls: string[] = [];
      const make = (label: string) => (): boolean => {
        calls.push(label);
        return false;
      };

      editor.registerCommand(CMD, make('n1'), CommandPriority.Normal);
      editor.registerCommand(CMD, make('h1'), CommandPriority.High);
      editor.registerCommand(CMD, make('n2'), CommandPriority.Normal);
      editor.registerCommand(CMD, make('h2'), CommandPriority.High);

      editor.dispatchCommand(CMD, undefined);

      expect(calls).toEqual(['h1', 'h2', 'n1', 'n2']);
    });
  });

  describe('short-circuit', () => {
    it('stops dispatch when a handler returns true', () => {
      const CMD = createCommand<void>('CMD');
      const later = jest.fn();

      editor.registerCommand(CMD, () => true, CommandPriority.High);
      editor.registerCommand(CMD, later, CommandPriority.Normal);

      expect(editor.dispatchCommand(CMD, undefined)).toBe(true);
      expect(later).not.toHaveBeenCalled();
    });

    it('continues to lower-priority handlers when a handler returns false', () => {
      const CMD = createCommand<void>('CMD');
      const later = jest.fn().mockReturnValue(true);

      editor.registerCommand(CMD, () => false, CommandPriority.High);
      editor.registerCommand(CMD, later, CommandPriority.Normal);

      expect(editor.dispatchCommand(CMD, undefined)).toBe(true);
      expect(later).toHaveBeenCalledTimes(1);
    });
  });

  describe('unregister', () => {
    it('removes the handler so subsequent dispatches do not call it', () => {
      const CMD = createCommand<void>('CMD');
      const handler = jest.fn().mockReturnValue(false);

      const unregister = editor.registerCommand(CMD, handler, CommandPriority.Normal);
      editor.dispatchCommand(CMD, undefined);
      unregister();
      editor.dispatchCommand(CMD, undefined);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('only removes the specific registration it was returned from', () => {
      const CMD = createCommand<void>('CMD');
      const a = jest.fn().mockReturnValue(false);
      const b = jest.fn().mockReturnValue(false);

      const unregisterA = editor.registerCommand(CMD, a, CommandPriority.Normal);
      editor.registerCommand(CMD, b, CommandPriority.Normal);

      unregisterA();
      editor.dispatchCommand(CMD, undefined);

      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: calling unregister twice is a no-op', () => {
      const CMD = createCommand<void>('CMD');
      const handler = jest.fn().mockReturnValue(false);

      const unregister = editor.registerCommand(CMD, handler, CommandPriority.Normal);
      unregister();
      expect(() => unregister()).not.toThrow();

      editor.dispatchCommand(CMD, undefined);
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports the same handler function being registered twice independently', () => {
      const CMD = createCommand<void>('CMD');
      const handler = jest.fn().mockReturnValue(false);

      const unregisterFirst = editor.registerCommand(CMD, handler, CommandPriority.Normal);
      editor.registerCommand(CMD, handler, CommandPriority.Normal);

      editor.dispatchCommand(CMD, undefined);
      expect(handler).toHaveBeenCalledTimes(2);

      unregisterFirst();
      editor.dispatchCommand(CMD, undefined);
      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe('command isolation', () => {
    it('handlers registered for one command are not invoked for another', () => {
      const A = createCommand<void>('A');
      const B = createCommand<void>('B');
      const handlerA = jest.fn().mockReturnValue(false);
      const handlerB = jest.fn().mockReturnValue(false);

      editor.registerCommand(A, handlerA, CommandPriority.Normal);
      editor.registerCommand(B, handlerB, CommandPriority.Normal);

      editor.dispatchCommand(A, undefined);

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).not.toHaveBeenCalled();
    });

    it('uses object identity, not type-string equality, to match commands', () => {
      const SAME_A = createCommand<void>('SAME');
      const SAME_B = createCommand<void>('SAME');
      const handlerA = jest.fn().mockReturnValue(false);

      editor.registerCommand(SAME_A, handlerA, CommandPriority.Normal);
      editor.dispatchCommand(SAME_B, undefined);

      expect(handlerA).not.toHaveBeenCalled();
    });
  });

  describe('concurrent modification during dispatch', () => {
    it('dispatch uses a stable snapshot: handlers registered during a dispatch do not run in that dispatch', () => {
      const CMD = createCommand<void>('CMD');
      const later = jest.fn().mockReturnValue(false);

      editor.registerCommand(
        CMD,
        () => {
          editor.registerCommand(CMD, later, CommandPriority.Critical);
          return false;
        },
        CommandPriority.Normal,
      );

      editor.dispatchCommand(CMD, undefined);
      expect(later).not.toHaveBeenCalled();

      editor.dispatchCommand(CMD, undefined);
      expect(later).toHaveBeenCalledTimes(1);
    });

    it('unregistering a handler during dispatch does not error out the in-flight dispatch', () => {
      const CMD = createCommand<void>('CMD');
      let unregisterSelf: () => void = () => undefined;

      unregisterSelf = editor.registerCommand(
        CMD,
        () => {
          unregisterSelf();
          return false;
        },
        CommandPriority.High,
      );
      const later = jest.fn().mockReturnValue(true);
      editor.registerCommand(CMD, later, CommandPriority.Normal);

      expect(() => editor.dispatchCommand(CMD, undefined)).not.toThrow();
      expect(later).toHaveBeenCalledTimes(1);
    });
  });
});
