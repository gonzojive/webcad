import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, effect } from '@angular/core';
import { WorkspaceService } from '../services/workspace.service.js';
import { ToolService } from '../services/tool.service.js';
import { IRenderer, IInteractionProvider } from '../../interfaces/viewport_interfaces.js';
import { Vector2D, dist } from '../../../geometry/vector.js';
import { projectPointOntoLine } from '../../../geometry/project.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../../../../../ts/gcsapi/dist/index.js';
import { AnnotationDrawer } from './annotation_drawer.js';

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
        type: 'distance' | 'horizontalDistance' | 'verticalDistance' | 'pointLineDistance';
        entityIds: string[];
        mousePos: Vector2D;
    } | null = null;

    private draggedConstraintId: string | null = null;
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private stageStart = { x: 0, y: 0 };
    private resizeListener?: () => void;
    private annotationDrawer!: AnnotationDrawer;

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

        this.annotationDrawer = new AnnotationDrawer(
            {
                getPoint: (id) => this.workspace.getPoint(id),
                getLine: (id) => this.workspace.getLine(id),
                getConstraint: (id) => this.workspace.getConstraint(id)
            },
            {
                onLabelDragStart: (id, initOffset) => this.handleConstraintDragStart(id, initOffset)
            }
        );

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
                radius: 3.5,
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
        type: 'distance' | 'horizontalDistance' | 'verticalDistance' | 'pointLineDistance',
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
 
    isSketchPointInViewport(pos: Vector2D): boolean {
        if (!this.stage) return false;
        const screenPos = this.sketchToScreen(pos);
        return screenPos.x >= 0 && screenPos.x <= this.stage.width() &&
               screenPos.y >= 0 && screenPos.y <= this.stage.height();
    }

    getViewportSketchBounds(): { min: Vector2D; max: Vector2D } {
        if (!this.stage) {
            return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
        }
        const topLeft = this.screenToSketch({ x: 0, y: 0 });
        const bottomRight = this.screenToSketch({ x: this.stage.width(), y: this.stage.height() });
        return {
            min: { x: Math.min(topLeft.x, bottomRight.x), y: Math.min(topLeft.y, bottomRight.y) },
            max: { x: Math.max(topLeft.x, bottomRight.x), y: Math.max(topLeft.y, bottomRight.y) }
        };
    }

    toDataURL(): string {
        return this.stage ? this.stage.toDataURL() : '';
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
                const pos = this.stage.getPointerPosition();
                if (pos) {
                    this.handlePanStart(pos);
                }
                e.cancelBubble = true;
                return;
            }

            const pos = this.getStagePointerPosition();
            if (pos) {
                this.toolService.onMouseDown(pos, e.evt, this, this);
            }
        });

        this.stage.on('mousemove', (e: any) => {
            const pos = this.stage.getPointerPosition();
            if (this.isPanning && pos) {
                this.handlePanMove(pos);
                return;
            }

            const sketchPos = this.getStagePointerPosition();
            if (sketchPos) {
                if (this.draggedConstraintId !== null) {
                    this.handleConstraintDragMove(sketchPos);
                }
                
                this.toolService.onMouseMove(sketchPos, e.evt, this, this);
            }
        });

        this.stage.on('mouseup', (e: any) => {
            if (this.isPanning) {
                this.handlePanEnd();
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
            this.handleZoom(e);
        });

        this.stage.on('dblclick', (e: any) => {
            this.zoomToFit();
        });
    }

    private handlePanStart(pos: Vector2D) {
        this.isPanning = true;
        this.panStart = { x: pos.x, y: pos.y };
        this.stageStart = { x: this.stage.x(), y: this.stage.y() };
        this.stage.container().style.cursor = 'grabbing';
    }

    private handlePanMove(pos: Vector2D) {
        const dx = pos.x - this.panStart.x;
        const dy = pos.y - this.panStart.y;
        this.stage.position({
            x: this.stageStart.x + dx,
            y: this.stageStart.y + dy
        });
        this.drawGrid();
    }

    private handlePanEnd() {
        this.isPanning = false;
        this.stage.container().style.cursor = 
            this.toolService.activeToolMode() === 'select' ? 'default' : 'crosshair';
    }

    private handleConstraintDragStart(constraintId: string, initialOffset: number | { x: number; y: number }) {
        this.draggedConstraintId = constraintId;
        this.panStart = this.stage.getPointerPosition();
        if (typeof initialOffset === 'number') {
            this.stageStart = { x: initialOffset, y: 0 };
        } else {
            this.stageStart = { x: initialOffset.x, y: initialOffset.y };
        }
    }

    private handleConstraintDragMove(pos: Vector2D) {
        const con = this.workspace.getConstraint(this.draggedConstraintId!) as any;
        if (con) {
            const newOffset = this.annotationDrawer.calculateConstraintOffset(con, pos);
            if (newOffset !== null) {
                if (con.type === 'pointLineDistance') {
                    const offsets = newOffset as { x: number; y: number };
                    con.layoutOffsetX = offsets.x;
                    con.layoutOffsetY = offsets.y;
                } else if (con.type === 'distance' || con.type === 'horizontalDistance' || con.type === 'verticalDistance') {
                    con.layoutOffset = newOffset as number;
                }
                this.redrawAll();
            }
        }
    }

    private handleZoom(e: any) {
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
    }

    zoomToFit() {
        if (!this.stage) return;

        const points = this.workspace.points();
        const circles = this.workspace.circles();

        if (points.length === 0 && circles.length === 0) {
            this.stage.scale({ x: 1, y: 1 });
            this.stage.position({ x: 0, y: 0 });
            this.drawGrid();
            this.redrawAll();
            return;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        circles.forEach(c => {
            const center = this.workspace.getPoint(c.centerId);
            if (center) {
                const cx1 = center.x - c.radius;
                const cx2 = center.x + c.radius;
                const cy1 = center.y - c.radius;
                const cy2 = center.y + c.radius;

                if (cx1 < minX) minX = cx1;
                if (cx2 > maxX) maxX = cx2;
                if (cy1 < minY) minY = cy1;
                if (cy2 > maxY) maxY = cy2;
            }
        });

        const boxW = maxX - minX;
        const boxH = maxY - minY;

        const vpW = this.stage.width();
        const vpH = this.stage.height();

        const padW = boxW > 0 ? boxW * 1.3 : 200;
        const padH = boxH > 0 ? boxH * 1.3 : 200;

        let scale = Math.min(vpW / padW, vpH / padH);
        scale = Math.max(0.05, Math.min(scale, 50));

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        this.stage.scale({ x: scale, y: scale });
        this.stage.position({
            x: vpW / 2 - cx * scale,
            y: vpH / 2 - cy * scale
        });

        this.drawGrid();
        this.redrawAll();
    }

    // --- CAD Rendering Implementation (Ported from viewport.ts) ---

    private isConstraintEntityHovered(conId: string | null, entityId: string): boolean {
        if (!conId) return false;
        const con = this.workspace.getConstraint(conId);
        if (!con) return false;
        
        switch (con.type) {
            case 'coincident':
            case 'distance':
            case 'horizontalDistance':
            case 'verticalDistance':
                return con.p1Id === entityId || con.p2Id === entityId;
            case 'pointLineDistance':
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
                const mode = this.toolService.activeToolMode();
                if (mode === 'select' || mode === 'dimension') {
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
                const mode = this.toolService.activeToolMode();
                if (mode === 'select' || mode === 'dimension') {
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
        this.annotationDrawer.drawConstraints(
            this.mainLayer,
            this.workspace.constraints(),
            hoveredConstraintId,
            invS,
            this.stage.container(),
            (conId) => {
                this.workspace.setHoveredConstraintId(conId);
                this.stage.container().style.cursor = 'pointer';
            },
            (conId) => {
                if (this.workspace.hoveredConstraintId() === conId) {
                    this.workspace.setHoveredConstraintId(null);
                    this.stage.container().style.cursor = 'default';
                }
            }
        );

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
                radius: (isHovered || isSelected ? 5.0 : 3.0) * invS,
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
                const mode = this.toolService.activeToolMode();
                if (mode === 'select' || mode === 'dimension') {
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
            this.annotationDrawer.drawPreview(this.mainLayer, type, entityIds, mousePos, previewColor, invS);
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

}
