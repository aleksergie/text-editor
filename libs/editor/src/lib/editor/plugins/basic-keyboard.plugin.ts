import { INSERT_TAB, INSERT_LINE_BREAK } from '../core/commands';
import { EditorPlugin, EditorPluginContext } from '../core/plugin';
import { resolveDomSelection } from '../core/selection';

export const BasicKeyboardPlugin: EditorPlugin = {
  key: 'basic-keyboard',
  setup(context: EditorPluginContext): () => void {
    let currentRoot: HTMLElement | null = null;

    const handleKeydown = (event: KeyboardEvent) => {
      // Handle Tab
      if (event.key === 'Tab') {
        const win =
          (currentRoot?.ownerDocument?.defaultView as Window & typeof globalThis) ??
          globalThis.window;
        const range = resolveDomSelection(context, win);
        if (!range) {
          return;
        }
        event.preventDefault();
        context.dispatchCommand(INSERT_TAB, { range });
        return;
      }
      
      // Fallback for Shift+Enter if browser doesn't map it to insertLineBreak beforeinput
      if (event.key === 'Enter' && event.shiftKey) {
        const win =
          (currentRoot?.ownerDocument?.defaultView as Window & typeof globalThis) ??
          globalThis.window;
        const range = resolveDomSelection(context, win);
        if (!range) {
          return;
        }
        event.preventDefault();
        context.dispatchCommand(INSERT_LINE_BREAK, { range });
        return;
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
