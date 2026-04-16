import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorPlugin } from '../core/plugin';
import { EDITOR_PLUGINS, providePlugin } from './editor-plugins.token';
import { EditorRuntimeService } from './editor-runtime.service';

function makeHost(providers: unknown[]) {
  @Component({
    standalone: true,
    template: '',
    providers: [EditorRuntimeService, ...(providers as never[])],
  })
  class HostComponent {
    readonly runtime = inject(EditorRuntimeService);
  }

  return HostComponent;
}

describe('EditorRuntimeService', () => {
  it('creates an Editor when no plugins are provided', () => {
    const Host = makeHost([]);
    const fixture = TestBed.configureTestingModule({ imports: [Host] }).createComponent(
      Host,
    );

    expect(fixture.componentInstance.runtime.editor).toBeDefined();
  });

  it('composes multiple plugin providers in registration order', () => {
    const calls: string[] = [];
    const a: EditorPlugin = {
      key: 'a',
      setup: () => {
        calls.push('a');
      },
    };
    const b: EditorPlugin = {
      key: 'b',
      setup: () => {
        calls.push('b');
      },
    };

    const Host = makeHost([providePlugin(a), providePlugin(b)]);
    TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);

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
    TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);

    expect(seen).toHaveBeenCalledTimes(1);
    const ctx = seen.mock.calls[0][0];
    expect(typeof ctx.registerCommand).toBe('function');
    expect(typeof ctx.getEditorState).toBe('function');
  });

  it('runs teardown on ngOnDestroy in reverse setup order', () => {
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
    fixture.destroy();

    expect(calls).toEqual(['b', 'a']);
  });

  it('invokes plugin.destroy() on ngOnDestroy', () => {
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
    fixture.destroy();

    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('provides per-component isolation: two host components get different editors', () => {
    const Host = makeHost([]);
    const f1 = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    const f2 = TestBed.createComponent(Host);

    expect(f1.componentInstance.runtime).not.toBe(f2.componentInstance.runtime);
    expect(f1.componentInstance.runtime.editor).not.toBe(
      f2.componentInstance.runtime.editor,
    );
  });

  it('command registrations in one editor do not leak to another', () => {
    const Host = makeHost([]);
    const f1 = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    const f2 = TestBed.createComponent(Host);
    const e1 = f1.componentInstance.runtime.editor;
    const e2 = f2.componentInstance.runtime.editor;

    e1.dispatchCommand(
      {
        type: 'noop',
      } as never,
      undefined as never,
    );

    e1.update((state) => state.setText('one'));
    e2.update((state) => state.setText('two'));

    expect(e1.read((s) => s.getText())).toBe('one');
    expect(e2.read((s) => s.getText())).toBe('two');
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
