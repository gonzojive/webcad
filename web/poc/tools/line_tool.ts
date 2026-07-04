import { Tool, ToolContext } from './tool.js';
import { Vector2D, dist } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';
import { snapPoint } from '../geometry/snap.js';

export class LineTool implements Tool {
    readonly name = 'line';
    private startPointId: string | null = null;
    private sessionCreatedPointIds: string[] = [];

    onActivate(context: ToolContext, renderer: IRenderer) {
        this.startPointId = null;
        this.sessionCreatedPointIds = [];
        renderer.clearLinePreview();
    }

    onDeactivate(context: ToolContext, renderer: IRenderer) {
        this.cancelCurrentLine(context, renderer);
    }

    onMouseDown(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (event.button === 2) { // Right click cancels current line
            this.cancelCurrentLine(context, renderer);
            return;
        }

        const snappedPos = this.getSnappedPos(pos, context, interaction, renderer);
        const entityId = interaction.getEntityAt(snappedPos);
        let clickedPointId: string | null = null;
        
        if (entityId && context.getPoint(entityId)) {
            clickedPointId = entityId;
        } else {
            // Create a new point
            clickedPointId = context.addPoint(snappedPos);
            this.sessionCreatedPointIds.push(clickedPointId);
        }

        if (!this.startPointId) {
            // Start of new line
            this.startPointId = clickedPointId;
        } else {
            // End of line
            if (this.startPointId !== clickedPointId) {
                context.addLine(this.startPointId, clickedPointId);
                context.solve();
                context.commitHistory();
                
                // Chain line: make the end point the start of the next line
                this.startPointId = clickedPointId;
                // Clear tracked points because they are now committed
                this.sessionCreatedPointIds = [];
            }
        }
        
        renderer.requestRedraw();
    }

    onMouseMove(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (this.startPointId) {
            const startPoint = context.getPoint(this.startPointId);
            if (startPoint) {
                const snappedPos = this.getSnappedPos(pos, context, interaction, renderer);
                renderer.setLinePreview(startPoint, snappedPos);
                renderer.requestRedraw();
            }
        }
    }

    onMouseUp(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {}

    onCancel(context: ToolContext, renderer: IRenderer) {
        this.cancelCurrentLine(context, renderer);
    }

    private cancelCurrentLine(context: ToolContext, renderer: IRenderer) {
        this.startPointId = null;
        renderer.clearLinePreview();
        
        // Clean up uncommitted points
        this.sessionCreatedPointIds.forEach(id => {
            context.deleteEntity(id, false); // delete without history commit
        });
        this.sessionCreatedPointIds = [];
        
        renderer.requestRedraw();
    }

    private getSnappedPos(
        pos: Vector2D,
        context: ToolContext,
        interaction: IInteractionProvider,
        renderer: IRenderer
    ): Vector2D {
        const startPt = this.startPointId ? (context.getPoint(this.startPointId) ?? null) : null;
        return snapPoint({
            pos,
            entitiesAtPos: p => interaction.getEntityAt(p),
            getPointById: id => context.getPoint(id),
            startPoint: startPt,
            sketchToScreen: p => renderer.sketchToScreen(p),
            screenToSketch: p => renderer.screenToSketch(p)
        });
    }
}
