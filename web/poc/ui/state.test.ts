import assert from 'node:assert';
import test from 'node:test';
import { SketchStateModel } from './state.js';

test('SketchStateModel addPoint works', () => {
    const model = new SketchStateModel();
    model.addPoint({ id: 'p1', x: 10, y: 20 });
    const points = model.getPoints();
    assert.strictEqual(points.length, 1);
    assert.strictEqual(points[0].id, 'p1');
    assert.strictEqual(points[0].x, 10);
    assert.strictEqual(points[0].y, 20);
});
