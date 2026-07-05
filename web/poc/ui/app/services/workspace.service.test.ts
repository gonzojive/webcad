import 'zone.js';
import '@angular/compiler';
import assert from 'node:assert';
import test from 'node:test';
import { WorkspaceService } from './workspace.service.js';
import { GCSBridge } from '../../../model/gcs_bridge.js';
import { SketchStore } from '../../../model/store.js';

// 1. Mock GCSBridge to avoid WebAssembly network loading
GCSBridge.prototype.init = async function() {
    (this as any).isInitialized = true;
};
GCSBridge.prototype.solve = function(sketch) {
    return { success: true, sketch };
};

// 2. Mock SketchStore to avoid IndexedDB dependencies
SketchStore.prototype.save = async function() {};
SketchStore.prototype.load = async function() {
    return null;
};

// Helper to wait for asynchronous initialization to complete
const waitInit = () => new Promise(resolve => setTimeout(resolve, 10));

test('WorkspaceService.transaction commits changes on success', async () => {
    const service = new WorkspaceService();
    await waitInit();

    // Initial state: empty sketch, cannot undo
    assert.strictEqual(service.points().length, 0);
    assert.strictEqual(service.canUndo(), false);

    // Run transaction
    const result = service.transaction(() => {
        const p1Id = service.addPoint({ x: 10, y: 20 });
        const p2Id = service.addPoint({ x: 30, y: 40 });
        service.addLine(p1Id, p2Id);
        return 'completed';
    });

    // Verify callback return value
    assert.strictEqual(result, 'completed');

    // Verify entities were created
    assert.strictEqual(service.points().length, 2);
    assert.strictEqual(service.lines().length, 1);

    // Verify history was committed
    assert.strictEqual(service.canUndo(), true);
});

test('WorkspaceService.transaction rolls back changes on error', async () => {
    const service = new WorkspaceService();
    await waitInit();

    // Initial state: empty sketch, cannot undo
    assert.strictEqual(service.points().length, 0);
    assert.strictEqual(service.canUndo(), false);

    // Run transaction that throws an error
    let thrownError: any = null;
    try {
        service.transaction(() => {
            service.addPoint({ x: 10, y: 20 });
            assert.strictEqual(service.points().length, 1); // Point added temporarily
            throw new Error('Test abort');
        });
    } catch (e) {
        thrownError = e;
    }

    // Verify error was propagated
    assert.ok(thrownError);
    assert.strictEqual(thrownError.message, 'Test abort');

    // Verify state was rolled back (point was discarded)
    assert.strictEqual(service.points().length, 0);

    // Verify history was NOT committed
    assert.strictEqual(service.canUndo(), false);
});
