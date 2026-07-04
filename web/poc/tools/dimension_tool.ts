import { Tool, ToolContext } from './tool.js';
import { Vector2D, dist } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';
import { projectPointOntoLine } from '../geometry/project.js';
import { GCSConstraint } from '../../../ts/gcsapi/dist/index.js';

function getImpliedDimensionType(
    p1: Vector2D,
    p2: Vector2D,
    mouse: Vector2D
): 'distance' | 'horizontalDistance' | 'verticalDistance' {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) return 'distance';

    const mx = mouse.x - cx;
    const my = mouse.y - cy;

    const nx = -dy / segLen;
    const ny = dx / segLen;

    const dotPerp = mx * nx + my * ny;
    const dotSeg = (mx * dx + my * dy) / segLen;

    if (Math.abs(dotSeg) < Math.abs(dotPerp) * 0.414) {
        return 'distance';
    }

    if (Math.abs(my) > Math.abs(mx)) {
        return 'horizontalDistance';
    } else {
        return 'verticalDistance';
    }
}

export class DimensionTool implements Tool {
    readonly name = 'dimension';
    
    private firstEntityId: string | null = null;
    private placingDimension: {
        type: 'distance' | 'pointLineDistance';
        entityIds: string[];
    } | null = null;
    private currentPreviewType: 'distance' | 'horizontalDistance' | 'verticalDistance' = 'distance';
    private waitingForInput = false;

    onActivate(context: ToolContext, renderer: IRenderer) {
        this.resetState(renderer);
    }

    onDeactivate(context: ToolContext, renderer: IRenderer) {
        this.resetState(renderer);
    }

    onMouseDown(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (event.button === 2) {
            this.resetState(renderer);
            return;
        }

        if (this.waitingForInput) {
            return;
        }

        const clickedEntityId = interaction.getEntityAt(pos);

        if (this.placingDimension) {
            // Clicked empty space to place the dimension constraint
            if (!clickedEntityId) {
                this.handlePlacementClick(pos, context, renderer);
            }
        } else {
            // First click on entity or second click on entity
            this.handleSelectionClick(clickedEntityId, context);
        }
        
        renderer.requestRedraw();
    }

    private handleSelectionClick(clickedEntityId: string | null, context: ToolContext) {
        if (clickedEntityId) {
            if (this.firstEntityId === null) {
                this.firstEntityId = clickedEntityId;
            } else {
                const secondId = clickedEntityId;
                const firstId = this.firstEntityId;
                
                if (firstId !== secondId) {
                    const p1 = context.getPoint(firstId);
                    const p2 = context.getPoint(secondId);
                    const l1 = context.getLine(firstId);
                    const l2 = context.getLine(secondId);
                    
                    if (p1 && p2) {
                        // Point to Point
                        this.placingDimension = {
                            type: 'distance',
                            entityIds: [firstId, secondId]
                        };
                        this.firstEntityId = null;
                    } else if ((p1 && l2) || (p2 && l1)) {
                        // Point to Line
                        const ptId = p1 ? firstId : secondId;
                        const lnId = l1 ? firstId : secondId;
                        this.placingDimension = {
                            type: 'pointLineDistance',
                            entityIds: [ptId, lnId]
                        };
                        this.firstEntityId = null;
                    } else {
                        // Not supported/ignored
                        this.firstEntityId = null;
                    }
                }
            }
        } else {
            // Clicked empty space before placing, reset
            this.firstEntityId = null;
        }
    }

    private handlePlacementClick(pos: Vector2D, context: ToolContext, renderer: IRenderer) {
        if (!this.placingDimension) return;
        const { type, entityIds } = this.placingDimension;
        const defaultValue = this.calculateDefaultValue(context, type, entityIds);

        // Request dimension value input
        this.waitingForInput = true;
        context.requestDimensionInput(
            pos,
            defaultValue,
            (value) => {
                this.applyDimensionConstraint(context, type, entityIds, value);
                context.solve();
                context.commitHistory();
                this.resetState(renderer);
            },
            () => {
                this.resetState(renderer);
            }
        );
    }

    private calculateDefaultValue(
        context: ToolContext,
        type: 'distance' | 'pointLineDistance',
        entityIds: string[]
    ): number {
        if (type === 'pointLineDistance') {
            const p = context.getPoint(entityIds[0]);
            const l = context.getLine(entityIds[1]);
            if (p && l) {
                const lp1 = context.getPoint(l.p1Id);
                const lp2 = context.getPoint(l.p2Id);
                if (lp1 && lp2) {
                    const proj = projectPointOntoLine(p, lp1, lp2);
                    return dist(p, proj);
                }
            }
        } else {
            const p1 = context.getPoint(entityIds[0]);
            const p2 = context.getPoint(entityIds[1]);
            if (p1 && p2) {
                return this.currentPreviewType === 'horizontalDistance' ? Math.abs(p2.x - p1.x)
                    : this.currentPreviewType === 'verticalDistance' ? Math.abs(p2.y - p1.y)
                    : dist(p1, p2);
            }
        }
        return 0;
    }

    private applyDimensionConstraint(
        context: ToolContext,
        type: 'distance' | 'pointLineDistance',
        entityIds: string[],
        value: number
    ) {
        let constraint: GCSConstraint;
        
        if (type === 'pointLineDistance') {
            const cId = `PointLineDist_${entityIds[0]}_${entityIds[1]}`;
            constraint = {
                id: cId,
                type: 'pointLineDistance',
                pointId: entityIds[0],
                lineId: entityIds[1],
                value
            };
        } else {
            const baseType = this.currentPreviewType;
            const prefix = baseType === 'distance' ? 'Distance' : baseType === 'horizontalDistance' ? 'HorizDist' : 'VertDist';
            const cId = `${prefix}_${entityIds[0]}_${entityIds[1]}`;
            
            constraint = {
                id: cId,
                type: baseType,
                p1Id: entityIds[0],
                p2Id: entityIds[1],
                value
            } as any; // Cast safely as types align
        }

        context.addConstraint(constraint);
    }

    onMouseMove(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        if (this.waitingForInput) return;

        if (this.placingDimension) {
            const { type, entityIds } = this.placingDimension;
            if (type === 'pointLineDistance') {
                renderer.setDimensionPreview('pointLineDistance', entityIds, pos);
            } else {
                const p1 = context.getPoint(entityIds[0]);
                const p2 = context.getPoint(entityIds[1]);
                if (p1 && p2) {
                    const implied = getImpliedDimensionType(p1, p2, pos);
                    this.currentPreviewType = implied;
                    renderer.setDimensionPreview(implied, entityIds, pos);
                }
            }
            renderer.requestRedraw();
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
        this.resetState(renderer);
    }

    private resetState(renderer: IRenderer) {
        this.firstEntityId = null;
        this.placingDimension = null;
        this.waitingForInput = false;
        renderer.clearDimensionPreview();
        renderer.requestRedraw();
    }
}
