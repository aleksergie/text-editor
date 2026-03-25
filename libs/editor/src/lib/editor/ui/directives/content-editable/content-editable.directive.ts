import { Directive, ElementRef, forwardRef, HostListener, inject, Input, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Editor } from '../../../core/editor';
import { SET_TEXT } from '../../../core/commands';

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
export class ContentEditableDirective implements ControlValueAccessor, OnInit, OnDestroy {
  private readonly elRef: ElementRef = inject(ElementRef);
  private readonly renderer: Renderer2 = inject(Renderer2);

  private onTouched: () => void = () => ({});
  private onChange: (value: unknown) => void = () => ({});

  @Input() editor?: Editor;

  ngOnInit(): void {
    if (this.editor) {
      this.editor.setRoot(this.elRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (this.editor) {
      this.editor.setRoot(null);
    }
  }

  @HostListener('input')
  onInput() {
    const value = this.elRef.nativeElement.innerText ?? '';
    if (this.editor) {
      this.editor.dispatchCommand(SET_TEXT, value);
      return;
    }
    this.onChange(this.elRef.nativeElement.innerHTML);
  }

  @HostListener('blur')
  onBlur() {
    this.onTouched();
  }

  registerOnChange(onChange: () => void) {
    this.onChange = onChange;
  }

  registerOnTouched(onTouched: () => void) {
    this.onTouched = onTouched;
  }

  writeValue(value: unknown): void {
    this.renderer.setProperty(this.elRef.nativeElement, 'innerHTML', value ?? '');
  }
}
