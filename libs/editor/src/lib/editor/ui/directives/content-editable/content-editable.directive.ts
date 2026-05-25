import {
  Directive,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { EditorRef } from '../../../angular/editor-ref';
import { EDITOR_PLUGINS } from '../../../angular/editor-plugins.token';
import { createEditor, Editor } from '../../../core/editor';
import { EditorPlugin } from '../../../core/plugin';

@Directive({
  selector: '[contenteditable]',
})
export class ContentEditableDirective implements OnInit, OnDestroy {
  private readonly elRef: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly editorRef = inject(EditorRef);
  private readonly plugins = inject<readonly EditorPlugin[] | null>(EDITOR_PLUGINS, {
    optional: true,
  }) ?? [];

  private editor: Editor | null = null;
  private pluginTeardowns: Array<() => void> = [];

  ngOnInit(): void {
    const editor = createEditor();
    this.editor = editor;
    for (const plugin of this.plugins) {
      const cleanup = plugin.setup(editor.getPluginContext());
      if (typeof cleanup === 'function') {
        this.pluginTeardowns.push(cleanup);
      }
    }
    this.editorRef.set(editor);
    editor.setRoot(this.elRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.detach();
  }

  // --- internals -----------------------------------------------------------

  private detach(): void {
    for (let i = this.pluginTeardowns.length - 1; i >= 0; i -= 1) {
      this.pluginTeardowns[i]();
    }
    this.pluginTeardowns = [];
    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }
    this.editor?.setRoot(null);
    this.editor = null;
    this.editorRef.set(null);
  }
}
