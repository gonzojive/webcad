import { Tool, ToolContext } from './tool.js';
import { Vector2D } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';

export class SelectTool implements Tool {
    readonly name = 'select';
    private draggedPointId: string | null = null;
    private hasDragged = false;

    onDeactivate(context: ToolContext, renderer: IRenderer) {
        context.setHoveredEntityId(null);
        context.setHoveredConstraintId(null);
    }

    onMouseDown(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        const entityId = interaction.getEntityAt(pos);
        
        if (entityId) {
            const isCtrl = event.ctrlKey || event.metaKey;
            let selected = context.getSelectedEntityIds();
            
            if (isCtrl) {
                if (selected.includes(entityId)) {
                    context.setSelectedEntityIds(selected.filter(id => id !== entityId));
                } else {
                    context.setSelectedEntityIds([...selected, entityId]);
                }
            } else {
                if (!selected.includes(entityId)) {
                    context.setSelectedEntityIds([entityId]);
                }
            }

            // Check if the entity is a point, so we can drag it
            const p = context.getPoint(entityId);
            if (p) {
                this.draggedPointId = entityId;
                this.hasDragged = false;
            }
        } else {
            // Clicked empty space
            context.setSelectedEntityIds([]);
            this.draggedPointId = null;
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
        if (this.draggedPointId) {
            const p = context.getPoint(this.draggedPointId);
            if (p) {
                context.updatePointPosition(this.draggedPointId, pos);
                context.solve(this.draggedPointId);
                this.hasDragged = true;
                renderer.requestRedraw();
            }
        } else {
            // Hover logic
            const entityId = interaction.getEntityAt(pos);
            const constraintId = interaction.getConstraintAt(pos);
            
            context.setHoveredEntityId(entityId);
            context.setHoveredConstraintId(constraintId);
            renderer.requestRedraw();
        }
    }

    onMouseUp(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (this.draggedPointId) {
            if (this.hasDragged) {
                context.commitHistory();
            }
            this.draggedPointId = null;
        }
    }
}
