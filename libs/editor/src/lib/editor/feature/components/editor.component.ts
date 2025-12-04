import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContentEditableDirectiveDirective } from '../../ui/directives/content-editable/content-editable.directive';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'lib-editor',
  imports: [CommonModule, ContentEditableDirectiveDirective, ReactiveFormsModule],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit {
  public readonly control = new FormControl();
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(console.log);
  }
}
