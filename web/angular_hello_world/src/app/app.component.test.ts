import 'zone.js';
import '@angular/compiler';
import assert from 'node:assert';
import test from 'node:test';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component.js';
import { JSDOM } from 'jsdom';

test('AppComponent class properties work', () => {
  const component = new AppComponent();
  assert.strictEqual(component.title, 'webcad-frontend');
});

test('AppComponent renders in JSDOM', async () => {
  // Initialize a virtual DOM inside Node.js using JSDOM
  const dom = new JSDOM('<!DOCTYPE html><html><body><app-root></app-root></body></html>', {
    url: 'http://localhost',
  });

  // Expose virtual DOM objects to Node's global scope so Angular and zone.js can interact with them
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;

  // Bootstrap the standalone component inside the JSDOM document
  const appRef = await bootstrapApplication(AppComponent);

  // Assert against the rendered DOM output
  const h1 = dom.window.document.querySelector('h1');
  assert.ok(h1, 'h1 element should exist in rendered DOM');
  assert.strictEqual(h1.textContent, 'Hello, Angular World!');

  const p = dom.window.document.querySelector('p');
  assert.ok(p, 'p element should exist');
  assert.strictEqual(p.textContent, 'This is compiled with Bazel!');

  // Tear down the Angular application reference
  appRef.destroy();
});
