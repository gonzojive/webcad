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

test('SketchStateModel add constraints works', () => {
    const model = new SketchStateModel();
    model.addPoint({ id: 'p1', x: 0, y: 0 });
    model.addPoint({ id: 'p2', x: 10, y: 10 });
    model.addLine({ id: 'l1', p1Id: 'p1', p2Id: 'p2' });

    model.addConstraint({
        id: 'c1',
        type: 'horizontal_distance',
        p1Id: 'p1',
        p2Id: 'p2',
        value: 50
    });

    model.addConstraint({
        id: 'c2',
        type: 'vertical_distance',
        p1Id: 'p1',
        p2Id: 'p2',
        value: 30
    });

    model.addConstraint({
        id: 'c3',
        type: 'point_line_distance',
        pointId: 'p1',
        lineId: 'l1',
        value: 5
    });

    const constraints = model.getConstraints();
    assert.strictEqual(constraints.length, 3);
    assert.strictEqual(constraints[0].type, 'horizontal_distance');
    assert.strictEqual(constraints[1].type, 'vertical_distance');
    assert.strictEqual(constraints[2].type, 'point_line_distance');
});
