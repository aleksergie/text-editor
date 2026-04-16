import { Component, inject, ViewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CommandPriority,
  INSERT_TEXT,
  SET_TEXT_CONTENT,
} from '../core/commands';
import { EditorPlugin } from '../core/plugin';
import { ContentEditableDirective } from '../ui/directives/content-editable/content-editable.directive';
import { EDITOR_PLUGINS, providePlugin } from './editor-plugins.token';
import { EditorRuntimeService } from './editor-runtime.service';

function createBeforeInput(
  inputType: string,
  init: Partial<{ data: string }> = {},
): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: init.data ?? null,
  });
}

/** A plugin that upper-cases every INSERT_TEXT payload before it reaches the default handler. */
const uppercasingPlugin: EditorPlugin = {
  key: 'upper',
  setup(ctx) {
    const unregister = ctx.registerCommand(
      INSERT_TEXT,
      ({ text }) => {
        ctx.update((state) => state.insertText(text.toUpperCase()));
        return true;
      },
      CommandPriority.High,
    );
    return unregister;
  },
};

@Component({
  standalone: true,
  imports: [ContentEditableDirective],
  template: `<div
    #host
    contenteditable
    [editor]="runtime.editor"
  ></div>`,
  providers: [EditorRuntimeService, providePlugin(uppercasingPlugin)],
})
class HostWithPluginComponent {
  readonly runtime = inject(EditorRuntimeService);
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
}

@Component({
  standalone: true,
  imports: [ContentEditableDirective],
  template: `<div
    #host
    contenteditable
    [editor]="runtime.editor"
  ></div>`,
  providers: [EditorRuntimeService],
})
class BareHostComponent {
  readonly runtime = inject(EditorRuntimeService);
  @ViewChild('host', { static: true }) host!: { nativeElement: HTMLElement };
}

describe('Editor Angular integration', () => {
  describe('component + directive + plugin lifecycle', () => {
    it('plugin-registered handler intercepts typed input end-to-end', () => {
      const fixture = TestBed.configureTestingModule({
        imports: [HostWithPluginComponent],
      }).createComponent(HostWithPluginComponent);
      fixture.detectChanges();

      const host = fixture.componentInstance.host.nativeElement;
      host.dispatchEvent(createBeforeInput('insertText', { data: 'hi' }));

      expect(fixture.componentInstance.runtime.editor.read((s) => s.getText())).toBe(
        'HI',
      );
    });

    it('destroying the fixture tears down plugin teardowns', () => {
      const teardown = jest.fn();
      const plugin: EditorPlugin = {
        key: 'teardown',
        setup: () => teardown,
      };

      @Component({
        standalone: true,
        imports: [ContentEditableDirective],
        template: `<div #h contenteditable [editor]="runtime.editor"></div>`,
        providers: [EditorRuntimeService, providePlugin(plugin)],
      })
      class TeardownHostComponent {
        readonly runtime = inject(EditorRuntimeService);
      }

      const fixture = TestBed.configureTestingModule({
        imports: [TeardownHostComponent],
      }).createComponent(TeardownHostComponent);
      fixture.detectChanges();
      fixture.destroy();

      expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('detaches the reconciler root on destroy so the DOM is not mutated after teardown', () => {
      const fixture = TestBed.configureTestingModule({
        imports: [HostWithPluginComponent],
      }).createComponent(HostWithPluginComponent);
      fixture.detectChanges();
      const host = fixture.componentInstance.host.nativeElement;
      const editor = fixture.componentInstance.runtime.editor;

      fixture.destroy();

      const before = host.innerHTML;
      expect(() => editor.dispatchCommand(SET_TEXT_CONTENT, 'after destroy')).not.toThrow();
      expect(host.innerHTML).toBe(before);
    });
  });

  describe('multi-instance isolation', () => {
    @Component({
      standalone: true,
      imports: [ContentEditableDirective, HostWithPluginComponent, BareHostComponent],
      template: `
        <ng-container #a>
          <div #h1 contenteditable [editor]="runtime1.editor"></div>
        </ng-container>
        <ng-container #b>
          <div #h2 contenteditable [editor]="runtime2.editor"></div>
        </ng-container>
      `,
      // Component-scoped providers; the two runtimes below come from an
      // injector sub-tree per child so they're independent instances.
      providers: [{ provide: 'R1', useClass: EditorRuntimeService }],
    })
    class DummyHarnessComponent {
      // Only used to keep the imports referenced above alive for the type
      // checker - real isolation tests below drive sibling fixtures.
      readonly runtime1 = inject(EditorRuntimeService);
      readonly runtime2 = inject(EditorRuntimeService);
    }

    it('two sibling component fixtures get independent editors', () => {
      const f1 = TestBed.configureTestingModule({
        imports: [BareHostComponent],
      }).createComponent(BareHostComponent);
      const f2 = TestBed.createComponent(BareHostComponent);
      f1.detectChanges();
      f2.detectChanges();

      const e1 = f1.componentInstance.runtime.editor;
      const e2 = f2.componentInstance.runtime.editor;

      expect(e1).not.toBe(e2);

      e1.dispatchCommand(SET_TEXT_CONTENT, 'alpha');
      e2.dispatchCommand(SET_TEXT_CONTENT, 'beta');

      expect(e1.read((s) => s.getText())).toBe('alpha');
      expect(e2.read((s) => s.getText())).toBe('beta');

      expect(f1.componentInstance.host.nativeElement.textContent).toContain('alpha');
      expect(f2.componentInstance.host.nativeElement.textContent).toContain('beta');
      expect(f1.componentInstance.host.nativeElement.textContent).not.toContain('beta');
    });

    it('a plugin registered on one fixture does not bleed into another', () => {
      const pluginized = TestBed.configureTestingModule({
        imports: [HostWithPluginComponent],
      }).createComponent(HostWithPluginComponent);
      pluginized.detectChanges();

      const bare = TestBed.createComponent(BareHostComponent);
      bare.detectChanges();

      pluginized.componentInstance.host.nativeElement.dispatchEvent(
        createBeforeInput('insertText', { data: 'plug' }),
      );
      bare.componentInstance.host.nativeElement.dispatchEvent(
        createBeforeInput('insertText', { data: 'bare' }),
      );

      expect(pluginized.componentInstance.runtime.editor.read((s) => s.getText())).toBe(
        'PLUG',
      );
      expect(bare.componentInstance.runtime.editor.read((s) => s.getText())).toBe(
        'bare',
      );

      expect(DummyHarnessComponent).toBeDefined();
    });

    it('aggregates all providers behind EDITOR_PLUGINS', () => {
      const a: EditorPlugin = { key: 'a', setup: () => undefined };
      const b: EditorPlugin = { key: 'b', setup: () => undefined };
      const c: EditorPlugin = { key: 'c', setup: () => undefined };

      @Component({
        standalone: true,
        template: '',
        providers: [providePlugin(a), providePlugin(b), providePlugin(c)],
      })
      class ReaderComponent {
        readonly plugins = inject(EDITOR_PLUGINS);
      }

      const fixture = TestBed.configureTestingModule({
        imports: [ReaderComponent],
      }).createComponent(ReaderComponent);
      expect(fixture.componentInstance.plugins).toEqual([a, b, c]);
    });
  });
});
