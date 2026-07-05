import { Tool, ToolContext } from './tool.js';
import { Vector2D, dist } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';

export class CircleTool implements Tool {
    readonly name = 'circle';
    private centerPointId: string | null = null;
    private sessionCreatedPointId: string | null = null;

    onActivate(context: ToolContext, renderer: IRenderer) {
        this.centerPointId = null;
        this.sessionCreatedPointId = null;
        renderer.clearCirclePreview();
    }

    onDeactivate(context: ToolContext, renderer: IRenderer) {
        this.cancel(context, renderer);
    }

    onMouseDown(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (event.button === 2) { // Right click cancels
            this.cancel(context, renderer);
            return;
        }

        const entityId = interaction.getEntityAt(pos);
        let clickedPointId: string | null = null;
        
        if (entityId && context.getPoint(entityId)) {
            clickedPointId = entityId;
        } else {
            clickedPointId = context.addPoint(pos);
            if (!this.centerPointId) {
                this.sessionCreatedPointId = clickedPointId;
            }
        }

        if (!this.centerPointId) {
            this.centerPointId = clickedPointId;
        } else {
            // Second click: finalize radius and create circle
            const centerPt = context.getPoint(this.centerPointId);
            if (centerPt) {
                const radius = dist(centerPt, pos);
                if (radius > 0.1) {
                    context.addCircle(this.centerPointId, radius);
                    context.solve();
                    context.commitHistory();
                }
            }
            this.centerPointId = null;
            this.sessionCreatedPointId = null;
            renderer.clearCirclePreview();
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
        if (this.centerPointId) {
            const centerPt = context.getPoint(this.centerPointId);
            if (centerPt) {
                const radius = dist(centerPt, pos);
                renderer.setCirclePreview(centerPt, radius);
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
        this.cancel(context, renderer);
    }

    private cancel(context: ToolContext, renderer: IRenderer) {
        if (this.centerPointId && this.sessionCreatedPointId === this.centerPointId) {
            context.deleteEntity(this.centerPointId, false);
        }
        this.centerPointId = null;
        this.sessionCreatedPointId = null;
        renderer.clearCirclePreview();
        renderer.requestRedraw();
    }
}
