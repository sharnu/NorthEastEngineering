import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Pipe({ name: 'safeResource', standalone: true })
export class SafeResourcePipe implements PipeTransform {
  private san = inject(DomSanitizer);

  transform(url: string): SafeResourceUrl {
    return this.san.bypassSecurityTrustResourceUrl(url);
  }
}
