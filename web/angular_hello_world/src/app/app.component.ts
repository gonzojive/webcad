import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <h1>Hello, Angular World!</h1>
    <p>This is compiled with Bazel!</p>
  `,
  styles: [`
    h1 {
      color: #369;
      font-family: Arial, Helvetica, sans-serif;
    }
  `]
})
export class AppComponent {
  title = 'webcad-frontend';
}
