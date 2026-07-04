import { Vector2D } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../gcsapi/gcsapi.js';

export interface ToolContext {
    addPoint(pos: Vector2D): string;
    updatePointPosition(id: string, pos: Vector2D): void;
    addLine(p1Id: string, p2Id: string): string;
    addCircle(centerId: string, radius: number): string;
    addConstraint(constraint: GCSConstraint): string;
    deleteEntity(id: string, commit?: boolean): void;
    
    getPoints(): GCSPoint[];
    getLines(): GCSLine[];
    getCircles(): GCSCircle[];
    getConstraints(): GCSConstraint[];
    
    getPoint(id: string): GCSPoint | undefined;
    getLine(id: string): GCSLine | undefined;
    getCircle(id: string): GCSCircle | undefined;

    getSelectedEntityIds(): string[];
    setSelectedEntityIds(ids: string[]): void;

    setHoveredEntityId(id: string | null): void;
    setHoveredConstraintId(id: string | null): void;

    generateNextId(prefix: string): string;
    solve(draggedPointId?: string | null): boolean;
    commitHistory(): void;
    
    // Request dimension input inline box
    requestDimensionInput(
        pos: Vector2D,
        defaultValue: number,
        callback: (val: number) => void,
        onCancel?: () => void
    ): void;
}



export interface Tool {
    name: string;
    onActivate?(context: ToolContext, renderer: IRenderer): void;
    onDeactivate?(context: ToolContext, renderer: IRenderer): void;
    
    onMouseDown(pos: Vector2D, event: MouseEvent, context: ToolContext, renderer: IRenderer, interaction: IInteractionProvider): void;
    onMouseMove(pos: Vector2D, event: MouseEvent, context: ToolContext, renderer: IRenderer, interaction: IInteractionProvider): void;
    onMouseUp(pos: Vector2D, event: MouseEvent, context: ToolContext, renderer: IRenderer, interaction: IInteractionProvider): void;
    onCancel?(context: ToolContext, renderer: IRenderer): void;
}
