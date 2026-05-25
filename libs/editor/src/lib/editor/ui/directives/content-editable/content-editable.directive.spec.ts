import { Component, inject, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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

describe('ContentEditableDirective', () => {
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

  describe('input bridge smoke test', () => {
    it('wires the editor-owned beforeinput listener through setRoot', () => {
      const event = createBeforeInput('insertText', { data: 'a' });
      host.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.read((state) => state.getText())).toBe('a');
    });
  });
});
