import {
  APPLY_EDITOR_STATE,
  CLEAR_EDITOR,
  CommandPriority,
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT,
  SET_TEXT_CONTENT,
  createCommand,
} from './commands';
import { Editor, UpdateListener, UpdateListenerPayload } from './editor';
import { EditorState } from './state';

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

describe('Editor transaction API', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor();
  });

  describe('getEditorState', () => {
    it('returns the current state and a fresh instance after update', () => {
      const before = editor.getEditorState();
      editor.update((state) => state.setText('new text'));
      const after = editor.getEditorState();

      expect(before).not.toBe(after);
      expect(after.getText()).toBe('new text');
    });
  });

  describe('read', () => {
    it('invokes the callback with the current state and returns its return value', () => {
      editor.update((state) => state.setText('readable'));

      const result = editor.read((state) => state.getText());

      expect(result).toBe('readable');
    });

    it('does not replace state or fire update listeners', () => {
      const before = editor.getEditorState();
      const listener = jest.fn();
      editor.registerUpdateListener(listener);

      editor.read((state) => state.getText());

      expect(editor.getEditorState()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('setEditorState', () => {
    it('replaces current state with the given snapshot', () => {
      const fresh = EditorState.createEmpty();
      fresh.setText('swapped');

      editor.setEditorState(fresh);

      expect(editor.getEditorState()).toBe(fresh);
      expect(editor.read((s) => s.getText())).toBe('swapped');
    });

    it('fires update listeners with prev/next state', () => {
      const listener = jest.fn<void, [UpdateListenerPayload]>();
      editor.registerUpdateListener(listener);

      const prev = editor.getEditorState();
      const next = EditorState.createEmpty();
      next.setText('next');

      editor.setEditorState(next);

      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.prevEditorState).toBe(prev);
      expect(payload.editorState).toBe(next);
    });

    it('is a no-op when the given state is identical to the current state', () => {
      const listener = jest.fn();
      editor.registerUpdateListener(listener);
      const current = editor.getEditorState();

      editor.setEditorState(current);

      expect(listener).not.toHaveBeenCalled();
      expect(editor.getEditorState()).toBe(current);
    });
  });

  describe('registerUpdateListener', () => {
    it('notifies listeners after update() transactions', () => {
      const listener = jest.fn<void, [UpdateListenerPayload]>();
      editor.registerUpdateListener(listener);
      const prev = editor.getEditorState();

      editor.update((state) => state.setText('changed'));

      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.prevEditorState).toBe(prev);
      expect(payload.editorState.getText()).toBe('changed');
    });

    it('invokes listeners in registration order', () => {
      const calls: string[] = [];
      const make = (label: string): UpdateListener => () => {
        calls.push(label);
      };

      editor.registerUpdateListener(make('a'));
      editor.registerUpdateListener(make('b'));
      editor.registerUpdateListener(make('c'));

      editor.update((state) => state.setText('x'));

      expect(calls).toEqual(['a', 'b', 'c']);
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const listener = jest.fn();
      const unregister = editor.registerUpdateListener(listener);

      editor.update((state) => state.setText('first'));
      unregister();
      editor.update((state) => state.setText('second'));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('exposes dirty node keys on the update payload', () => {
      const listener = jest.fn<void, [UpdateListenerPayload]>();
      editor.registerUpdateListener(listener);

      editor.update((state) => state.setText('dirty'));

      const payload = listener.mock.calls[0][0];
      expect(payload.dirtyNodeKeys.size).toBeGreaterThan(0);
    });

    it('uses a stable snapshot: listeners registered during notification do not run in that notification', () => {
      const later = jest.fn();

      editor.registerUpdateListener(() => {
        editor.registerUpdateListener(later);
      });

      editor.update((state) => state.setText('first'));
      expect(later).not.toHaveBeenCalled();

      editor.update((state) => state.setText('second'));
      expect(later).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Editor v1 core commands', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor();
  });

  describe('SET_TEXT_CONTENT', () => {
    it('replaces the document text', () => {
      expect(editor.dispatchCommand(SET_TEXT_CONTENT, 'hello')).toBe(true);
      expect(editor.read((s) => s.getText())).toBe('hello');
    });

    it('SET_TEXT is an alias for SET_TEXT_CONTENT', () => {
      expect(SET_TEXT).toBe(SET_TEXT_CONTENT);
      editor.dispatchCommand(SET_TEXT, 'legacy');
      expect(editor.read((s) => s.getText())).toBe('legacy');
    });
  });

  describe('INSERT_TEXT', () => {
    it('appends text to the document tail', () => {
      editor.dispatchCommand(INSERT_TEXT, { text: 'hel' });
      editor.dispatchCommand(INSERT_TEXT, { text: 'lo' });

      expect(editor.read((s) => s.getText())).toBe('hello');
    });

    it('is a no-op for empty text', () => {
      const before = editor.getEditorState();
      editor.dispatchCommand(INSERT_TEXT, { text: '' });

      expect(editor.getEditorState()).toBe(before);
    });
  });

  describe('DELETE_CHARACTER', () => {
    it('removes the last character when isBackward=true', () => {
      editor.dispatchCommand(SET_TEXT_CONTENT, 'hello');
      editor.dispatchCommand(DELETE_CHARACTER, { isBackward: true });

      expect(editor.read((s) => s.getText())).toBe('hell');
    });

    it('removes the first character when isBackward=false', () => {
      editor.dispatchCommand(SET_TEXT_CONTENT, 'hello');
      editor.dispatchCommand(DELETE_CHARACTER, { isBackward: false });

      expect(editor.read((s) => s.getText())).toBe('ello');
    });

    it('is a no-op on an empty document', () => {
      editor.dispatchCommand(DELETE_CHARACTER, { isBackward: true });
      expect(editor.read((s) => s.getText())).toBe('');
    });
  });

  describe('INSERT_PARAGRAPH', () => {
    it('appends a new empty paragraph to the document', () => {
      editor.dispatchCommand(SET_TEXT_CONTENT, 'first');
      editor.dispatchCommand(INSERT_PARAGRAPH, undefined);
      editor.dispatchCommand(INSERT_TEXT, { text: 'second' });

      expect(editor.read((s) => s.getText())).toBe('firstsecond');

      const paragraphCount = editor.read((s) => {
        let count = 0;
        let child = (s.nodes.get(s.rootKey) as { __first?: string } | undefined)?.__first ?? null;
        while (child) {
          count += 1;
          child = (s.nodes.get(child) as { __next?: string | null })?.__next ?? null;
        }
        return count;
      });
      expect(paragraphCount).toBe(2);
    });
  });

  describe('CLEAR_EDITOR', () => {
    it('resets to the v1 baseline: root > paragraph > empty text', () => {
      editor.dispatchCommand(SET_TEXT_CONTENT, 'something');
      expect(editor.read((s) => s.getText())).toBe('something');

      editor.dispatchCommand(CLEAR_EDITOR, undefined);

      expect(editor.read((s) => s.getText())).toBe('');
      expect(editor.getEditorState().nodes.size).toBe(3);
    });
  });

  describe('APPLY_EDITOR_STATE', () => {
    it('replaces the current state with the supplied state', () => {
      const externalState = EditorState.createEmpty();
      externalState.setText('external');

      editor.dispatchCommand(APPLY_EDITOR_STATE, externalState);

      expect(editor.getEditorState()).toBe(externalState);
      expect(editor.read((s) => s.getText())).toBe('external');
    });
  });

  describe('plugin override semantics', () => {
    it('a higher-priority handler can short-circuit a default handler', () => {
      const intercepted = jest.fn().mockReturnValue(true);
      editor.registerCommand(SET_TEXT_CONTENT, intercepted, CommandPriority.High);

      editor.dispatchCommand(SET_TEXT_CONTENT, 'blocked');

      expect(intercepted).toHaveBeenCalledWith('blocked');
      expect(editor.read((s) => s.getText())).toBe('');
    });

    it('when a plugin returns false the default handler still runs', () => {
      const observer = jest.fn().mockReturnValue(false);
      editor.registerCommand(SET_TEXT_CONTENT, observer, CommandPriority.High);

      editor.dispatchCommand(SET_TEXT_CONTENT, 'fall through');

      expect(observer).toHaveBeenCalledTimes(1);
      expect(editor.read((s) => s.getText())).toBe('fall through');
    });
  });
});
