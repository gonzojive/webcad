import { Vector2D } from '../../geometry/vector.js';

export interface IInteractionProvider {
    getMousePosition(): Vector2D;
    getEntityAt(pos: Vector2D): string | null;
    getConstraintAt(pos: Vector2D): string | null;
}


export interface IRenderer {
    setLinePreview(p1: Vector2D, p2: Vector2D): void;
    clearLinePreview(): void;

    setCirclePreview(center: Vector2D, radius: number): void;
    clearCirclePreview(): void;

    setPointPreview(pos: Vector2D): void;
    clearPointPreview(): void;

    setDimensionPreview(
        type: 'distance' | 'horizontalDistance' | 'verticalDistance' | 'pointLineDistance',
        entityIds: string[],
        pos: Vector2D
    ): void;
    clearDimensionPreview(): void;

    requestRedraw(): void;

    sketchToScreen(pos: Vector2D): Vector2D;
    screenToSketch(pos: Vector2D): Vector2D;
    isSketchPointInViewport(pos: Vector2D): boolean;
    getViewportSketchBounds(): { min: Vector2D; max: Vector2D };
    toRasterImage(): string;
    toSVG(options?: {
        width?: number;
        height?: number;
        viewBox?: { x: number; y: number; width: number; height: number };
        scale?: number;
    }): string;
}
