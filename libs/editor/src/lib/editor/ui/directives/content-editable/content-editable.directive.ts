import { Directive, ElementRef, forwardRef, HostListener, inject, Renderer2 } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  selector: '[contenteditable][formControl]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ContentEditableDirectiveDirective),
      multi: true,
    },
  ],
})
export class ContentEditableDirectiveDirective implements ControlValueAccessor {
  private readonly elRef: ElementRef = inject(ElementRef);
  private readonly renderer: Renderer2 = inject(Renderer2);

  private onTouched: () => void = () => ({});
  private onChange: (value: unknown) => void = () => ({});

  @HostListener('input')
  onInput() {
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
    this.renderer.setProperty(this.elRef.nativeElement, 'value', value);
  }
}
