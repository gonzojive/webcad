import assert from 'node:assert';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
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

test('rasterizeSVG initializes WASM and outputs a valid PNG matching golden reference', async () => {
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
    
    // Decode the base64 payload
    const base64Data = pngDataUrl.substring('data:image/png;base64,'.length);
    const pngBuffer = Buffer.from(base64Data, 'base64');

    const workspaceDir = process.env.BUILD_WORKSPACE_DIRECTORY;
    const testdataRelativePath = 'web/poc/ui/app/viewport/testdata/reference_layout.png';
    const regenerate = process.env.GENERATE_GOLDEN || process.env.REGENERATE || process.argv.includes('--regenerate');

    if (regenerate && workspaceDir) {
        // Generate/Overwrite the golden reference file on the host machine
        const outputPath = path.resolve(workspaceDir, testdataRelativePath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, pngBuffer);
        console.log(`[GOLDEN] Wrote new golden reference file to: ${outputPath}`);
    } else {
        // Compare the generated output bit-for-bit with the reference layout in runfiles
        const referenceUrl = (import.meta as any).resolve('./testdata/reference_layout.png');
        const referencePath = url.fileURLToPath(referenceUrl);
        
        assert.ok(fs.existsSync(referencePath), `Reference image must exist at: ${referencePath}`);
        const referenceBuffer = fs.readFileSync(referencePath);

        assert.strictEqual(
            pngBuffer.byteLength,
            referenceBuffer.byteLength,
            'Generated PNG byte size matches reference image exactly'
        );

        assert.deepStrictEqual(
            pngBuffer,
            referenceBuffer,
            'Generated PNG matches reference image bit-for-bit'
        );
    }
});
