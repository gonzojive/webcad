import 'zone.js';
import '@angular/compiler';
import assert from 'node:assert';
import test from 'node:test';
import { bootstrapApplication } from '@angular/platform-browser';
import { DimensionInputComponent } from './dimension-input.component.js';
import { WorkspaceService } from '../services/workspace.service.js';
import { ToolService } from '../services/tool.service.js';
import { JSDOM } from 'jsdom';
import { signal } from '@angular/core';

class MockWorkspaceService {
  activeDimensionInputRequest = signal<any>(null);
  preferredUnit = signal<string>('mm');
}

test('DimensionInputComponent visibility, positioning, and submissions', async () => {
  // 1. Setup JSDOM
  const dom = new JSDOM('<!DOCTYPE html><html><body><app-dimension-input></app-dimension-input></body></html>', {
    url: 'http://localhost',
  });

  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;

  // Mock global alert
  let alertMessage = '';
  const mockAlert = (msg: string) => {
    alertMessage = msg;
  };
  globalThis.alert = mockAlert as any;
  globalThis.window.alert = mockAlert as any;

  // 2. Setup Mock Services
  const mockWorkspaceService = new MockWorkspaceService();
  const mockToolService = {
    activeRenderer: {
      sketchToScreen(pos: { x: number; y: number }) {
        return { x: pos.x * 2, y: pos.y * 3 }; // custom translation scaling
      }
    }
  };

  // 3. Bootstrap component
  const appRef = await bootstrapApplication(DimensionInputComponent, {
    providers: [
      { provide: WorkspaceService, useValue: mockWorkspaceService },
      { provide: ToolService, useValue: mockToolService }
    ]
  });

  // Verify initially hidden
  let container = dom.window.document.querySelector('.inline-input-container') as HTMLElement | null;
  assert.strictEqual(container, null, 'Input container should not exist initially');

  // 4. Trigger Input Request
  let callbackValue: number | null = null;
  let cancelled = false;
  
  mockWorkspaceService.activeDimensionInputRequest.set({
    pos: { x: 100, y: 150 },
    defaultValue: 5.5,
    callback: (val: number) => { callbackValue = val; },
    onCancel: () => { cancelled = true; }
  });

  // Manual change detection
  appRef.tick();

  // Verify visible and positioned correctly (scaled by mock renderer: x*2, y*3)
  container = dom.window.document.querySelector('.inline-input-container') as HTMLDivElement;
  assert.ok(container, 'Container should now exist in DOM');
  assert.strictEqual(container.style.left, '200px', 'Correct left coordinate position');
  assert.strictEqual(container.style.top, '450px', 'Correct top coordinate position');

  // Verify input element defaultValue (formatted to preferredUnit 'mm' -> "5.50mm")
  const inputEl = dom.window.document.querySelector('input') as HTMLInputElement;
  assert.ok(inputEl, 'Input element should exist');
  assert.strictEqual(inputEl.value, '5.50mm', 'Prefilled default value formatted to unit');

  // 5. Submit valid entry (change input to "10mm" and click submit)
  inputEl.value = '10mm';
  const submitBtn = dom.window.document.querySelector('.action-btn') as HTMLButtonElement;
  submitBtn.dispatchEvent(new dom.window.MouseEvent('click'));

  // Trigger CD
  appRef.tick();

  // Verify callback and closure
  assert.strictEqual(callbackValue, 10, 'Callback received parsed value');
  assert.strictEqual(mockWorkspaceService.activeDimensionInputRequest(), null, 'Request cleared from state');
  container = dom.window.document.querySelector('.inline-input-container');
  assert.strictEqual(container, null, 'Container should be hidden after submission');

  // 6. Test invalid submit (e.g. entering alphabetical characters)
  mockWorkspaceService.activeDimensionInputRequest.set({
    pos: { x: 10, y: 10 },
    defaultValue: 5.5,
    callback: (val: number) => { callbackValue = val; },
    onCancel: () => {}
  });
  appRef.tick();
  
  const inputEl2 = dom.window.document.querySelector('input') as HTMLInputElement;
  inputEl2.value = 'invalidValue';
  
  const submitBtn2 = dom.window.document.querySelector('.action-btn') as HTMLButtonElement;
  submitBtn2.dispatchEvent(new dom.window.MouseEvent('click'));
  
  appRef.tick();
  assert.ok(alertMessage.includes('Invalid'), 'Alert was triggered with invalid unit error');

  // 7. Test Cancel
  mockWorkspaceService.activeDimensionInputRequest.set({
    pos: { x: 10, y: 10 },
    defaultValue: 5.5,
    callback: (val: number) => {},
    onCancel: () => { cancelled = true; }
  });
  appRef.tick();

  const cancelBtn = dom.window.document.querySelector('.action-btn.cancel') as HTMLButtonElement;
  cancelBtn.dispatchEvent(new dom.window.MouseEvent('click'));
  appRef.tick();

  assert.strictEqual(cancelled, true, 'Cancel callback was triggered');
  assert.strictEqual(mockWorkspaceService.activeDimensionInputRequest(), null, 'Request cleared after cancel');

  // Clean up
  appRef.destroy();
  delete (globalThis as any).alert;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
});
