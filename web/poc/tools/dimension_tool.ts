import { Tool, ToolContext } from './tool.js';
import { Vector2D, dist } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';
import { projectPointOntoLine } from '../geometry/project.js';
import { GCSConstraint } from '../gcsapi/gcsapi.js';

function getImpliedDimensionType(
    p1: Vector2D,
    p2: Vector2D,
    mouse: Vector2D
): 'distance' | 'horizontal_distance' | 'vertical_distance' {
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
        return 'horizontal_distance';
    } else {
        return 'vertical_distance';
    }
}

export class DimensionTool implements Tool {
    readonly name = 'dimension';
    
    private firstEntityId: string | null = null;
    private placingDimension: {
        type: 'distance' | 'point_line_distance';
        entityIds: string[];
    } | null = null;
    private currentPreviewType: 'distance' | 'horizontal_distance' | 'vertical_distance' = 'distance';
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
                const { type, entityIds } = this.placingDimension;
                let defaultValue = 0;
                
                if (type === 'point_line_distance') {
                    const p = context.getPoint(entityIds[0]);
                    const l = context.getLine(entityIds[1]);
                    if (p && l) {
                        const lp1 = context.getPoint(l.p1Id);
                        const lp2 = context.getPoint(l.p2Id);
                        if (lp1 && lp2) {
                            const proj = projectPointOntoLine(p, lp1, lp2);
                            defaultValue = dist(p, proj);
                        }
                    }
                } else {
                    const p1 = context.getPoint(entityIds[0]);
                    const p2 = context.getPoint(entityIds[1]);
                    if (p1 && p2) {
                        defaultValue = this.currentPreviewType === 'horizontal_distance' ? Math.abs(p2.x - p1.x)
                            : this.currentPreviewType === 'vertical_distance' ? Math.abs(p2.y - p1.y)
                            : dist(p1, p2);
                    }
                }

                // Request dimension value input
                this.waitingForInput = true;
                context.requestDimensionInput(
                    pos,
                    defaultValue,
                    (value) => {
                        let constraint: GCSConstraint;
                        
                        if (type === 'point_line_distance') {
                            const cId = `PointLineDist_${entityIds[0]}_${entityIds[1]}`;
                            constraint = {
                                id: cId,
                                type: 'point_line_distance',
                                pointId: entityIds[0],
                                lineId: entityIds[1],
                                value
                            };
                        } else {
                            const baseType = this.currentPreviewType;
                            const prefix = baseType === 'distance' ? 'Distance' : baseType === 'horizontal_distance' ? 'HorizDist' : 'VertDist';
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
                        context.solve();
                        context.commitHistory();
                        
                        this.resetState(renderer);
                    },
                    () => {
                        this.resetState(renderer);
                    }
                );
            }
        } else {
            // First click on entity or second click on entity
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
                                type: 'point_line_distance',
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
        
        renderer.requestRedraw();
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
            if (type === 'point_line_distance') {
                renderer.setDimensionPreview('point_line_distance', entityIds, pos);
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
