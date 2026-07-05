import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { GCSBridge } from '../../web/poc/model/gcs_bridge.js';
import { createEmptySketch, SketchModel } from '../../web/poc/model/sketch.js';
import { exportToSVG, ISketchWorkspace } from '../../web/poc/ui/app/viewport/svg_exporter.js';
import { rasterizeSVG } from '../../web/poc/ui/app/viewport/png_rasterizer.js';

// Setup environment and load the Go WASM solver in Node.js
async function initNodeBridge(): Promise<GCSBridge> {
    // 1. Load the Go WASM execution environment globally
    const wasmExecUrl = '../../web/poc/ui/wasm_exec.js';
    // @ts-ignore
    await import(wasmExecUrl);

    // 2. Resolve the compiled wasm_solver.wasm file URL
    const solverWasmUrl = (import.meta as any).resolve('../../web/poc/ui/wasm_solver.wasm');

    // 3. Configure a simple fetch mock using Node's native Response API to read local files
    globalThis.fetch = async (fileUrl: any) => {
        const buffer = fs.readFileSync(url.fileURLToPath(fileUrl));
        return new Response(buffer, { headers: { 'content-type': 'application/wasm' } });
    };

    // 4. Instantiate and initialize the GCS solver bridge
    const bridge = new GCSBridge();
    await bridge.init(solverWasmUrl);
    return bridge;
}

// Helper to wrap a SketchModel to match the exporter's ISketchWorkspace interface
function wrapSketch(sketch: SketchModel): ISketchWorkspace {
    return {
        getPoints: () => sketch.points,
        getLines: () => sketch.lines,
        getCircles: () => sketch.circles,
        getPoint: (id) => sketch.points.find(p => p.id === id)
    };
}

async function main() {
    // Parse optional command line flags (--svg <path>, --png <path>)
    const svgArgIndex = process.argv.indexOf('--svg');
    const pngArgIndex = process.argv.indexOf('--png');
    const svgPath = svgArgIndex !== -1 ? process.argv[svgArgIndex + 1] : undefined;
    const pngPath = pngArgIndex !== -1 ? process.argv[pngArgIndex + 1] : undefined;

    console.log('Initializing GCS Solver Bridge...');
    const bridge = await initNodeBridge();

    // 1. Setup a real SketchModel with shapes and a distance constraint
    // P1 fixed at (10, 20)
    // P2 initially at (20, 20)
    // Constraint: Distance between P1 and P2 must be exactly 150
    console.log('Setting up sketch state and distance constraint...');
    const sketch = createEmptySketch();
    sketch.points.push(
        { id: 'P1', x: 10, y: 20, fixed: true },
        { id: 'P2', x: 20, y: 20 }
    );
    sketch.lines.push({ id: 'L1', p1Id: 'P1', p2Id: 'P2' });
    sketch.constraints.push({ id: 'C1', type: 'distance', p1Id: 'P1', p2Id: 'P2', value: 150 });

    // 2. Solve the sketch layout constraints
    console.log('Invoking GCS Solver...');
    const result = bridge.solve(sketch);
    if (!result.success) {
        throw new Error(`Solve failed: ${result.error}`);
    }

    const solvedSketch = result.sketch;
    console.log('Solve succeeded! Point coordinates updated:');
    solvedSketch.points.forEach(p => {
        console.log(` - ${p.id}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    });

    // 3. Export GCS-solved sketch to SVG
    console.log('Exporting GCS-solved sketch to SVG...');
    const svgString = exportToSVG(wrapSketch(solvedSketch));

    if (svgPath) {
        const resolvedSvgPath = resolvePath(svgPath);
        fs.writeFileSync(resolvedSvgPath, svgString);
        console.log(`Successfully wrote SVG markup to: ${resolvedSvgPath}`);
    } else {
        console.log('Generated SVG content:\n', svgString);
    }

    if (pngPath) {
        console.log('Rasterizing SVG to PNG via resvg-wasm...');
        const pngDataUrl = await rasterizeSVG(svgString);
        const base64Data = pngDataUrl.replace(/^data:image\/png;base64,/, '');
        const resolvedPngPath = resolvePath(pngPath);
        fs.writeFileSync(resolvedPngPath, Buffer.from(base64Data, 'base64'));
        console.log(`Successfully wrote PNG image to: ${resolvedPngPath}`);
    }

    if (!svgPath && !pngPath) {
        console.log('\nTip: Run with "--svg <path>" or "--png <path>" arguments to save outputs.');
    }
}

/**
 * Resolves output paths relative to the invoking workspace directory when run via Bazel.
 */
function resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    const baseDir = process.env.BUILD_WORKSPACE_DIRECTORY || process.cwd();
    return path.resolve(baseDir, filePath);
}

main().catch(err => {
    console.error('Error running example:', err);
    process.exit(1);
});
