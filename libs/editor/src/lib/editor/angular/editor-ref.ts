import { Injectable, Provider, signal } from '@angular/core';
import { Editor } from '../core/editor';

@Injectable()
export class EditorRef {
  private readonly _editor = signal<Editor | null>(null);
  readonly editor = this._editor.asReadonly();

  set(editor: Editor | null): void {
    this._editor.set(editor);
  }
}

export function provideEditor(): Provider {
  return EditorRef;
}
