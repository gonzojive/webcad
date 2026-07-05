import assert from 'node:assert';
import test from 'node:test';
import { GCSPoint, GCSLine } from '../../../../../ts/gcsapi/dist/index.js';
import { exportToSVG, ISketchWorkspace } from './svg_exporter.js';
import { rasterizeSVG } from './png_rasterizer.js';

class MockWorkspace implements ISketchWorkspace {
    points: GCSPoint[] = [];
    lines: GCSLine[] = [];
    circles: any[] = [];

    getPoints() { return this.points; }
    getLines() { return this.lines; }
    getCircles() { return this.circles; }
    getPoint(id: string) { return this.points.find(p => p.id === id); }
}

test('rasterizeSVG initializes WASM and outputs a valid PNG data URL', async () => {
    const ws = new MockWorkspace();
    ws.points = [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 100, y: 100 }
    ];
    ws.lines = [
        { id: 'l1', p1Id: 'p1', p2Id: 'p2' }
    ];

    const svg = exportToSVG(ws, {
        width: 100,
        height: 100,
        viewBox: { x: -10, y: -10, width: 120, height: 120 }
    });

    // Rasterize SVG -> PNG via WASM
    const pngDataUrl = await rasterizeSVG(svg);
    
    // 1. Verify it is a valid data URL
    assert.ok(pngDataUrl.startsWith('data:image/png;base64,'), 'Should return a PNG base64 data URL');

    // 2. Decode the base64 payload
    const base64Data = pngDataUrl.substring('data:image/png;base64,'.length);
    const pngBuffer = Buffer.from(base64Data, 'base64');

    // 3. Verify the PNG 8-byte file signature
    // PNG signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    const expectedSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < expectedSignature.length; i++) {
        assert.strictEqual(pngBuffer[i], expectedSignature[i], `Byte ${i} should match PNG signature`);
    }

    assert.ok(pngBuffer.byteLength > 100, 'PNG buffer should contain actual file data');
});
