declare const Konva: any;

/**
 * Exporter utility to capture a clean raster image (PNG) of the CAD canvas
 * with a solid white background, black lines, and hidden dimensions/annotations.
 */
export function exportToRasterImage(stage: any, gridLayer: any, mainLayer: any, workspace: any, redrawAllFn: () => void): string {
    if (!stage || !mainLayer) {
        return '';
    }

    // 1. Save original states
    const originalGridVisible = gridLayer.visible();
    gridLayer.visible(false);

    // 2. Clear main layer and draw clean black & white representation
    mainLayer.destroyChildren();

    const s = stage.scaleX();
    const invS = 1 / s;

    // Get current stage position to size background rectangle correctly
    const stageX = stage.x();
    const stageY = stage.y();
    const stageW = stage.width();
    const stageH = stage.height();

    // Add white background covering the full stage viewport
    const bg = new Konva.Rect({
        x: -stageX * invS,
        y: -stageY * invS,
        width: stageW * invS,
        height: stageH * invS,
        fill: '#ffffff'
    });
    mainLayer.add(bg);

    // Draw lines in pure black
    workspace.lines().forEach((l: any) => {
        const p1 = workspace.getPoint(l.p1Id);
        const p2 = workspace.getPoint(l.p2Id);
        if (!p1 || !p2) return;

        const lineShape = new Konva.Line({
            points: [p1.x, p1.y, p2.x, p2.y],
            stroke: '#000000',
            strokeWidth: 2 * invS
        });
        mainLayer.add(lineShape);
    });

    // Draw circles in pure black
    workspace.circles().forEach((c: any) => {
        const center = workspace.getPoint(c.centerId);
        if (!center) return;

        const circleShape = new Konva.Circle({
            x: center.x,
            y: center.y,
            radius: c.radius,
            stroke: '#000000',
            strokeWidth: 2 * invS
        });
        mainLayer.add(circleShape);
    });

    // Draw points in pure black
    workspace.points().forEach((p: any) => {
        const dot = new Konva.Circle({
            x: p.x,
            y: p.y,
            radius: 3 * invS,
            fill: '#000000',
            stroke: '#000000',
            strokeWidth: 1 * invS
        });
        mainLayer.add(dot);
    });

    // Draw everything to canvas synchronously
    mainLayer.draw();

    // 3. Export to base64 PNG data URL
    const dataUrl = stage.toDataURL({
        mimeType: 'image/png',
        quality: 1.0
    });

    // 4. Restore original state
    gridLayer.visible(originalGridVisible);
    if (gridLayer.visible()) {
        gridLayer.draw();
    }
    
    // Call redrawAllFn to restore active colors, selections, annotations, hover styles, etc.
    redrawAllFn();

    return dataUrl;
}
