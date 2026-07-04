import { Vector2D } from './vector.js';

export interface SnapOptions {
    pos: Vector2D;
    entitiesAtPos: (pos: Vector2D) => string | null;
    getPointById: (id: string) => Vector2D | undefined;
    startPoint?: Vector2D | null;
    sketchToScreen: (pos: Vector2D) => Vector2D;
    screenToSketch: (pos: Vector2D) => Vector2D;
    snapThresholdPx?: number;
}

/**
 * Snaps a 2D coordinate in sketch space to either an existing point or 
 * to a horizontal/vertical alignment relative to a start point (using screen space).
 */
export function snapPoint(options: SnapOptions): Vector2D {
    const {
        pos,
        entitiesAtPos,
        getPointById,
        startPoint,
        sketchToScreen,
        screenToSketch,
        snapThresholdPx = 10
    } = options;

    // 1. Snap to existing points
    const hoveredEntityId = entitiesAtPos(pos);
    if (hoveredEntityId) {
        const pt = getPointById(hoveredEntityId);
        if (pt) return pt;
    }

    // 2. Snap to horizontal / vertical alignment from startPoint
    if (startPoint) {
        const screenPos = sketchToScreen(pos);
        const screenStart = sketchToScreen(startPoint);
        
        let snappedScreenX = screenPos.x;
        let snappedScreenY = screenPos.y;
        
        if (Math.abs(screenPos.y - screenStart.y) < snapThresholdPx) {
            snappedScreenY = screenStart.y;
        }
        if (Math.abs(screenPos.x - screenStart.x) < snapThresholdPx) {
            snappedScreenX = screenStart.x;
        }
        
        if (snappedScreenX !== screenPos.x || snappedScreenY !== screenPos.y) {
            return screenToSketch({ x: snappedScreenX, y: snappedScreenY });
        }
    }

    return pos;
}

