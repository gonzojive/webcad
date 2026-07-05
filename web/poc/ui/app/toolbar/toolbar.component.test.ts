import 'zone.js';
import '@angular/compiler';
import assert from 'node:assert';
import test from 'node:test';
import { bootstrapApplication } from '@angular/platform-browser';
import { ToolbarComponent } from './toolbar.component.js';
import { ToolService } from '../services/tool.service.js';
import { JSDOM } from 'jsdom';
import { signal } from '@angular/core';

class MockToolService {
  readonly activeToolMode = signal<string>('select');
  setToolCalls: string[] = [];
  setTool(mode: string) {
    this.setToolCalls.push(mode);
    this.activeToolMode.set(mode);
  }
}

test('ToolbarComponent renders buttons and updates active class based on ToolService state', async () => {
  // 1. Setup JSDOM
  const dom = new JSDOM('<!DOCTYPE html><html><body><app-toolbar></app-toolbar></body></html>', {
    url: 'http://localhost',
  });

  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;

  // 2. Instantiate Mock Service
  const mockToolService = new MockToolService();

  // 3. Bootstrap component with mocked provider
  const appRef = await bootstrapApplication(ToolbarComponent, {
    providers: [
      { provide: ToolService, useValue: mockToolService }
    ]
  });

  const selectBtn = dom.window.document.querySelector('button:nth-of-type(1)')!;
  const lineBtn = dom.window.document.querySelector('button:nth-of-type(3)')!;
  const circleBtn = dom.window.document.querySelector('button:nth-of-type(4)')!;

  assert.ok(selectBtn, 'Select button should exist');
  assert.ok(lineBtn, 'Line button should exist');

  // Verify initial active class
  assert.ok(selectBtn.classList.contains('active'), 'Select button should initially be active');
  assert.ok(!lineBtn.classList.contains('active'), 'Line button should not initially be active');

  // 4. Simulate Click on Line button
  lineBtn.dispatchEvent(new dom.window.MouseEvent('click'));

  // Verify click calls ToolService.setTool
  assert.strictEqual(mockToolService.setToolCalls.length, 1);
  assert.strictEqual(mockToolService.setToolCalls[0], 'line');

  // Trigger change detection manually since JSDOM events don't trigger Zone.js auto-ticks
  appRef.tick();

  // Let's verify active classes updated
  assert.ok(!selectBtn.classList.contains('active'), 'Select button should no longer be active');
  assert.ok(lineBtn.classList.contains('active'), 'Line button should now be active');

  // 5. Change state externally via mock signal to "circle"
  mockToolService.activeToolMode.set('circle');
  
  // Trigger change detection
  appRef.tick();

  assert.ok(!lineBtn.classList.contains('active'), 'Line button should no longer be active after external change');
  assert.ok(circleBtn.classList.contains('active'), 'Circle button should now be active');

  // Clean up
  appRef.destroy();
});
