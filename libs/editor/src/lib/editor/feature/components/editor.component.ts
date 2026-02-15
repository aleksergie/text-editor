import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ContentEditableDirective } from '@text-editor/directives';

@Component({
  selector: 'lib-editor',
  imports: [CommonModule, ContentEditableDirective, ReactiveFormsModule],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit {
  public readonly control = new FormControl('');
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(console.log);
  }
}
