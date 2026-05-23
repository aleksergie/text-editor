import { Component, inject, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EditorRef, provideEditor } from '../../../angular/editor-ref';
import { Editor } from '../../../core/editor';
import { ContentEditableDirective } from './content-editable.directive';

@Component({
  template: `<div
    #host
    contenteditable
    data-testid="host"
  ></div>`,
  standalone: true,
  imports: [ContentEditableDirective],
  providers: [provideEditor()],
})
class HarnessComponent {
  readonly editorRef = inject(EditorRef);
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
}

@Component({
  template: `<div
    #host
    contenteditable
    [formControl]="ctrl"
  ></div>`,
  standalone: true,
  imports: [ContentEditableDirective, ReactiveFormsModule],
  providers: [provideEditor()],
})
class FormHarnessComponent {
  readonly editorRef = inject(EditorRef);
  readonly ctrl = new FormControl<string>('');
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
}

function createBeforeInput(
  inputType: string,
  init: Partial<{ data: string; isComposing: boolean }> = {},
): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: init.data ?? null,
    isComposing: init.isComposing ?? false,
  });
}

function getEditor(ref: EditorRef): Editor {
  const editor = ref.editor();
  expect(editor).not.toBeNull();
  return editor as Editor;
}

describe('ContentEditableDirective - bridge', () => {
  let fixture: ComponentFixture<HarnessComponent>;
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HarnessComponent] });
    fixture = TestBed.createComponent(HarnessComponent);
    fixture.detectChanges();
    editor = getEditor(fixture.componentInstance.editorRef);
    host = fixture.componentInstance.host.nativeElement;
  });

  describe('construction', () => {
    it('instantiates and attaches the editor to the host element', () => {
      expect(fixture).toBeTruthy();
      expect(host.querySelector('p')).toBeTruthy();
    });
  });

  describe('beforeinput → commands', () => {
    it('insertText dispatches INSERT_TEXT and prevents default', () => {
      const event = createBeforeInput('insertText', { data: 'a' });
      host.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.read((s) => s.getText())).toBe('a');
    });

    it('accumulates insertText events into the document tail', () => {
      host.dispatchEvent(createBeforeInput('insertText', { data: 'h' }));
      host.dispatchEvent(createBeforeInput('insertText', { data: 'i' }));

      expect(editor.read((s) => s.getText())).toBe('hi');
    });

    it('deleteContentBackward removes the last character', () => {
      editor.update((state) => state.setText('hello'));
      const event = createBeforeInput('deleteContentBackward');
      host.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.read((s) => s.getText())).toBe('hell');
    });

    it('deleteContentForward removes the first character', () => {
      editor.update((state) => state.setText('hello'));
      host.dispatchEvent(createBeforeInput('deleteContentForward'));

      expect(editor.read((s) => s.getText())).toBe('ello');
    });

    it('insertParagraph appends a new paragraph', () => {
      editor.update((state) => state.setText('first'));
      host.dispatchEvent(createBeforeInput('insertParagraph'));
      host.dispatchEvent(createBeforeInput('insertText', { data: 'second' }));

      expect(editor.read((s) => s.getText())).toBe('firstsecond');
    });

    it('does not preventDefault for unhandled input types', () => {
      const event = createBeforeInput('insertFromPaste', { data: 'x' });
      host.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('composition (IME)', () => {
    it('skips dispatch during composition', () => {
      host.dispatchEvent(new Event('compositionstart'));

      const event = createBeforeInput('insertText', { data: 'x', isComposing: true });
      host.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(editor.read((s) => s.getText())).toBe('');
    });

    it('resyncs the model from innerText on compositionend', () => {
      host.dispatchEvent(new Event('compositionstart'));
      host.innerText = 'composed';

      host.dispatchEvent(new Event('compositionend'));

      expect(editor.read((s) => s.getText())).toBe('composed');
    });
  });
});

describe('ContentEditableDirective - ControlValueAccessor', () => {
  let fixture: ComponentFixture<FormHarnessComponent>;
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FormHarnessComponent] });
    fixture = TestBed.createComponent(FormHarnessComponent);
    fixture.detectChanges();
    editor = getEditor(fixture.componentInstance.editorRef);
    host = fixture.componentInstance.host.nativeElement;
  });

  it('writeValue via setValue replaces the editor text', () => {
    fixture.componentInstance.ctrl.setValue('from form');

    expect(editor.read((s) => s.getText())).toBe('from form');
  });

  it('does not re-emit onChange for programmatic writeValue', () => {
    const changes: Array<string | null> = [];
    fixture.componentInstance.ctrl.valueChanges.subscribe((v) => changes.push(v));

    fixture.componentInstance.ctrl.setValue('programmatic');

    // Only the user-initiated setValue emission, no round-trip from writeValue.
    expect(changes).toEqual(['programmatic']);
  });

  it('emits plain text via onChange when the user types', () => {
    const changes: Array<string | null> = [];
    fixture.componentInstance.ctrl.valueChanges.subscribe((v) => changes.push(v));

    host.dispatchEvent(createBeforeInput('insertText', { data: 'hi' }));

    expect(changes).toContain('hi');
  });
});
