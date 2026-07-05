import { NodeWorkspace } from '../../web/poc/ui/app/viewport/node_workspace.js';
import { exportToSVG } from '../../web/poc/ui/app/viewport/svg_exporter.js';
import { rasterizeSVG } from '../../web/poc/ui/app/viewport/png_rasterizer.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    // Parse optional command line flags (--svg <path>, --png <path>)
    const svgArgIndex = process.argv.indexOf('--svg');
    const pngArgIndex = process.argv.indexOf('--png');
    const svgPath = svgArgIndex !== -1 ? process.argv[svgArgIndex + 1] : undefined;
    const pngPath = pngArgIndex !== -1 ? process.argv[pngArgIndex + 1] : undefined;

    console.log('Initializing GCS Solver Workspace...');
    const workspace = new NodeWorkspace();
    await workspace.init();

    // 1. Setup a GCS-solved sketch workspace:
    // P1 fixed at (10, 20)
    // P2 initially at (20, 20)
    // Constraint: Distance between P1 and P2 must be exactly 150
    console.log('Setting up sketch shapes and distance constraint...');
    const p1Id = workspace.addPoint({ x: 10, y: 20 }, true); // fixed = true
    const p2Id = workspace.addPoint({ x: 20, y: 20 });
    workspace.addLine(p1Id, p2Id);
    workspace.addConstraint({ type: 'distance', p1Id, p2Id, value: 150 });

    // 2. Solve the sketch constraints
    console.log('Invoking GCS Solver...');
    const solved = workspace.solve();
    if (!solved) {
        throw new Error('Solve failed');
    }

    console.log('Solve succeeded! Point coordinates updated:');
    workspace.getPoints().forEach(p => {
        console.log(` - ${p.id}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    });

    // 3. Export GCS-solved sketch to SVG
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
