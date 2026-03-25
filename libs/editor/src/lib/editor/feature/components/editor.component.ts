import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContentEditableDirective } from '@text-editor/directives';
import { Editor } from '../../core/editor';

@Component({
  selector: 'lib-editor',
  imports: [CommonModule, ContentEditableDirective],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  public readonly editor = new Editor();
}
