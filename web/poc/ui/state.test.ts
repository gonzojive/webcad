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

test('SketchStateModel generateNextId works sequentially', () => {
    const model = new SketchStateModel();
    assert.strictEqual(model.generateNextId('P'), 'P1');
    model.addPoint({ id: 'P1', x: 0, y: 0 });
    assert.strictEqual(model.generateNextId('P'), 'P2');
    model.addPoint({ id: 'P3', x: 10, y: 10 });
    assert.strictEqual(model.generateNextId('P'), 'P4');
});

test('SketchStateModel makeUniqueConstraintId avoids name clashes', () => {
    const model = new SketchStateModel();
    const base = 'Distance_P1_P2';
    assert.strictEqual(model.makeUniqueConstraintId(base), base);
    model.addConstraint({
        id: base,
        type: 'distance',
        p1Id: 'P1',
        p2Id: 'P2',
        value: 10
    });
    assert.strictEqual(model.makeUniqueConstraintId(base), 'Distance_P1_P2_1');
    model.addConstraint({
        id: 'Distance_P1_P2_1',
        type: 'distance',
        p1Id: 'P1',
        p2Id: 'P2',
        value: 20
    });
    assert.strictEqual(model.makeUniqueConstraintId(base), 'Distance_P1_P2_2');
});
