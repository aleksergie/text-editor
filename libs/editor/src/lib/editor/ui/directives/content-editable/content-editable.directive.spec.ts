import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContentEditableDirective } from './content-editable.directive';

@Component({
  template: `<div contenteditable [editor]="undefined"></div>`,
  standalone: true,
  imports: [ContentEditableDirective],
})
class HostComponent {}

describe('ContentEditableDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture).toBeTruthy();
  });
});
