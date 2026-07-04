import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, effect } from '@angular/core';
import { WorkspaceService } from '../services/workspace.service.js';
import { ToolService } from '../services/tool.service.js';
import { IRenderer, IInteractionProvider } from '../../interfaces/viewport_interfaces.js';
import { Vector2D, dist } from '../../../geometry/vector.js';
import { projectPointOntoLine } from '../../../geometry/project.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint, GCSValueConstraint } from '../../../gcsapi/gcsapi.js';

declare const Konva: any;

@Component({
  selector: 'app-viewport',
  standalone: true,
  template: `<div #canvasContainer class="canvas-container" style="width: 100%; height: 100%;"></div>`,
  styles: [`
    .canvas-container {
      background-color: var(--canvas-bg);
      cursor: crosshair;
      outline: none;
      position: relative;
    }
  `]
})
export class ViewportComponent implements AfterViewInit, OnDestroy, IRenderer, IInteractionProvider {
    @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;

    readonly workspace = inject(WorkspaceService);
    private readonly toolService = inject(ToolService);

    private stage: any;
    private mainLayer: any;
    private gridLayer: any;
    private snapIndicator: any;

    private tempLinePreview: any = null;
    private tempCirclePreview: any = null;
    private tempPointPreview: any = null;
    private tempDimensionPreview: {
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance';
        entityIds: string[];
        mousePos: Vector2D;
    } | null = null;

    private draggedConstraintId: string | null = null;
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private stageStart = { x: 0, y: 0 };
    private resizeListener?: () => void;

    constructor() {
        // Redraw automatically when workspace model changes
        effect(() => {
            // Read signals to trigger effect dependencies
            this.workspace.points();
            this.workspace.lines();
            this.workspace.circles();
            this.workspace.constraints();
            this.workspace.selectedEntityIds();
            this.workspace.hoveredEntityId();
            this.workspace.hoveredConstraintId();
            
            if (this.stage) {
                this.redrawAll();
            }
        });
    }

    ngAfterViewInit() {
        this.toolService.registerViewport(this, this);
        const container = this.canvasContainer.nativeElement;
        
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth || 800,
            height: container.clientHeight || 600
        });

        this.gridLayer = new Konva.Layer();
        this.mainLayer = new Konva.Layer();
        this.stage.add(this.gridLayer);
        this.stage.add(this.mainLayer);

        this.snapIndicator = new Konva.Circle({
            radius: 8,
            stroke: 'rgba(239, 68, 68, 0.8)',
            strokeWidth: 1.5,
            fill: 'rgba(239, 68, 68, 0.2)',
            listening: false,
            visible: false
        });
        this.mainLayer.add(this.snapIndicator);

        this.setupViewportEvents();
        this.drawGrid();
        this.redrawAll();

        // Handle resize
        this.resizeListener = () => {
            if (this.stage && container) {
                this.stage.width(container.clientWidth);
                this.stage.height(container.clientHeight);
                this.drawGrid();
                this.redrawAll();
            }
        };
        window.addEventListener('resize', this.resizeListener);
    }

    ngOnDestroy() {
        this.toolService.registerViewport(null as any, null as any); // Unregister
        if (this.resizeListener) {
            window.removeEventListener('resize', this.resizeListener);
        }
        if (this.stage) {
            this.stage.destroy();
        }
    }

    // --- IRenderer Implementation ---

    setLinePreview(p1: Vector2D, p2: Vector2D) {
        if (!this.tempLinePreview) {
            this.tempLinePreview = new Konva.Line({
                stroke: 'rgba(59, 130, 246, 0.6)',
                strokeWidth: 2,
                dash: [5, 5],
                listening: false
            });
            this.mainLayer.add(this.tempLinePreview);
        }
        this.tempLinePreview.points([p1.x, p1.y, p2.x, p2.y]);
        this.tempLinePreview.visible(true);
    }

    clearLinePreview() {
        if (this.tempLinePreview) {
            this.tempLinePreview.visible(false);
        }
    }

    setCirclePreview(center: Vector2D, radius: number) {
        if (!this.tempCirclePreview) {
            this.tempCirclePreview = new Konva.Circle({
                stroke: 'rgba(59, 130, 246, 0.6)',
                strokeWidth: 2,
                dash: [5, 5],
                listening: false
            });
            this.mainLayer.add(this.tempCirclePreview);
        }
        this.tempCirclePreview.x(center.x);
        this.tempCirclePreview.y(center.y);
        this.tempCirclePreview.radius(radius);
        this.tempCirclePreview.visible(true);
    }

    clearCirclePreview() {
        if (this.tempCirclePreview) {
            this.tempCirclePreview.visible(false);
        }
    }

    setPointPreview(pos: Vector2D) {
        if (!this.tempPointPreview) {
            this.tempPointPreview = new Konva.Circle({
                radius: 5,
                fill: 'rgba(59, 130, 246, 0.7)',
                stroke: 'rgba(0,0,0,0.5)',
                strokeWidth: 1,
                listening: false
            });
            this.mainLayer.add(this.tempPointPreview);
        }
        this.tempPointPreview.x(pos.x);
        this.tempPointPreview.y(pos.y);
        this.tempPointPreview.visible(true);
    }

    clearPointPreview() {
        if (this.tempPointPreview) {
            this.tempPointPreview.visible(false);
        }
    }

    setDimensionPreview(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance',
        entityIds: string[],
        pos: Vector2D
    ) {
        this.tempDimensionPreview = { type, entityIds, mousePos: pos };
        this.redrawAll();
    }

    clearDimensionPreview() {
        if (this.tempDimensionPreview) {
            this.tempDimensionPreview = null;
            this.redrawAll();
        }
    }

    requestRedraw() {
        this.redrawAll();
    }

    sketchToScreen(pos: Vector2D): Vector2D {
        const transform = this.stage.getAbsoluteTransform();
        return transform.point(pos);
    }

    screenToSketch(pos: Vector2D): Vector2D {
        const transform = this.stage.getAbsoluteTransform().copy().invert();
        return transform.point(pos);
    }

    // --- IInteractionProvider Implementation ---

    getMousePosition(): Vector2D {
        const ptr = this.stage.getPointerPosition();
        return ptr ? this.screenToSketch(ptr) : { x: 0, y: 0 };
    }

    // Handled directly inside setupViewportEvents to bind toolService
    onMouseDown(callback: (pos: Vector2D, event: MouseEvent) => void) {}
    onMouseMove(callback: (pos: Vector2D, event: MouseEvent) => void) {}
    onMouseUp(callback: (pos: Vector2D, event: MouseEvent) => void) {}

    getEntityAt(pos: Vector2D): string | null {
        const screenPos = this.sketchToScreen(pos);
        // Temporarily hide snap indicator & previews for clean intersection
        const wasIndicatorVisible = this.snapIndicator.visible();
        this.snapIndicator.visible(false);
        
        const shape = this.stage.getIntersection(screenPos);
        this.snapIndicator.visible(wasIndicatorVisible);

        if (!shape) return null;
        
        let cur = shape;
        while (cur) {
            const id = cur.id();
            if (id && (this.workspace.getPoint(id) || this.workspace.getLine(id) || this.workspace.getCircle(id))) {
                return id;
            }
            cur = cur.getParent();
        }
        return null;
    }

    getConstraintAt(pos: Vector2D): string | null {
        const screenPos = this.sketchToScreen(pos);
        const shape = this.stage.getIntersection(screenPos);
        if (!shape) return null;
        
        let cur = shape;
        while (cur) {
            const id = cur.id();
            if (id && this.workspace.getConstraint(id)) {
                return id;
            }
            cur = cur.getParent();
        }
        return null;
    }

    // --- Viewport Event Setup ---

    private getStagePointerPosition(): Vector2D | null {
        const ptr = this.stage.getPointerPosition();
        return ptr ? this.screenToSketch(ptr) : null;
    }

    private setupViewportEvents() {
        // Prevent default browser context menu on canvas
        this.stage.on('contextmenu', (e: any) => {
            e.evt.preventDefault();
        });

        this.stage.on('mousedown', (e: any) => {
            if (e.evt.button === 1) { // Middle click for panning
                this.isPanning = true;
                const pos = this.stage.getPointerPosition();
                if (pos) {
                    this.panStart = { x: pos.x, y: pos.y };
                    this.stageStart = { x: this.stage.x(), y: this.stage.y() };
                }
                this.stage.container().style.cursor = 'grabbing';
                e.cancelBubble = true;
                return;
            }

            const pos = this.getStagePointerPosition();
            if (pos) {
                this.toolService.onMouseDown(pos, e.evt, this, this);
            }
        });

        this.stage.on('mousemove', (e: any) => {
            if (this.isPanning) {
                const pos = this.stage.getPointerPosition();
                if (pos) {
                    const dx = pos.x - this.panStart.x;
                    const dy = pos.y - this.panStart.y;
                    this.stage.position({
                        x: this.stageStart.x + dx,
                        y: this.stageStart.y + dy
                    });
                    this.drawGrid();
                }
                return;
            }

            const pos = this.getStagePointerPosition();
            if (pos) {
                if (this.draggedConstraintId !== null) {
                    const con = this.workspace.getConstraint(this.draggedConstraintId) as any;
                    if (con) {
                        const newOffset = this.calculateConstraintOffset(con, pos);
                        if (newOffset !== null) {
                            if (con.type === 'point_line_distance') {
                                const offsets = newOffset as { x: number; y: number };
                                con.layoutOffsetX = offsets.x;
                                con.layoutOffsetY = offsets.y;
                            } else if (con.type === 'distance' || con.type === 'horizontal_distance' || con.type === 'vertical_distance') {
                                con.layoutOffset = newOffset as number;
                            }
                            this.redrawAll();
                        }
                    }
                }
                
                this.toolService.onMouseMove(pos, e.evt, this, this);
            }
        });

        this.stage.on('mouseup', (e: any) => {
            if (this.isPanning) {
                this.isPanning = false;
                this.stage.container().style.cursor = 
                    this.toolService.activeToolMode() === 'select' ? 'default' : 'crosshair';
            }

            if (this.draggedConstraintId !== null) {
                this.draggedConstraintId = null;
                this.workspace.commitHistory();
                this.redrawAll();
            }

            const pos = this.getStagePointerPosition();
            if (pos) {
                this.toolService.onMouseUp(pos, e.evt, this, this);
            }
        });

        this.stage.on('wheel', (e: any) => {
            e.evt.preventDefault();
            const scaleBy = 1.15;
            const oldScale = this.stage.scaleX();
            const pointer = this.stage.getPointerPosition();
            if (!pointer) return;

            const mousePointTo = {
                x: (pointer.x - this.stage.x()) / oldScale,
                y: (pointer.y - this.stage.y()) / oldScale
            };

            const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            const boundedScale = Math.max(0.02, Math.min(newScale, 200));

            this.stage.scale({ x: boundedScale, y: boundedScale });
            this.stage.position({
                x: pointer.x - mousePointTo.x * boundedScale,
                y: pointer.y - mousePointTo.y * boundedScale
            });
            
            this.drawGrid();
            this.redrawAll();
        });
    }

    // --- CAD Rendering Implementation (Ported from viewport.ts) ---

    private isConstraintEntityHovered(conId: string | null, entityId: string): boolean {
        if (!conId) return false;
        const con = this.workspace.getConstraint(conId);
        if (!con) return false;
        
        switch (con.type) {
            case 'coincident':
            case 'distance':
            case 'horizontal_distance':
            case 'vertical_distance':
                return con.p1Id === entityId || con.p2Id === entityId;
            case 'point_line_distance':
                return con.pointId === entityId || con.lineId === entityId;
            case 'vertical':
            case 'horizontal':
                return con.lineId === entityId;
            case 'parallel':
            case 'perpendicular':
                return con.line1Id === entityId || con.line2Id === entityId;
            default:
                return false;
        }
    }

    redrawAll() {
        if (!this.stage) return;
        this.mainLayer.destroyChildren();

        const s = this.stage.scaleX();
        const invS = 1 / s;

        // Fetch selection/hover states
        const selectedEntityIds = this.workspace.selectedEntityIds();
        const hoveredEntityId = this.workspace.hoveredEntityId();
        const hoveredConstraintId = this.workspace.hoveredConstraintId();

        // 1. Draw Previews
        if (this.tempLinePreview) this.mainLayer.add(this.tempLinePreview);
        if (this.tempCirclePreview) this.mainLayer.add(this.tempCirclePreview);
        if (this.tempPointPreview) this.mainLayer.add(this.tempPointPreview);
        this.mainLayer.add(this.snapIndicator);

        // 2. Draw Lines
        this.workspace.lines().forEach(l => {
            const p1 = this.workspace.getPoint(l.p1Id);
            const p2 = this.workspace.getPoint(l.p2Id);
            if (!p1 || !p2) return;

            const isSelected = selectedEntityIds.includes(l.id);
            const isHovered = hoveredEntityId === l.id || this.isConstraintEntityHovered(hoveredConstraintId, l.id);

            const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : '#334155');
            const strokeWidth = (isSelected || isHovered ? 3.5 : 2) * invS;

            const lineShape = new Konva.Line({
                points: [p1.x, p1.y, p2.x, p2.y],
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                id: l.id
            });

            lineShape.on('mouseenter', () => {
                if (this.toolService.activeToolMode() === 'select') {
                    this.workspace.setHoveredEntityId(l.id);
                    this.stage.container().style.cursor = 'pointer';
                }
            });
            lineShape.on('mouseleave', () => {
                if (this.workspace.hoveredEntityId() === l.id) {
                    this.workspace.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                }
            });

            this.mainLayer.add(lineShape);
        });

        // 3. Draw Circles
        this.workspace.circles().forEach(c => {
            const center = this.workspace.getPoint(c.centerId);
            if (!center) return;

            const isSelected = selectedEntityIds.includes(c.id);
            const isHovered = hoveredEntityId === c.id || this.isConstraintEntityHovered(hoveredConstraintId, c.id);

            const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : '#64748b');
            const strokeWidth = (isSelected || isHovered ? 3.5 : 2) * invS;

            const circleShape = new Konva.Circle({
                x: center.x,
                y: center.y,
                radius: c.radius,
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                id: c.id
            });

            circleShape.on('mouseenter', () => {
                if (this.toolService.activeToolMode() === 'select') {
                    this.workspace.setHoveredEntityId(c.id);
                    this.stage.container().style.cursor = 'pointer';
                }
            });
            circleShape.on('mouseleave', () => {
                if (this.workspace.hoveredEntityId() === c.id) {
                    this.workspace.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                }
            });

            this.mainLayer.add(circleShape);
        });

        // 4. Draw Constraints
        this.drawConstraints(invS);

        // 5. Draw Points
        this.workspace.points().forEach(p => {
            const isSelected = selectedEntityIds.includes(p.id);
            const isHovered = hoveredEntityId === p.id || this.isConstraintEntityHovered(hoveredConstraintId, p.id);

            const pointColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : (p.fixed ? '#ef4444' : '#1e293b'));

            const pointGroup = new Konva.Group({
                x: p.x,
                y: p.y,
                id: p.id
            });

            const dot = new Konva.Circle({
                name: 'dot',
                radius: (isHovered || isSelected ? 6.5 : 4.5) * invS,
                fill: pointColor,
                stroke: p.fixed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0,0,0,0.5)',
                strokeWidth: 1.5 * invS
            });

            const hitArea = new Konva.Circle({
                name: 'hitArea',
                radius: 16 * invS,
                fill: 'rgba(0, 0, 0, 0)'
            });

            pointGroup.add(hitArea);
            pointGroup.add(dot);

            pointGroup.on('mouseenter', () => {
                if (this.toolService.activeToolMode() === 'select') {
                    this.workspace.setHoveredEntityId(p.id);
                    this.stage.container().style.cursor = 'pointer';
                }
            });
            pointGroup.on('mouseleave', () => {
                if (this.workspace.hoveredEntityId() === p.id) {
                    this.workspace.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                }
            });

            this.mainLayer.add(pointGroup);
        });

        // 6. Draw Active Dimension Preview
        if (this.tempDimensionPreview) {
            const { type, entityIds, mousePos } = this.tempDimensionPreview;
            const previewColor = 'rgba(99, 102, 241, 0.6)';
            
            if (type === 'point_line_distance') {
                const p = this.workspace.getPoint(entityIds[0]);
                const l = this.workspace.getLine(entityIds[1]);
                if (p && l) {
                    const lp1 = this.workspace.getPoint(l.p1Id);
                    const lp2 = this.workspace.getPoint(l.p2Id);
                    if (lp1 && lp2) {
                        const proj = projectPointOntoLine(p, lp1, lp2);
                        const val = dist(p, proj);
                        
                        const previewGroup = new Konva.Group({ listening: false });
                        this.drawPointLineDistanceConstraintPreview(p, lp1, lp2, val, mousePos, previewColor, previewGroup, invS);
                        this.mainLayer.add(previewGroup);
                    }
                }
            } else {
                const p1 = this.workspace.getPoint(entityIds[0]);
                const p2 = this.workspace.getPoint(entityIds[1]);
                if (p1 && p2) {
                    const val = type === 'horizontal_distance' ? Math.abs(p2.x - p1.x)
                        : type === 'vertical_distance' ? Math.abs(p2.y - p1.y)
                        : dist(p1, p2);
                        
                    const previewGroup = new Konva.Group({ listening: false });
                    this.drawDistanceConstraintPreview(type, p1, p2, val, mousePos, previewColor, previewGroup, invS);
                    this.mainLayer.add(previewGroup);
                }
            }
        }

        this.mainLayer.draw();
    }

    drawGrid() {
        if (!this.stage) return;
        this.gridLayer.destroyChildren();

        const s = this.stage.scaleX();
        const x = this.stage.x();
        const y = this.stage.y();

        const w = this.stage.width();
        const h = this.stage.height();

        // Dynamically size grid size based on scale
        let gridSize = 50;
        if (s > 2) gridSize = 10;
        if (s > 5) gridSize = 5;
        if (s < 0.5) gridSize = 100;
        if (s < 0.1) gridSize = 500;

        const startX = Math.floor((-x / s) / gridSize) * gridSize;
        const endX = startX + (w / s) + gridSize;
        const startY = Math.floor((-y / s) / gridSize) * gridSize;
        const endY = startY + (h / s) + gridSize;

        for (let gridX = startX; gridX <= endX; gridX += gridSize) {
            const isOrigin = Math.abs(gridX) < 0.1;
            const line = new Konva.Line({
                points: [gridX, startY, gridX, endY],
                stroke: isOrigin ? 'rgba(100, 116, 139, 0.4)' : 'rgba(203, 213, 225, 0.25)',
                strokeWidth: isOrigin ? 2 / s : 1 / s,
                listening: false
            });
            this.gridLayer.add(line);
        }

        for (let gridY = startY; gridY <= endY; gridY += gridSize) {
            const isOrigin = Math.abs(gridY) < 0.1;
            const line = new Konva.Line({
                points: [startX, gridY, endX, gridY],
                stroke: isOrigin ? 'rgba(100, 116, 139, 0.4)' : 'rgba(203, 213, 225, 0.25)',
                strokeWidth: isOrigin ? 2 / s : 1 / s,
                listening: false
            });
            this.gridLayer.add(line);
        }

        this.gridLayer.draw();
    }

    private drawConstraints(invS: number) {
        const hoveredConstraintId = this.workspace.hoveredConstraintId();
        const selectedEntityIds = this.workspace.selectedEntityIds();

        this.workspace.constraints().forEach(con => {
            const isHovered = hoveredConstraintId === con.id;
            const color = isHovered ? 'var(--accent-color)' : 'rgba(148, 163, 184, 0.85)';
            const strokeWidth = (isHovered ? 2.5 : 1.25) * invS;

            const conGroup = new Konva.Group({
                id: con.id,
                listening: true
            });

            conGroup.on('mouseenter', () => {
                if (this.toolService.activeToolMode() === 'select') {
                    this.workspace.setHoveredConstraintId(con.id);
                    this.stage.container().style.cursor = 'pointer';
                }
            });
            conGroup.on('mouseleave', () => {
                if (this.workspace.hoveredConstraintId() === con.id) {
                    this.workspace.setHoveredConstraintId(null);
                    this.stage.container().style.cursor = 'default';
                }
            });

            if (con.type === 'coincident') {
                const p1 = this.workspace.getPoint(con.p1Id);
                if (p1) this.drawCoincidentConstraint(p1, color, conGroup, invS);
            } else if (con.type === 'distance' || con.type === 'horizontal_distance' || con.type === 'vertical_distance') {
                const p1 = this.workspace.getPoint(con.p1Id);
                const p2 = this.workspace.getPoint(con.p2Id);
                if (p1 && p2) {
                    this.drawDistanceConstraint(con.type, p1, p2, con.value, color, strokeWidth, conGroup, con, invS);
                }
            } else if (con.type === 'point_line_distance') {
                const p = this.workspace.getPoint(con.pointId);
                const l = this.workspace.getLine(con.lineId);
                if (p && l) {
                    const lp1 = this.workspace.getPoint(l.p1Id);
                    const lp2 = this.workspace.getPoint(l.p2Id);
                    if (lp1 && lp2) {
                        this.drawPointLineDistanceConstraint(p, lp1, lp2, con.value, color, strokeWidth, conGroup, con, invS);
                    }
                }
            } else if (con.type === 'horizontal' || con.type === 'vertical') {
                const l = this.workspace.getLine(con.lineId);
                if (l) {
                    const p1 = this.workspace.getPoint(l.p1Id);
                    const p2 = this.workspace.getPoint(l.p2Id);
                    if (p1 && p2) {
                        this.drawHorizVertConstraint(con.type, p1, p2, color, conGroup, invS);
                    }
                }
            } else if (con.type === 'parallel' || con.type === 'perpendicular') {
                const l1 = this.workspace.getLine(con.line1Id);
                const l2 = this.workspace.getLine(con.line2Id);
                if (l1 && l2) {
                    const l1p1 = this.workspace.getPoint(l1.p1Id);
                    const l1p2 = this.workspace.getPoint(l1.p2Id);
                    const l2p1 = this.workspace.getPoint(l2.p1Id);
                    const l2p2 = this.workspace.getPoint(l2.p2Id);
                    if (l1p1 && l1p2 && l2p1 && l2p2) {
                        this.drawParallelPerpConstraint(con.type, l1p1, l1p2, l2p1, l2p2, color, conGroup, invS);
                    }
                }
            }

            this.mainLayer.add(conGroup);
        });
    }

    // --- Annotation Draw Utilities ---

    private drawCoincidentConstraint(p1: GCSPoint, color: string, parentGroup: any, invS: number) {
        const ring = new Konva.Ring({
            x: p1.x,
            y: p1.y,
            innerRadius: 8 * invS,
            outerRadius: 10 * invS,
            fill: color,
            listening: false
        });
        parentGroup.add(ring);
    }

    private drawDistanceConstraint(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance',
        p1: GCSPoint,
        p2: GCSPoint,
        val: number,
        color: string,
        strokeWidth: number,
        parentGroup: any,
        con: GCSConstraint,
        invS: number
    ) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;

        let nx = 0;
        let ny = 0;
        if (type === 'distance') {
            nx = -dy / len;
            ny = dx / len;
        } else if (type === 'horizontal_distance') {
            nx = 0;
            ny = 1;
        } else if (type === 'vertical_distance') {
            nx = 1;
            ny = 0;
        }

        const offset = (con as any).layoutOffset !== undefined ? (con as any).layoutOffset : 30;
        const offX = nx * offset;
        const offY = ny * offset;

        const ap1X = p1.x + offX;
        const ap1Y = p1.y + offY;
        const ap2X = p2.x + offX;
        const ap2Y = p2.y + offY;

        if (type === 'horizontal_distance') {
            const ext1 = new Konva.Line({ points: [p1.x, p1.y, p1.x, ap1Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            const ext2 = new Konva.Line({ points: [p2.x, p2.y, p2.x, ap2Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            parentGroup.add(ext1, ext2);
        } else if (type === 'vertical_distance') {
            const ext1 = new Konva.Line({ points: [p1.x, p1.y, ap1X, p1.y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            const ext2 = new Konva.Line({ points: [p2.x, p2.y, ap2X, p2.y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            parentGroup.add(ext1, ext2);
        } else {
            const ext1 = new Konva.Line({ points: [p1.x, p1.y, ap1X, ap1Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            const ext2 = new Konva.Line({ points: [p2.x, p2.y, ap2X, ap2Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            parentGroup.add(ext1, ext2);
        }

        const arrow1 = new Konva.Arrow({ points: [ap2X, ap2Y, ap1X, ap1Y], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: strokeWidth });
        const arrow2 = new Konva.Arrow({ points: [ap1X, ap1Y, ap2X, ap2Y], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: strokeWidth });
        parentGroup.add(arrow1, arrow2);

        // Add text label
        const mx = (ap1X + ap2X) / 2;
        const my = (ap1Y + ap2Y) / 2;

        const textVal = val.toFixed(2) + ' mm';
        
        const labelGroup = new Konva.Group({ x: mx, y: my, listening: true });
        const labelText = new Konva.Text({
            text: textVal,
            fontSize: 12 * invS,
            fill: color,
            align: 'center',
            offsetX: 30 * invS,
            offsetY: 6 * invS
        });
        
        const textRect = new Konva.Rect({
            x: -34 * invS,
            y: -10 * invS,
            width: 68 * invS,
            height: 18 * invS,
            fill: 'white',
            stroke: 'rgba(203,213,225,0.8)',
            strokeWidth: 1 * invS,
            cornerRadius: 4 * invS
        });
        
        labelGroup.add(textRect, labelText);
        
        labelGroup.on('mousedown', (e: any) => {
            e.cancelBubble = true;
            this.draggedConstraintId = con.id;
            this.panStart = this.stage.getPointerPosition();
            this.stageStart = { x: offset, y: 0 }; // Temporarily use stageStart.x for offset holding
        });

        parentGroup.add(labelGroup);
    }

    private drawPointLineDistanceConstraint(
        p: GCSPoint,
        lp1: GCSPoint,
        lp2: GCSPoint,
        val: number,
        color: string,
        strokeWidth: number,
        parentGroup: any,
        con: any,
        invS: number
    ) {
        const ux = lp2.x - lp1.x;
        const fillY = lp2.y - lp1.y;
        const len2 = ux*ux + fillY*fillY;
        let projX = lp1.x;
        let projY = lp1.y;
        if (len2 > 0) {
            const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*fillY) / len2;
            projX = lp1.x + t * ux;
            projY = lp1.y + t * fillY;
        }

        const offX = con.layoutOffsetX !== undefined ? con.layoutOffsetX : 15;
        const offY = con.layoutOffsetY !== undefined ? con.layoutOffsetY : -15;

        const apX = p.x + offX;
        const apY = p.y + offY;
        const aprojX = projX + offX;
        const aprojY = projY + offY;

        const ext1 = new Konva.Line({ points: [p.x, p.y, apX, apY], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
        const ext2 = new Konva.Line({ points: [projX, projY, aprojX, aprojY], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
        parentGroup.add(ext1, ext2);

        const arrow1 = new Konva.Arrow({ points: [aprojX, aprojY, apX, apY], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: strokeWidth });
        const arrow2 = new Konva.Arrow({ points: [apX, apY, aprojX, aprojY], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: strokeWidth });
        parentGroup.add(arrow1, arrow2);

        const mx = (apX + aprojX) / 2;
        const my = (apY + aprojY) / 2;

        const textVal = val.toFixed(2) + ' mm';
        const labelGroup = new Konva.Group({ x: mx, y: my, listening: true });
        
        const labelText = new Konva.Text({
            text: textVal,
            fontSize: 12 * invS,
            fill: color,
            align: 'center',
            offsetX: 30 * invS,
            offsetY: 6 * invS
        });
        
        const textRect = new Konva.Rect({
            x: -34 * invS,
            y: -10 * invS,
            width: 68 * invS,
            height: 18 * invS,
            fill: 'white',
            stroke: 'rgba(203,213,225,0.8)',
            strokeWidth: 1 * invS,
            cornerRadius: 4 * invS
        });
        
        labelGroup.add(textRect, labelText);

        labelGroup.on('mousedown', (e: any) => {
            e.cancelBubble = true;
            this.draggedConstraintId = con.id;
            this.panStart = this.stage.getPointerPosition();
            this.stageStart = { x: offX, y: offY };
        });

        parentGroup.add(labelGroup);
    }

    private drawHorizVertConstraint(
        type: 'horizontal' | 'vertical',
        p1: GCSPoint,
        p2: GCSPoint,
        color: string,
        parentGroup: any,
        invS: number
    ) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        const textVal = type === 'horizontal' ? 'H' : 'V';
        const label = new Konva.Label({ x: mx, y: my, listening: false });
        label.add(new Konva.Tag({
            fill: 'white',
            stroke: color,
            strokeWidth: 1 * invS,
            cornerRadius: 3 * invS
        }));
        label.add(new Konva.Text({
            text: textVal,
            fontSize: 10 * invS,
            fill: color,
            padding: 3 * invS
        }));
        parentGroup.add(label);
    }

    private drawParallelPerpConstraint(
        type: 'parallel' | 'perpendicular',
        l1p1: GCSPoint, l1p2: GCSPoint,
        l2p1: GCSPoint, l2p2: GCSPoint,
        color: string,
        parentGroup: any,
        invS: number
    ) {
        const m1x = (l1p1.x + l1p2.x) / 2;
        const m1y = (l1p1.y + l1p2.y) / 2;
        const m2x = (l2p1.x + l2p2.x) / 2;
        const m2y = (l2p1.y + l2p2.y) / 2;

        const textVal = type === 'parallel' ? '//' : '⊥';

        const drawIconAt = (mx: number, my: number, nx: number, ny: number) => {
            const label = new Konva.Label({
                x: mx + nx * 14 * invS,
                y: my + ny * 14 * invS,
                listening: false
            });
            label.add(new Konva.Tag({
                fill: 'white',
                stroke: color,
                strokeWidth: 0.8 * invS,
                cornerRadius: 2 * invS
            }));
            label.add(new Konva.Text({
                text: textVal,
                fontSize: 9 * invS,
                fill: color,
                padding: 2.5 * invS
            }));
            parentGroup.add(label);
        };

        const l1dx = l1p2.x - l1p1.x;
        const l1dy = l1p2.y - l1p1.y;
        const l1len = Math.hypot(l1dx, l1dy);

        const l2dx = l2p2.x - l2p1.x;
        const l2dy = l2p2.y - l2p1.y;
        const l2len = Math.hypot(l2dx, l2dy);

        if (l1len > 0 && l2len > 0) {
            drawIconAt(m1x, m1y, -l1dy / l1len, l1dx / l1len);
            drawIconAt(m2x, m2y, -l2dy / l2len, l2dx / l2len);
        }
    }

    private drawDistanceConstraintPreview(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance',
        p1: GCSPoint,
        p2: GCSPoint,
        val: number,
        mousePos: Vector2D,
        color: string,
        parentGroup: any,
        invS: number
    ) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;

        let nx = 0;
        let ny = 0;
        if (type === 'distance') {
            nx = -dy / len;
            ny = dx / len;
        } else if (type === 'horizontal_distance') {
            nx = 0;
            ny = 1;
        } else if (type === 'vertical_distance') {
            nx = 1;
            ny = 0;
        }

        // Project mouse position onto normal vector to determine offset
        const mx = mousePos.x - (p1.x + p2.x)/2;
        const my = mousePos.y - (p1.y + p2.y)/2;
        const offset = mx * nx + my * ny;

        const offX = nx * offset;
        const offY = ny * offset;

        const ap1X = p1.x + offX;
        const ap1Y = p1.y + offY;
        const ap2X = p2.x + offX;
        const ap2Y = p2.y + offY;

        const ext1 = new Konva.Line({ points: [p1.x, p1.y, ap1X, ap1Y], stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 * invS, dash: [4, 4] });
        const ext2 = new Konva.Line({ points: [p2.x, p2.y, ap2X, ap2Y], stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 * invS, dash: [4, 4] });
        parentGroup.add(ext1, ext2);

        const arrow1 = new Konva.Arrow({ points: [ap2X, ap2Y, ap1X, ap1Y], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: 1.2 * invS });
        const arrow2 = new Konva.Arrow({ points: [ap1X, ap1Y, ap2X, ap2Y], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: 1.2 * invS });
        parentGroup.add(arrow1, arrow2);

        const textVal = val.toFixed(2) + ' mm';
        const labelText = new Konva.Text({
            x: (ap1X + ap2X) / 2,
            y: (ap1Y + ap2Y) / 2,
            text: textVal,
            fontSize: 12 * invS,
            fill: color,
            align: 'center',
            offsetX: 30 * invS,
            offsetY: 6 * invS
        });
        
        const textRect = new Konva.Rect({
            x: (ap1X + ap2X) / 2 - 34 * invS,
            y: (ap1Y + ap2Y) / 2 - 10 * invS,
            width: 68 * invS,
            height: 18 * invS,
            fill: 'white',
            stroke: 'rgba(203,213,225,0.6)',
            strokeWidth: 1 * invS,
            cornerRadius: 4 * invS
        });
        parentGroup.add(textRect, labelText);
    }

    private drawPointLineDistanceConstraintPreview(
        p: GCSPoint,
        lp1: GCSPoint,
        lp2: GCSPoint,
        val: number,
        mousePos: Vector2D,
        color: string,
        parentGroup: any,
        invS: number
    ) {
        const ux = lp2.x - lp1.x;
        const dy = lp2.y - lp1.y;
        const len2 = ux*ux + dy*dy;
        let projX = lp1.x;
        let projY = lp1.y;
        if (len2 > 0) {
            const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*dy) / len2;
            projX = lp1.x + t * ux;
            projY = lp1.y + t * dy;
        }

        const offX = mousePos.x - p.x;
        const offY = mousePos.y - p.y;

        const apX = p.x + offX;
        const apY = p.y + offY;
        const aprojX = projX + offX;
        const aprojY = projY + offY;

        const ext1 = new Konva.Line({ points: [p.x, p.y, apX, apY], stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 * invS, dash: [4, 4] });
        const ext2 = new Konva.Line({ points: [projX, projY, aprojX, aprojY], stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 * invS, dash: [4, 4] });
        parentGroup.add(ext1, ext2);

        const arrow1 = new Konva.Arrow({ points: [aprojX, aprojY, apX, apY], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: 1.2 * invS });
        const arrow2 = new Konva.Arrow({ points: [apX, apY, aprojX, aprojY], pointerLength: 8 * invS, pointerWidth: 6 * invS, fill: color, stroke: color, strokeWidth: 1.2 * invS });
        parentGroup.add(arrow1, arrow2);

        const textVal = val.toFixed(2) + ' mm';
        const labelText = new Konva.Text({
            x: (apX + aprojX) / 2,
            y: (apY + aprojY) / 2,
            text: textVal,
            fontSize: 12 * invS,
            fill: color,
            align: 'center',
            offsetX: 30 * invS,
            offsetY: 6 * invS
        });
        
        const textRect = new Konva.Rect({
            x: (apX + aprojX) / 2 - 34 * invS,
            y: (apY + aprojY) / 2 - 10 * invS,
            width: 68 * invS,
            height: 18 * invS,
            fill: 'white',
            stroke: 'rgba(203,213,225,0.6)',
            strokeWidth: 1 * invS,
            cornerRadius: 4 * invS
        });
        parentGroup.add(textRect, labelText);
    }

    private calculateConstraintOffset(con: GCSConstraint, mousePos: Vector2D): number | { x: number; y: number } | null {
        if (con.type === 'point_line_distance') {
            const p = this.workspace.getPoint(con.pointId);
            if (!p) return null;
            return {
                x: mousePos.x - p.x,
                y: mousePos.y - p.y
            };
        } else if (con.type === 'distance' || con.type === 'horizontal_distance' || con.type === 'vertical_distance') {
            const p1 = this.workspace.getPoint(con.p1Id);
            const p2 = this.workspace.getPoint(con.p2Id);
            if (!p1 || !p2) return null;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len === 0) return null;

            let nx = 0;
            let ny = 0;
            if (con.type === 'distance') {
                nx = -dy / len;
                ny = dx / len;
            } else if (con.type === 'horizontal_distance') {
                nx = 0;
                ny = 1;
            } else if (con.type === 'vertical_distance') {
                nx = 1;
                ny = 0;
            }

            const mx = mousePos.x - (p1.x + p2.x) / 2;
            const my = mousePos.y - (p1.y + p2.y) / 2;
            return mx * nx + my * ny;
        }
        return null;
    }
}
