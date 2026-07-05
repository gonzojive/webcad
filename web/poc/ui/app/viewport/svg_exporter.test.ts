import assert from 'node:assert';
import test from 'node:test';
import { GCSPoint, GCSLine, GCSCircle } from '../../../../../ts/gcsapi/dist/index.js';
import { exportToSVG, computeSketchBounds, ISketchWorkspace } from './svg_exporter.js';

class MockWorkspace implements ISketchWorkspace {
    points: GCSPoint[] = [];
    lines: GCSLine[] = [];
    circles: GCSCircle[] = [];

    getPoints() { return this.points; }
    getLines() { return this.lines; }
    getCircles() { return this.circles; }
    getPoint(id: string) { return this.points.find(p => p.id === id); }
}

test('computeSketchBounds with empty workspace', () => {
    const ws = new MockWorkspace();
    const bounds = computeSketchBounds(ws);
    assert.deepStrictEqual(bounds, { x: -100, y: -100, width: 200, height: 200 });
});

test('computeSketchBounds with points, lines, circles', () => {
    const ws = new MockWorkspace();
    ws.points = [
        { id: 'p1', x: 10, y: 20 },
        { id: 'p2', x: 50, y: 80 },
        { id: 'c1_center', x: 100, y: 150 }
    ];
    ws.lines = [
        { id: 'l1', p1Id: 'p1', p2Id: 'p2' }
    ];
    ws.circles = [
        { id: 'circ1', centerId: 'c1_center', radius: 30 }
    ];

    const bounds = computeSketchBounds(ws);
    // Bounds should include circle outer dimensions: 
    // center x = 100, r = 30 -> x bounds [70, 130]
    // center y = 150, r = 30 -> y bounds [120, 180]
    // Overall minX = min(10, 50, 100, 70) = 10
    // Overall maxX = max(10, 50, 100, 130) = 130
    // Overall minY = min(20, 80, 150, 120) = 20
    // Overall maxY = max(20, 80, 150, 180) = 180
    // w = 120, h = 160
    // padding X = max(12, 10) = 12 -> minX - 12 = -2, w + 24 = 144
    // padding Y = max(16, 10) = 16 -> minY - 16 = 4, h + 32 = 192
    assert.strictEqual(bounds.x, -2);
    assert.strictEqual(bounds.y, 4);
    assert.strictEqual(bounds.width, 144);
    assert.strictEqual(bounds.height, 192);
});

test('exportToSVG outputs valid XML with entities and custom options', () => {
    const ws = new MockWorkspace();
    ws.points = [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 10 }
    ];
    ws.lines = [
        { id: 'l1', p1Id: 'p1', p2Id: 'p2' }
    ];

    const svg = exportToSVG(ws, {
        width: 400,
        height: 300,
        viewBox: { x: -10, y: -10, width: 30, height: 30 },
        scale: 2
    });

    // Check SVG wrapper and viewbox
    assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="-10 -10 30 30">'));
    
    // Check white background rect
    assert.ok(svg.includes('<rect x="-10" y="-10" width="30" height="30" fill="#ffffff" />'));
    
    // Check line exists with stroke width scaled by inverse scale (invS = 1/2 = 0.5)
    // line: stroke-width = 2 * 0.5 = 1
    assert.ok(svg.includes('<line x1="0" y1="0" x2="10" y2="10" stroke="#000000" stroke-width="1" />'));

    // Check points exist (circle tag with r = 3 * 0.5 = 1.5, stroke-width = 1 * 0.5 = 0.5)
    assert.ok(svg.includes('<circle cx="0" cy="0" r="1.5" fill="#000000" stroke="#000000" stroke-width="0.5" />'));
    assert.ok(svg.includes('<circle cx="10" cy="10" r="1.5" fill="#000000" stroke="#000000" stroke-width="0.5" />'));
    
    // Check closing tag
    assert.ok(svg.endsWith('</svg>'));
});
