import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorRuntimeService } from '../../angular/editor-runtime.service';
import { ContentEditableDirective } from '../../ui/directives/content-editable/content-editable.directive';

@Component({
  selector: 'lib-editor',
  imports: [CommonModule, ContentEditableDirective],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
  providers: [EditorRuntimeService],
})
export class EditorComponent {
  private readonly runtime = inject(EditorRuntimeService);
  readonly editor = this.runtime.editor;
}
