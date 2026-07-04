import test from 'node:test';
import assert from 'node:assert';
import { SketchStateModel } from './state.js';

test('SketchStateModel addPoint', () => {
    const model = new SketchStateModel();
    assert.equal(model.getPoints().length, 0);
    
    const point = { id: 'p1', x: 10, y: 20 };
    model.addPoint(point);
    
    const points = model.getPoints();
    assert.equal(points.length, 1);
    assert.deepEqual(points[0], point);
});
