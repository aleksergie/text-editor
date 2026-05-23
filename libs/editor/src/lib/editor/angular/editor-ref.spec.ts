import { Component, ViewChild, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SET_TEXT_CONTENT } from '../core/commands';
import { EditorPlugin } from '../core/plugin';
import { ContentEditableDirective } from '../ui/directives/content-editable/content-editable.directive';
import { EditorRef, provideEditor } from './editor-ref';
import { EDITOR_PLUGINS, providePlugin } from './editor-plugins.token';

function makeHost(providers: unknown[] = []) {
  @Component({
    standalone: true,
    imports: [ContentEditableDirective],
    template: `<div #host contenteditable></div>`,
    providers: [provideEditor(), ...(providers as never[])],
  })
  class HostComponent {
    readonly editorRef = inject(EditorRef);
    @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
  }

  return HostComponent;
}

describe('EditorRef + ContentEditableDirective lifecycle', () => {
  it('publishes the directive-created editor after attach', () => {
    const Host = makeHost();
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(
      Host,
    );

    expect(fixture.componentInstance.editorRef.editor()).toBeNull();

    fixture.detectChanges();

    const editor = fixture.componentInstance.editorRef.editor();
    expect(editor).toBeDefined();
    expect(fixture.componentInstance.host.nativeElement.querySelector('p')).toBeTruthy();
  });

  it('clears the published editor on destroy', () => {
    const Host = makeHost();
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(
      Host,
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.editorRef.editor()).toBeDefined();

    fixture.destroy();

    expect(fixture.componentInstance.editorRef.editor()).toBeNull();
  });

  it('composes multiple plugin providers in registration order', () => {
    const calls: string[] = [];
    const a: EditorPlugin = { key: 'a', setup: () => void calls.push('a') };
    const b: EditorPlugin = { key: 'b', setup: () => void calls.push('b') };
    const Host = makeHost([providePlugin(a), providePlugin(b)]);

    TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host).detectChanges();

    expect(calls).toEqual(['a', 'b']);
  });

  it('passes each plugin the editor plugin context', () => {
    const seen = jest.fn();
    const plugin: EditorPlugin = {
      key: 'capture',
      setup: (ctx) => {
        seen(ctx);
      },
    };
    const Host = makeHost([providePlugin(plugin)]);

    TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host).detectChanges();

    expect(seen).toHaveBeenCalledTimes(1);
    const ctx = seen.mock.calls[0][0];
    expect(typeof ctx.registerCommand).toBe('function');
    expect(typeof ctx.getEditorState).toBe('function');
  });

  it('runs setup teardowns on destroy in reverse registration order', () => {
    const calls: string[] = [];
    const a: EditorPlugin = {
      key: 'a',
      setup: () => () => {
        calls.push('a');
      },
    };
    const b: EditorPlugin = {
      key: 'b',
      setup: () => () => {
        calls.push('b');
      },
    };
    const Host = makeHost([providePlugin(a), providePlugin(b)]);
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(
      Host,
    );
    fixture.detectChanges();

    fixture.destroy();

    expect(calls).toEqual(['b', 'a']);
  });

  it('invokes plugin.destroy() on destroy', () => {
    const destroyed = jest.fn();
    const plugin: EditorPlugin = {
      key: 'd',
      setup: () => undefined,
      destroy: destroyed,
    };
    const Host = makeHost([providePlugin(plugin)]);
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(
      Host,
    );
    fixture.detectChanges();

    fixture.destroy();

    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('provides per-component isolation: two host components get different editors', () => {
    const Host = makeHost();
    const f1 = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    const f2 = TestBed.createComponent(Host);
    f1.detectChanges();
    f2.detectChanges();

    expect(f1.componentInstance.editorRef).not.toBe(f2.componentInstance.editorRef);
    expect(f1.componentInstance.editorRef.editor()).not.toBe(
      f2.componentInstance.editorRef.editor(),
    );
  });

  it('command registrations in one editor do not leak to another', () => {
    const Host = makeHost();
    const f1 = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    const f2 = TestBed.createComponent(Host);
    f1.detectChanges();
    f2.detectChanges();
    const e1 = f1.componentInstance.editorRef.editor();
    const e2 = f2.componentInstance.editorRef.editor();
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();

    e1?.dispatchCommand(SET_TEXT_CONTENT, 'one');
    e2?.dispatchCommand(SET_TEXT_CONTENT, 'two');

    expect(e1?.read((s) => s.getText())).toBe('one');
    expect(e2?.read((s) => s.getText())).toBe('two');
  });
});

describe('EDITOR_PLUGINS token', () => {
  it('is aggregated as an array via multi: true providers', () => {
    const a: EditorPlugin = { key: 'a', setup: () => undefined };
    const b: EditorPlugin = { key: 'b', setup: () => undefined };

    @Component({
      standalone: true,
      template: '',
      providers: [providePlugin(a), providePlugin(b)],
    })
    class ReaderComponent {
      readonly plugins = inject(EDITOR_PLUGINS);
    }

    const fixture = TestBed.configureTestingModule({
      imports: [ReaderComponent],
    }).createComponent(ReaderComponent);

    expect(fixture.componentInstance.plugins).toEqual([a, b]);
  });
});
