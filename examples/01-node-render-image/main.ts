import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { GCSSolver, GCSSketchState, GCSPoint } from '../../ts/gcsapi/dist/index.js';
import { exportToSVG, ISketchWorkspace } from '../../web/poc/ui/app/viewport/svg_exporter.js';
import { rasterizeSVG } from '../../web/poc/ui/app/viewport/png_rasterizer.js';

// Setup environment and load the Go WASM solver in Node.js
async function initNodeSolver(): Promise<GCSSolver> {
    // 1. Load the Go WASM execution environment globally
    const wasmExecUrl = (import.meta as any).resolve('../../web/poc/ui/wasm_exec.js');
    // @ts-ignore
    await import(wasmExecUrl);

    // 2. Resolve the compiled wasm_solver.wasm file URL
    const solverWasmUrl = (import.meta as any).resolve('../../web/poc/ui/wasm_solver.wasm');

    // 3. Configure a simple fetch mock using Node's native Response API to read local files
    globalThis.fetch = async (fileUrl: any) => {
        const buffer = fs.readFileSync(url.fileURLToPath(fileUrl));
        return new Response(buffer, { headers: { 'content-type': 'application/wasm' } });
    };

    // 4. Instantiate and initialize the GCS solver
    const solver = new GCSSolver();
    await solver.initGoWasm(solverWasmUrl);
    return solver;
}

async function main() {
    // Parse optional command line flags (--svg <path>, --png <path>)
    const svgArgIndex = process.argv.indexOf('--svg');
    const pngArgIndex = process.argv.indexOf('--png');
    const svgPath = svgArgIndex !== -1 ? process.argv[svgArgIndex + 1] : undefined;
    const pngPath = pngArgIndex !== -1 ? process.argv[pngArgIndex + 1] : undefined;

    console.log('Initializing Go GCS Solver in Node.js...');
    const solver = await initNodeSolver();

    // 1. Define initial sketch state (before solve):
    // P1 fixed at (10, 20)
    // P2 initially at (20, 20)
    // Constraint: Distance between P1 and P2 must be exactly 150
    console.log('Setting up sketch state and distance constraint...');
    const state: GCSSketchState = {
        points: [
            { id: 'P1', x: 10, y: 20, fixed: true },
            { id: 'P2', x: 20, y: 20 }
        ],
        lines: [
            { id: 'L1', p1Id: 'P1', p2Id: 'P2' }
        ],
        circles: [],
        constraints: [
            { id: 'C1', type: 'distance', p1Id: 'P1', p2Id: 'P2', value: 150 }
        ]
    };

    // 2. Solve the sketch layout constraints
    console.log('Invoking GCS Solver...');
    const result = solver.solve(state);
    if (!result.success) {
        throw new Error(`Solve failed: ${result.error}`);
    }

    console.log('Solve succeeded! Point coordinates updated:');
    result.points.forEach((p: GCSPoint) => {
        console.log(` - ${p.id}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    });

    // 3. Wrap solved state in workspace interface for the exporter
    const workspace: ISketchWorkspace = {
        getPoints: () => result.points,
        getLines: () => state.lines,
        getCircles: () => state.circles,
        getPoint: (id: string) => result.points.find((p: GCSPoint) => p.id === id)
    };

    console.log('Exporting GCS-solved sketch to SVG...');
    const svgString = exportToSVG(workspace);

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
