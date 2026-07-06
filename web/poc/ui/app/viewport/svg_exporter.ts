import { GCSPoint, GCSLine, GCSCircle } from '../../../../../ts/gcsapi/dist/index.js';
import { ISketchWorkspace } from '../../../model/sketch.js';
export { ISketchWorkspace };

/**
 * Viewport configuration options for the SVG exporter.
 */
export interface SVGViewportOptions {
    /** The width of the output SVG in pixels. */
    width?: number;
    /** The height of the output SVG in pixels. */
    height?: number;
    /** Bounding box of the visible area in sketch coordinates. */
    viewBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Scale factor (zoom level) of the viewport. */
    scale?: number;
}

/**
 * Computes the bounding box of the active sketch geometry.
 *
 * If no geometry is present, returns a default bounding box centered around the origin.
 * Adds a small padding percentage around the geometry to ensure all points and circles
 * are fully visible within the boundary.
 */
export function computeSketchBounds(workspace: ISketchWorkspace): { x: number; y: number; width: number; height: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const updateBounds = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const points = workspace.getPoints();
    points.forEach((p) => {
        updateBounds(p.x, p.y);
    });

    const circles = workspace.getCircles();
    circles.forEach((c) => {
        const center = workspace.getPoint(c.centerId);
        if (center) {
            updateBounds(center.x - c.radius, center.y - c.radius);
            updateBounds(center.x + c.radius, center.y + c.radius);
        }
    });

    if (minX === Infinity || minY === Infinity) {
        return { x: -100, y: -100, width: 200, height: 200 };
    }

    let w = maxX - minX;
    let h = maxY - minY;
    if (w === 0) w = 20;
    if (h === 0) h = 20;

    // Add a 10% padding (minimum 10 units)
    const padX = Math.max(w * 0.1, 10);
    const padY = Math.max(h * 0.1, 10);

    return {
        x: minX - padX,
        y: minY - padY,
        width: w + 2 * padX,
        height: h + 2 * padY
    };
}

/**
 * Serializes the sketch geometry (points, lines, circles) into an XML SVG string.
 *
 * This function is pure TypeScript and does not depend on the browser DOM or HTML5 Canvas APIs,
 * allowing it to execute hermetically within unit test runners like JSDOM.
 */
export function exportToSVG(workspace: ISketchWorkspace, options: SVGViewportOptions = {}): string {
    const viewBox = options.viewBox || computeSketchBounds(workspace);
    const width = options.width || 800;
    const height = options.height || 600;
    const scale = options.scale || 1;
    const invS = 1 / scale;

    const svgLines: string[] = [];
    svgLines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}">`);
    
    // Add white background covering the full viewBox
    svgLines.push(`  <rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#ffffff" />`);

    // Draw lines in pure black
    workspace.getLines().forEach((l) => {
        const p1 = workspace.getPoint(l.p1Id);
        const p2 = workspace.getPoint(l.p2Id);
        if (!p1 || !p2) return;
        svgLines.push(`  <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#000000" stroke-width="${2 * invS}" />`);
    });

    // Draw circles in pure black
    workspace.getCircles().forEach((c) => {
        const center = workspace.getPoint(c.centerId);
        if (!center) return;
        svgLines.push(`  <circle cx="${center.x}" cy="${center.y}" r="${c.radius}" stroke="#000000" stroke-width="${2 * invS}" fill="none" />`);
    });

    // Draw points in pure black
    workspace.getPoints().forEach((p) => {
        svgLines.push(`  <circle cx="${p.x}" cy="${p.y}" r="${3 * invS}" fill="#000000" stroke="#000000" stroke-width="${1 * invS}" />`);
    });

    svgLines.push(`</svg>`);
    return svgLines.join('\n');
}
