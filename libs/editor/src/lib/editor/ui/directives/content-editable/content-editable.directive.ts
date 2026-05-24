import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { EditorRef } from '../../../angular/editor-ref';
import { EDITOR_PLUGINS } from '../../../angular/editor-plugins.token';
import {
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from '../../../core/commands';
import { createEditor, Editor } from '../../../core/editor';
import { EditorPlugin } from '../../../core/plugin';

type HandledInputType =
  | 'insertText'
  | 'deleteContentBackward'
  | 'deleteContentForward'
  | 'insertParagraph';

const HANDLED_INPUT_TYPES = new Set<HandledInputType>([
  'insertText',
  'deleteContentBackward',
  'deleteContentForward',
  'insertParagraph',
]);

@Directive({
  selector: '[contenteditable]',
})
export class ContentEditableDirective implements OnInit, OnDestroy {
  private readonly elRef: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly editorRef = inject(EditorRef);
  private readonly plugins = inject<readonly EditorPlugin[] | null>(EDITOR_PLUGINS, {
    optional: true,
  }) ?? [];

  private editor: Editor | null = null;
  private pluginTeardowns: Array<() => void> = [];
  private isComposing = false;
  /** True when the most recent state change was driven by our bridge. */
  private lastChangeFromBridge = false;
  private unregisterUpdateListener: (() => void) | null = null;

  ngOnInit(): void {
    const editor = createEditor();
    this.editor = editor;
    for (const plugin of this.plugins) {
      const cleanup = plugin.setup(editor.getPluginContext());
      if (typeof cleanup === 'function') {
        this.pluginTeardowns.push(cleanup);
      }
    }
    this.editorRef.set(editor);
    editor.setRoot(this.elRef.nativeElement);
    this.unregisterUpdateListener = editor.registerUpdateListener(() => {
      this.afterUpdate();
    });
  }

  ngOnDestroy(): void {
    this.detach();
  }

  // --- browser event bridge -----------------------------------------------

  @HostListener('beforeinput', ['$event'])
  onBeforeInput(event: InputEvent): void {
    if (!this.editor) {
      return;
    }
    const inputType = event.inputType as HandledInputType;
    if (!HANDLED_INPUT_TYPES.has(inputType)) {
      return;
    }
    if (this.isComposing || event.isComposing) {
      return;
    }

    event.preventDefault();
    this.lastChangeFromBridge = true;

    switch (inputType) {
      case 'insertText': {
        const text = event.data ?? '';
        if (text.length > 0) {
          this.editor.dispatchCommand(INSERT_TEXT, { text });
        }
        break;
      }
      case 'deleteContentBackward':
        this.editor.dispatchCommand(DELETE_CHARACTER, { isBackward: true });
        break;
      case 'deleteContentForward':
        this.editor.dispatchCommand(DELETE_CHARACTER, { isBackward: false });
        break;
      case 'insertParagraph':
        this.editor.dispatchCommand(INSERT_PARAGRAPH, undefined);
        break;
    }
  }

  @HostListener('compositionstart')
  onCompositionStart(): void {
    this.isComposing = true;
  }

  @HostListener('compositionend')
  onCompositionEnd(): void {
    this.isComposing = false;
    this.resyncFromDom();
  }

  @HostListener('input')
  onInput(): void {
    if (!this.editor || this.isComposing) {
      return;
    }
    // Most input events arrive after a beforeinput we already handled;
    // resyncFromDom is a no-op when the DOM already matches the model.
    this.resyncFromDom();
  }

  // --- internals -----------------------------------------------------------

  private detach(): void {
    this.unregisterUpdateListener?.();
    this.unregisterUpdateListener = null;
    for (let i = this.pluginTeardowns.length - 1; i >= 0; i -= 1) {
      this.pluginTeardowns[i]();
    }
    this.pluginTeardowns = [];
    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }
    this.editor?.setRoot(null);
    this.editor = null;
    this.editorRef.set(null);
  }

  private afterUpdate(): void {
    if (!this.editor) {
      return;
    }
    // Only reposition the caret for mutations that originated at this bridge
    // (typing, deletion, Enter). Programmatic / plugin-driven updates leave
    // the caret alone.
    if (this.lastChangeFromBridge) {
      this.lastChangeFromBridge = false;
      this.placeCursorAtEnd();
    }
  }

  private resyncFromDom(): void {
    if (!this.editor) {
      return;
    }
    const domText = this.readDomText();
    const modelText = this.editor.read((s) => s.getText());
    if (domText === modelText) {
      return;
    }
    this.lastChangeFromBridge = true;
    this.editor.dispatchCommand(SET_TEXT_CONTENT, domText);
  }

  private readDomText(): string {
    // `innerText` respects line breaks for paragraph boundaries in a
    // contenteditable, which matches our v1 plain-text model.
    return this.elRef.nativeElement.innerText ?? '';
  }

  private placeCursorAtEnd(): void {
    const rootEl = this.elRef.nativeElement;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(rootEl);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
