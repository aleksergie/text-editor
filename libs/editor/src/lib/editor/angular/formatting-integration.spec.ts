import { Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FORMAT_TEXT } from '../core/commands';
import { createTextRange } from '../core/selection';
import { TextFormat, hasFormat } from '../core/text-format';
import { FormattingKeyboardPlugin } from '../plugins/formatting-keyboard.plugin';
import { SelectionSyncPlugin } from '../plugins/selection-sync.plugin';
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
  providers: [
    EditorRuntimeService,
    providePlugin(FormattingKeyboardPlugin),
    // SelectionSyncPlugin is the Phase-3 contract: the toolbar reads
    // selection from the editor cache, which is populated by this plugin
    // forwarding native `selectionchange` events. Without it the toolbar
    // never lights up.
    providePlugin(SelectionSyncPlugin),
  ],
})
class FormattingHostComponent {
  readonly runtime = inject(EditorRuntimeService);
  readonly destroyRef = inject(DestroyRef);
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
  @ViewChild(FormattingToolbarComponent, { static: true })
  toolbar!: FormattingToolbarComponent;
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

  /**
   * Phase 3 acceptance: the toolbar no longer owns a `selectionchange`
   * listener. Selection state reaches it via the editor's selection
   * listener, which is populated by `SelectionSyncPlugin`. These three
   * tests cover the new contract end-to-end.
   */
  describe('Phase 3: toolbar consumes editor-owned selection', () => {
    /**
     * Walk container -> <p> -> <span> -> (formatting wrappers)? -> Text.
     * Mirrors the helper in selection-sync.plugin.spec.ts.
     */
    function getInnermostText(container: HTMLElement): Text {
      const paragraph = container.firstElementChild as HTMLElement;
      const span = paragraph.firstElementChild as HTMLElement;
      let cursor: Node = span;
      while (cursor.firstChild && cursor.firstChild.nodeType === Node.ELEMENT_NODE) {
        cursor = cursor.firstChild;
      }
      return cursor.firstChild as Text;
    }

    interface SelectionStub {
      rangeCount: number;
      anchorNode?: Node | null;
      anchorOffset?: number;
      focusNode?: Node | null;
      focusOffset?: number;
    }

    function withStubbedSelection(
      stub: SelectionStub,
      action: () => void,
    ): void {
      const original = window.getSelection.bind(window);
      Object.defineProperty(window, 'getSelection', {
        value: () => stub as unknown as Selection,
        configurable: true,
        writable: true,
      });
      try {
        action();
      } finally {
        Object.defineProperty(window, 'getSelection', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }

    it('toolbar activeFlags update when SelectionSyncPlugin forwards a native selectionchange', () => {
      const fixture = TestBed.createComponent(FormattingHostComponent);
      fixture.detectChanges();

      const editor = fixture.componentInstance.runtime.editor;
      const host = fixture.componentInstance.host.nativeElement;
      const toolbar = fixture.componentInstance.toolbar;

      // Seed "helloworld" and bold the first 5 chars so the document has
      // a partially-formatted run we can select across.
      editor.update((state) => {
        const t = state.getTextNodesInDocumentOrder()[0];
        t.text = 'helloworld';
        state.markDirty(t.key);
      });
      fixture.detectChanges();

      editor.dispatchCommand(FORMAT_TEXT, {
        format: TextFormat.BOLD,
        range: createTextRange(
          { key: 't1', offset: 0 },
          { key: 't1', offset: 5 },
          false,
        ),
      });
      fixture.detectChanges();

      // Initial state: no selection forwarded yet, all flags off.
      expect(toolbar.activeFlags).toBe(TextFormat.NONE);

      // Drop a native selection inside the bolded prefix and dispatch
      // selectionchange. SelectionSyncPlugin forwards it to the editor,
      // the toolbar's selection listener fires, and activeFlags updates.
      const boldText = getInnermostText(host);
      withStubbedSelection(
        {
          rangeCount: 1,
          anchorNode: boldText,
          anchorOffset: 0,
          focusNode: boldText,
          focusOffset: 3,
        },
        () => {
          document.dispatchEvent(new Event('selectionchange'));
        },
      );
      fixture.detectChanges();

      expect(hasFormat(toolbar.activeFlags, TextFormat.BOLD)).toBe(true);
      expect(hasFormat(toolbar.activeFlags, TextFormat.ITALIC)).toBe(false);
    });

    it('toolbar mousedown path uses cached selection without reading the DOM', () => {
      const fixture = TestBed.createComponent(FormattingHostComponent);
      fixture.detectChanges();

      const editor = fixture.componentInstance.runtime.editor;
      const host = fixture.componentInstance.host.nativeElement;

      editor.update((state) => {
        const t = state.getTextNodesInDocumentOrder()[0];
        t.text = 'hello';
        state.markDirty(t.key);
      });
      fixture.detectChanges();

      // Programmatic selection only - the DOM `window.getSelection()` is
      // intentionally untouched. If the toolbar still secretly reads the
      // DOM at click time, this test will fail because no DOM selection
      // exists to pick up from.
      editor.setSelection(
        createTextRange(
          { key: 't1', offset: 0 },
          { key: 't1', offset: 5 },
          false,
        ),
        { source: 'user' },
      );
      fixture.detectChanges();

      // Click the Bold button via mousedown (matches the template event).
      const boldButton = fixture.nativeElement.querySelector(
        'button.lib-formatting-toolbar__btn',
      ) as HTMLElement;
      expect(boldButton).not.toBeNull();
      boldButton.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();

      const [run] = editor.getEditorState().getTextNodesInDocumentOrder();
      expect(hasFormat(run.format, TextFormat.BOLD)).toBe(true);

      // DOM mirrors model: after reconciliation the rendered text should
      // be wrapped in a STRONG tag.
      const span = host.firstElementChild?.firstElementChild as HTMLElement;
      expect(span.firstElementChild?.tagName).toBe('STRONG');
    });

    it("a selection inside editor B does not light up editor A's toolbar", () => {
      const fixtureA = TestBed.createComponent(FormattingHostComponent);
      const fixtureB = TestBed.createComponent(FormattingHostComponent);
      // Both fixtures need to be live in the document for `root.contains`
      // checks inside SelectionSyncPlugin to work correctly.
      document.body.appendChild(fixtureA.nativeElement);
      document.body.appendChild(fixtureB.nativeElement);
      try {
        fixtureA.detectChanges();
        fixtureB.detectChanges();

        const editorA = fixtureA.componentInstance.runtime.editor;
        const editorB = fixtureB.componentInstance.runtime.editor;
        const hostA = fixtureA.componentInstance.host.nativeElement;
        const hostB = fixtureB.componentInstance.host.nativeElement;
        const toolbarA = fixtureA.componentInstance.toolbar;
        const toolbarB = fixtureB.componentInstance.toolbar;

        // Seed both with text and pre-bold editor B's first run so a
        // selection inside it would otherwise produce a non-zero flag set.
        [editorA, editorB].forEach((editor) => {
          editor.update((state) => {
            const t = state.getTextNodesInDocumentOrder()[0];
            t.text = 'hello';
            state.markDirty(t.key);
          });
        });
        fixtureA.detectChanges();
        fixtureB.detectChanges();

        editorB.dispatchCommand(FORMAT_TEXT, {
          format: TextFormat.BOLD,
          range: createTextRange(
            { key: 't1', offset: 0 },
            { key: 't1', offset: 5 },
            false,
          ),
        });
        fixtureA.detectChanges();
        fixtureB.detectChanges();

        const boldTextB = getInnermostText(hostB);
        withStubbedSelection(
          {
            rangeCount: 1,
            anchorNode: boldTextB,
            anchorOffset: 0,
            focusNode: boldTextB,
            focusOffset: 5,
          },
          () => {
            document.dispatchEvent(new Event('selectionchange'));
          },
        );
        fixtureA.detectChanges();
        fixtureB.detectChanges();

        // Editor B's toolbar reflects its bolded selection.
        expect(hasFormat(toolbarB.activeFlags, TextFormat.BOLD)).toBe(true);
        // Editor A's toolbar saw a `selectionchange` for a node that is
        // NOT inside its own root, so its sync plugin filtered it out and
        // the toolbar stays at zero. This is the property Phase 3 unlocks.
        expect(toolbarA.activeFlags).toBe(TextFormat.NONE);

        // Touch hostA so we read the rendered text - silences linters
        // that might otherwise complain about an unused binding.
        expect(hostA.textContent).toContain('hello');
      } finally {
        document.body.removeChild(fixtureA.nativeElement);
        document.body.removeChild(fixtureB.nativeElement);
      }
    });
  });
});
