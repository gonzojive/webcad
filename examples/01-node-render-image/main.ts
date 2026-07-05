import * as fs from 'fs';
import * as path from 'path';
import { exportToSVG, ISketchWorkspace } from '../../web/poc/ui/app/viewport/svg_exporter.js';
import { rasterizeSVG } from '../../web/poc/ui/app/viewport/png_rasterizer.js';

// 1. Setup a sketch workspace containing a line, a circle, and their points:
const workspace: ISketchWorkspace = {
    getPoints: () => [
        { id: 'p1', x: 10, y: 20 },
        { id: 'p2', x: 150, y: 120 },
        { id: 'c1_center', x: 100, y: 70 }
    ],
    getLines: () => [
        { id: 'l1', p1Id: 'p1', p2Id: 'p2' }
    ],
    getCircles: () => [
        { id: 'circ1', centerId: 'c1_center', radius: 40 }
    ],
    getPoint: (id: string) => {
        const pts = [
            { id: 'p1', x: 10, y: 20 },
            { id: 'p2', x: 150, y: 120 },
            { id: 'c1_center', x: 100, y: 70 }
        ];
        return pts.find(p => p.id === id);
    }
};

async function main() {
    console.log('Exporting sketch to SVG...');
    const svgString = exportToSVG(workspace);
    console.log('Generated SVG content:\n', svgString);

    console.log('Rasterizing SVG to PNG via resvg-wasm...');
    const pngDataUrl = await rasterizeSVG(svgString);
    console.log('Generated PNG Data URL length:', pngDataUrl.length);

    // Extract base64 payload and write to a physical PNG file
    const base64Data = pngDataUrl.replace(/^data:image\/png;base64,/, '');
    const outputDir = process.env.BUILD_WORKSPACE_DIRECTORY || process.cwd();
    const outputPath = path.join(outputDir, 'output.png');
    fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
    console.log(`Successfully wrote PNG image to: ${outputPath}`);
}

main().catch(err => {
    console.error('Error running example:', err);
    process.exit(1);
});
