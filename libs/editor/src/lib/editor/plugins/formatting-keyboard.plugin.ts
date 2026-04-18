import { FORMAT_TEXT } from '../core/commands';
import { EditorPlugin, EditorPluginContext } from '../core/plugin';
import { resolveDomSelection } from '../core/selection';
import { TextFormat, TextFormatFlag } from '../core/text-format';

/**
 * Map of keyboard shortcut (uppercase single-letter key) to the `TextFormat`
 * flag it toggles. Modifier matching (Ctrl on Windows/Linux, Cmd on macOS)
 * plus optional Shift is handled at the keydown site.
 */
const SHORTCUTS: ReadonlyArray<{
  key: string;
  shift: boolean;
  flag: TextFormatFlag;
}> = [
  { key: 'B', shift: false, flag: TextFormat.BOLD },
  { key: 'I', shift: false, flag: TextFormat.ITALIC },
  { key: 'U', shift: false, flag: TextFormat.UNDERLINE },
  { key: 'X', shift: true, flag: TextFormat.STRIKETHROUGH },
  { key: 'E', shift: false, flag: TextFormat.CODE },
];

/**
 * Plugin that wires the standard rich-text keyboard shortcuts
 * (Ctrl/Cmd+B/I/U, Ctrl/Cmd+Shift+X, Ctrl/Cmd+E) to `FORMAT_TEXT`.
 *
 * The plugin only depends on the public `EditorPluginContext` surface:
 * `registerRootElementListener` to follow the mounted root, the selection
 * bridge via `resolveDomSelection`, and `dispatchCommand` to run the
 * command. It does not register any commands of its own.
 */
export const FormattingKeyboardPlugin: EditorPlugin = {
  key: 'formatting-keyboard',
  setup(context: EditorPluginContext): () => void {
    let currentRoot: HTMLElement | null = null;

    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toUpperCase();
      for (const shortcut of SHORTCUTS) {
        if (shortcut.key === key && shortcut.shift === event.shiftKey) {
          const win =
            (currentRoot?.ownerDocument?.defaultView as Window & typeof globalThis) ??
            globalThis.window;
          const range = resolveDomSelection(context, win);
          if (!range || range.isCollapsed) {
            return;
          }
          event.preventDefault();
          context.dispatchCommand(FORMAT_TEXT, { format: shortcut.flag, range });
          return;
        }
      }
    };

    const detachCurrent = () => {
      if (currentRoot) {
        currentRoot.removeEventListener('keydown', handleKeydown);
        currentRoot = null;
      }
    };

    const unsubscribeRoot = context.registerRootElementListener((root) => {
      detachCurrent();
      currentRoot = root;
      if (root) {
        root.addEventListener('keydown', handleKeydown);
      }
    });

    return () => {
      unsubscribeRoot();
      detachCurrent();
    };
  },
};
