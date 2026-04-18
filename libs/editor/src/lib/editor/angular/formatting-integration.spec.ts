import { Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FORMAT_TEXT } from '../core/commands';
import { $createTextNode } from '../core/nodes/node-utils';
import { createTextRange } from '../core/selection';
import { TextFormat, hasFormat } from '../core/text-format';
import { FormattingKeyboardPlugin } from '../plugins/formatting-keyboard.plugin';
import { ContentEditableDirective } from '../ui/directives/content-editable/content-editable.directive';
import { FormattingToolbarComponent } from '../ui/components/formatting-toolbar/formatting-toolbar.component';
import { providePlugin } from './editor-plugins.token';
import { EditorRuntimeService } from './editor-runtime.service';

@Component({
  standalone: true,
  imports: [ContentEditableDirective, FormattingToolbarComponent],
  template: `
    <lib-formatting-toolbar></lib-formatting-toolbar>
    <div #host contenteditable [editor]="runtime.editor"></div>
  `,
  providers: [EditorRuntimeService, providePlugin(FormattingKeyboardPlugin)],
})
class FormattingHostComponent {
  readonly runtime = inject(EditorRuntimeService);
  readonly destroyRef = inject(DestroyRef);
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
}

describe('Formatting integration', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormattingHostComponent],
    });
  });

  it('FORMAT_TEXT flows from command bus through the runtime and re-renders the DOM', () => {
    const fixture = TestBed.createComponent(FormattingHostComponent);
    fixture.detectChanges();

    const editor = fixture.componentInstance.runtime.editor;
    editor.update((state) => {
      const t = state.getTextNodesInDocumentOrder()[0];
      t.text = 'hello';
      state.markDirty(t.key);
    });
    fixture.detectChanges();

    const range = createTextRange(
      { key: 't1', offset: 0 },
      { key: 't1', offset: 5 },
      false,
    );
    editor.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });
    fixture.detectChanges();

    const host = fixture.componentInstance.host.nativeElement;
    const paragraph = host.firstElementChild;
    const span = paragraph?.firstElementChild;
    expect(span?.firstElementChild?.tagName).toBe('STRONG');
    expect(span?.textContent).toBe('hello');
  });

  it('FormattingKeyboardPlugin removes native listeners on teardown', () => {
    const fixture = TestBed.createComponent(FormattingHostComponent);
    fixture.detectChanges();

    const editor = fixture.componentInstance.runtime.editor;
    const host = fixture.componentInstance.host.nativeElement;

    // Seed and mount a selection over the entire text run via DOM selection
    // so the plugin's dispatch path can resolve it.
    editor.update((state) => {
      const t = state.getTextNodesInDocumentOrder()[0];
      t.text = 'hello';
      state.markDirty(t.key);
    });
    fixture.detectChanges();

    const textNode = host.firstElementChild?.firstElementChild?.firstChild as Text;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Pre-teardown: Ctrl+B should toggle bold.
    host.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();

    const firstSpan = host.firstElementChild?.firstElementChild as HTMLElement;
    expect(firstSpan.firstElementChild?.tagName).toBe('STRONG');

    // Destroy the fixture: runtime teardown runs plugin cleanup which detaches
    // the keydown listener. A subsequent keydown must not change the model.
    fixture.destroy();

    const modelBefore = editor.read((s) => s.getText());
    host.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const modelAfter = editor.read((s) => s.getText());
    expect(modelAfter).toBe(modelBefore);
  });

  it('two editors on one page do not share formatting state', () => {
    const fixtureA = TestBed.createComponent(FormattingHostComponent);
    const fixtureB = TestBed.createComponent(FormattingHostComponent);
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    const editorA = fixtureA.componentInstance.runtime.editor;
    const editorB = fixtureB.componentInstance.runtime.editor;
    expect(editorA).not.toBe(editorB);

    [editorA, editorB].forEach((editor) => {
      editor.update((state) => {
        const t = state.getTextNodesInDocumentOrder()[0];
        t.text = 'hello';
        state.markDirty(t.key);
      });
    });
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    const range = createTextRange(
      { key: 't1', offset: 0 },
      { key: 't1', offset: 5 },
      false,
    );
    editorA.dispatchCommand(FORMAT_TEXT, { format: TextFormat.BOLD, range });
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    const [runA] = editorA.getEditorState().getTextNodesInDocumentOrder();
    const [runB] = editorB.getEditorState().getTextNodesInDocumentOrder();
    expect(hasFormat(runA.format, TextFormat.BOLD)).toBe(true);
    expect(hasFormat(runB.format, TextFormat.BOLD)).toBe(false);
  });
});
