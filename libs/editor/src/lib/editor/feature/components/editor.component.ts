import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { provideEditor } from '../../angular/editor-ref';
import { ContentEditableDirective } from '../../ui/directives/content-editable/content-editable.directive';

@Component({
  selector: 'lib-editor',
  imports: [CommonModule, ContentEditableDirective],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
  providers: [provideEditor()],
})
export class EditorComponent {}
