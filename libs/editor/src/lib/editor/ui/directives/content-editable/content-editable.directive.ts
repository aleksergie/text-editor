import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  DELETE_CHARACTER,
  INSERT_PARAGRAPH,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from '../../../core/commands';
import { Editor } from '../../../core/editor';

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
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ContentEditableDirective),
      multi: true,
    },
  ],
})
export class ContentEditableDirective
  implements ControlValueAccessor, OnInit, OnChanges, OnDestroy
{
  private readonly elRef: ElementRef<HTMLElement> = inject(ElementRef);

  @Input() editor?: Editor;

  private onTouched: () => void = () => undefined;
  private onChange: (value: string) => void = () => undefined;

  private isComposing = false;
  /** Ignore update listener emissions triggered by our own `writeValue`. */
  private writingValue = false;
  /** True when the most recent state change was driven by our bridge. */
  private lastChangeFromBridge = false;
  private unregisterUpdateListener: (() => void) | null = null;

  ngOnInit(): void {
    this.attach(this.editor);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editor'] && !changes['editor'].firstChange) {
      this.detach();
      this.attach(this.editor);
    }
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

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }

  // --- ControlValueAccessor ------------------------------------------------

  writeValue(value: unknown): void {
    if (!this.editor) {
      return;
    }
    this.writingValue = true;
    try {
      this.editor.dispatchCommand(SET_TEXT_CONTENT, String(value ?? ''));
    } finally {
      this.writingValue = false;
    }
  }

  registerOnChange(onChange: (value: string) => void): void {
    this.onChange = onChange;
  }

  registerOnTouched(onTouched: () => void): void {
    this.onTouched = onTouched;
  }

  // --- internals -----------------------------------------------------------

  private attach(editor: Editor | undefined): void {
    if (!editor) {
      return;
    }
    editor.setRoot(this.elRef.nativeElement);
    this.unregisterUpdateListener = editor.registerUpdateListener(() => {
      this.afterUpdate();
    });
  }

  private detach(): void {
    this.unregisterUpdateListener?.();
    this.unregisterUpdateListener = null;
    this.editor?.setRoot(null);
  }

  private afterUpdate(): void {
    if (!this.editor) {
      return;
    }
    const text = this.editor.read((s) => s.getText());
    if (!this.writingValue) {
      this.onChange(text);
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
