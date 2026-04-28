import { CommandPriority, INSERT_TEXT, SET_TEXT_CONTENT, createCommand } from './commands';
import { Editor } from './editor';
import { EditorPlugin, EditorPluginContext } from './plugin';

describe('EditorPluginContext', () => {
  let editor: Editor;
  let context: EditorPluginContext;

  beforeEach(() => {
    editor = new Editor();
    context = editor.getPluginContext();
  });

  it('exposes the documented public API surface', () => {
    expect(typeof context.registerCommand).toBe('function');
    expect(typeof context.registerUpdateListener).toBe('function');
    expect(typeof context.registerRootElementListener).toBe('function');
    expect(typeof context.registerSelectionListener).toBe('function');
    expect(typeof context.dispatchCommand).toBe('function');
    expect(typeof context.read).toBe('function');
    expect(typeof context.update).toBe('function');
    expect(typeof context.getEditorState).toBe('function');
    expect(typeof context.setEditorState).toBe('function');
    expect(typeof context.getSelection).toBe('function');
    expect(typeof context.setSelection).toBe('function');
    expect(typeof context.keyForDomNode).toBe('function');
    expect(typeof context.getDomForKey).toBe('function');
  });

  it('omits private editor internals from the context', () => {
    const ctx = context as unknown as Record<string, unknown>;
    expect(ctx['state']).toBeUndefined();
    expect(ctx['reconciler']).toBeUndefined();
    expect(ctx['commandHandlers']).toBeUndefined();
    expect(ctx['updateListeners']).toBeUndefined();
    expect(ctx['root']).toBeUndefined();
    expect(ctx['setRoot']).toBeUndefined();
  });

  it('routes registerCommand through the same bus as the editor', () => {
    const CMD = createCommand<void>('CMD');
    const handler = jest.fn().mockReturnValue(true);

    context.registerCommand(CMD, handler, CommandPriority.Normal);
    editor.dispatchCommand(CMD, undefined);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('update and read see the same state as the editor', () => {
    context.update((state) => state.setText('from plugin'));

    expect(editor.read((s) => s.getText())).toBe('from plugin');
    expect(context.read((s) => s.getText())).toBe('from plugin');
  });

  it('context methods remain bound when destructured', () => {
    const { registerCommand, dispatchCommand } = context;
    const handler = jest.fn().mockReturnValue(true);

    registerCommand(INSERT_TEXT, handler, CommandPriority.High);
    dispatchCommand(INSERT_TEXT, { text: 'hi' });

    expect(handler).toHaveBeenCalledWith({ text: 'hi' });
  });
});

describe('EditorPlugin setup lifecycle', () => {
  it('a plugin can register commands and listeners via its setup context', () => {
    const editor = new Editor();
    const listener = jest.fn();

    const plugin: EditorPlugin = {
      key: 'test-plugin',
      setup(ctx) {
        ctx.registerUpdateListener(listener);
        ctx.registerCommand(
          SET_TEXT_CONTENT,
          (payload) => {
            listener.mockName(`intercepted:${payload}`);
            return false;
          },
          CommandPriority.High,
        );
      },
    };

    plugin.setup(editor.getPluginContext());
    editor.dispatchCommand(SET_TEXT_CONTENT, 'plugged in');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.read((s) => s.getText())).toBe('plugged in');
  });

  it('setup return value is the plugin teardown, independent of destroy()', () => {
    const editor = new Editor();
    const teardown = jest.fn();
    const destroyed = jest.fn();

    const plugin: EditorPlugin = {
      key: 'teardown-plugin',
      setup: () => teardown,
      destroy: destroyed,
    };

    const cleanup = plugin.setup(editor.getPluginContext());
    expect(typeof cleanup).toBe('function');
    (cleanup as () => void)();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(destroyed).not.toHaveBeenCalled();

    plugin.destroy?.();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });
});
