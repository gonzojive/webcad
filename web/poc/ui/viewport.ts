import { GCSPoint, GCSLine, GCSCircle } from '@webcad/gcsapi';
import { SketchStateModel } from './state.js';

declare const Konva: any;

/**
 * Manages the interactive 2D Konva canvas viewport, including grid rendering,
 * zoom/pan controls, drawing previews, and mouse/drag gesture dispatching.
 */
export class CanvasViewport {
    private readonly containerId: string;
    private readonly model: SketchStateModel;

    private stage: any;
    private mainLayer: any;
    private gridLayer: any;
    private snapIndicator: any;

    private tempLinePreview: any = null;
    private tempCirclePreview: any = null;

    // Viewport panning/zooming state
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private stageStart = { x: 0, y: 0 };
    private draggedPointId: string | null = null;

    // Interactive callbacks
    private onDragMove: ((id: string, x: number, y: number) => void) | null = null;
    private onDragEnd: (() => void) | null = null;
    private onEntityClick: ((id: string, event: any) => void) | null = null;
    private onStageMouseDown: ((pos: { x: number; y: number }, event: any) => void) | null = null;
    private onStageMouseMove: ((pos: { x: number; y: number }) => void) | null = null;

    constructor(containerId: string, model: SketchStateModel) {
        this.containerId = containerId;
        this.model = model;
    }

    /**
     * Initializes the Konva stage, layers, and interactive viewport event listeners.
     */
    init() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        this.stage = new Konva.Stage({
            container: this.containerId,
            width: container.clientWidth,
            height: container.clientHeight
        });

        this.gridLayer = new Konva.Layer();
        this.mainLayer = new Konva.Layer();

        this.stage.add(this.gridLayer);
        this.stage.add(this.mainLayer);

        // Snap Indicator Setup
        this.snapIndicator = new Konva.Circle({
            radius: 8,
            stroke: 'var(--success-color)',
            strokeWidth: 2,
            visible: false,
            listening: false
        });
        this.mainLayer.add(this.snapIndicator);

        this.drawGrid();

        // Resize Handler
        window.addEventListener('resize', () => {
            if (this.stage && container) {
                this.stage.width(container.clientWidth);
                this.stage.height(container.clientHeight);
                this.drawGrid();
            }
        });

        this.setupViewportEvents();
    }

    // --- Interactive Callback Registration ---

    setDragMoveCallback(cb: (id: string, x: number, y: number) => void) {
        this.onDragMove = cb;
    }

    setDragEndCallback(cb: () => void) {
        this.onDragEnd = cb;
    }

    setEntityClickCallback(cb: (id: string, event: any) => void) {
        this.onEntityClick = cb;
    }

    setStageMouseDownCallback(cb: (pos: { x: number; y: number }, event: any) => void) {
        this.onStageMouseDown = cb;
    }

    setStageMouseMoveCallback(cb: (pos: { x: number; y: number }) => void) {
        this.onStageMouseMove = cb;
    }

    // --- Viewport State Accessors ---

    getDraggedPointId(): string | null {
        return this.draggedPointId;
    }

    setDraggedPointId(id: string | null) {
        this.draggedPointId = id;
    }

    getStagePointerPosition(): { x: number; y: number } | null {
        if (!this.stage) return null;
        const pos = this.stage.getPointerPosition();
        if (!pos) return null;
        const transform = this.stage.getAbsoluteTransform().copy().invert();
        return transform.point(pos);
    }

    // --- Previews & Snap controls ---

    updateSnapIndicator(x: number, y: number, visible: boolean) {
        if (this.snapIndicator) {
            this.snapIndicator.x(x);
            this.snapIndicator.y(y);
            this.snapIndicator.visible(visible);
            this.mainLayer.batchDraw();
        }
    }

    updateLinePreview(x1: number, y1: number, x2: number, y2: number) {
        if (!this.tempLinePreview) {
            this.tempLinePreview = new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: 'var(--accent-color)',
                strokeWidth: 2,
                dash: [4, 4],
                listening: false
            });
            this.mainLayer.add(this.tempLinePreview);
        } else {
            this.tempLinePreview.points([x1, y1, x2, y2]);
        }
        this.mainLayer.batchDraw();
    }

    updateCirclePreview(cx: number, cy: number, r: number) {
        if (!this.tempCirclePreview) {
            this.tempCirclePreview = new Konva.Circle({
                x: cx,
                y: cy,
                radius: r,
                stroke: 'var(--accent-color)',
                strokeWidth: 2,
                dash: [4, 4],
                listening: false
            });
            this.mainLayer.add(this.tempCirclePreview);
        } else {
            this.tempCirclePreview.radius(r);
        }
        this.mainLayer.batchDraw();
    }

    clearPreviews() {
        if (this.tempLinePreview) {
            this.tempLinePreview.destroy();
            this.tempLinePreview = null;
        }
        if (this.tempCirclePreview) {
            this.tempCirclePreview.destroy();
            this.tempCirclePreview = null;
        }
        if (this.snapIndicator) {
            this.snapIndicator.visible(false);
        }
        this.mainLayer.batchDraw();
    }

    // --- Drawing & Rendering Logic ---

    drawGrid() {
        if (!this.stage || !this.gridLayer) return;

        this.gridLayer.destroyChildren();

        const width = this.stage.width();
        const height = this.stage.height();

        const scale = this.stage.scaleX();
        const posX = this.stage.x();
        const posY = this.stage.y();

        const gridSpacing = 40;

        // Calculate grid boundaries in screen coordinates
        const startX = Math.floor(-posX / (gridSpacing * scale)) * gridSpacing;
        const endX = startX + (width / scale) + gridSpacing;

        const startY = Math.floor(-posY / (gridSpacing * scale)) * gridSpacing;
        const endY = startY + (height / scale) + gridSpacing;

        // Draw grid dots
        for (let x = startX; x < endX; x += gridSpacing) {
            for (let y = startY; y < endY; y += gridSpacing) {
                // Transform grid coordinate to screen pixels
                const screenX = posX + x * scale;
                const screenY = posY + y * scale;

                if (screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height) {
                    const dot = new Konva.Circle({
                        x: screenX,
                        y: screenY,
                        radius: 1,
                        fill: 'var(--border-color)',
                        opacity: 0.3,
                        listening: false
                    });
                    this.gridLayer.add(dot);
                }
            }
        }
        this.gridLayer.draw();
    }

    zoomToFit() {
        if (!this.stage) return;

        const padding = 60;
        const width = this.stage.width();
        const height = this.stage.height();
        const points = this.model.getPoints();

        if (points.length === 0) {
            this.stage.scale({ x: 1, y: 1 });
            this.stage.position({ x: 0, y: 0 });
            this.redrawAll();
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        const boxW = (maxX - minX) || 120;
        const boxH = (maxY - minY) || 120;
        const centerX = minX + boxW / 2;
        const centerY = minY + boxH / 2;

        const scaleX = (width - padding * 2) / boxW;
        const scaleY = (height - padding * 2) / boxH;
        const newScale = Math.max(0.2, Math.min(scaleX, scaleY, 2.5));

        this.stage.scale({ x: newScale, y: newScale });
        this.stage.position({
            x: width / 2 - centerX * newScale,
            y: height / 2 - centerY * newScale
        });

        this.redrawAll();
    }

    redrawAll() {
        if (!this.stage || !this.mainLayer) return;

        this.mainLayer.destroyChildren();

        // Re-add snap indicator
        this.mainLayer.add(this.snapIndicator);

        const currentTool = this.model.getTool();
        const selectedEntityIds = this.model.getSelectedEntityIds();
        const hoveredEntityId = this.model.getHoveredEntityId();
        const hoveredConstraintId = this.model.getHoveredConstraintId();

        const isConstraintEntityHovered = (entityId: string): boolean => {
            if (!hoveredConstraintId) return false;
            const con = this.model.getConstraint(hoveredConstraintId);
            if (!con) return false;
            switch (con.type) {
                case 'coincident':
                case 'distance':
                    return con.p1Id === entityId || con.p2Id === entityId;
                case 'vertical':
                case 'horizontal':
                    return con.lineId === entityId;
                case 'parallel':
                case 'perpendicular':
                    return con.line1Id === entityId || con.line2Id === entityId;
            }
            return false;
        };

        // Draw Lines
        this.model.getLines().forEach(l => {
            const p1 = this.model.getPoint(l.p1Id);
            const p2 = this.model.getPoint(l.p2Id);
            if (!p1 || !p2) return;

            const isSelected = selectedEntityIds.includes(l.id);
            const isHovered = hoveredEntityId === l.id || isConstraintEntityHovered(l.id);

            const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : 'var(--text-muted)');
            const strokeWidth = isSelected || isHovered ? 4 : 2.5;

            const lineShape = new Konva.Line({
                points: [p1.x, p1.y, p2.x, p2.y],
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                id: l.id
            });

            lineShape.on('mouseenter', () => {
                if (this.model.getTool() === 'select') {
                    this.model.setHoveredEntityId(l.id);
                    this.stage.container().style.cursor = 'pointer';
                    this.updateEntityVisuals();
                }
            });

            lineShape.on('mouseleave', () => {
                if (this.model.getHoveredEntityId() === l.id) {
                    this.model.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                    this.updateEntityVisuals();
                }
            });

            lineShape.on('click', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                    if (this.onEntityClick) this.onEntityClick(l.id, e);
                }
            });

            this.mainLayer.add(lineShape);
        });

        // Draw Circles
        this.model.getCircles().forEach(c => {
            const center = this.model.getPoint(c.centerId);
            if (!center) return;

            const isSelected = selectedEntityIds.includes(c.id);
            const isHovered = hoveredEntityId === c.id || isConstraintEntityHovered(c.id);

            const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : '#64748b');
            const strokeWidth = isSelected || isHovered ? 3.5 : 2;

            const circleShape = new Konva.Circle({
                x: center.x,
                y: center.y,
                radius: c.radius,
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                id: c.id
            });

            circleShape.on('mouseenter', () => {
                if (this.model.getTool() === 'select') {
                    this.model.setHoveredEntityId(c.id);
                    this.stage.container().style.cursor = 'pointer';
                    this.updateEntityVisuals();
                }
            });

            circleShape.on('mouseleave', () => {
                if (this.model.getHoveredEntityId() === c.id) {
                    this.model.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                    this.updateEntityVisuals();
                }
            });

            circleShape.on('click', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                    if (this.onEntityClick) this.onEntityClick(c.id, e);
                }
            });

            this.mainLayer.add(circleShape);
        });

        // Draw Points
        this.model.getPoints().forEach(p => {
            const isSelected = selectedEntityIds.includes(p.id);
            const isHovered = hoveredEntityId === p.id || isConstraintEntityHovered(p.id);

            let pointColor = 'var(--text-color)';
            if (p.fixed) {
                pointColor = 'var(--danger-color)';
            } else if (isSelected) {
                pointColor = '#3b82f6';
            } else if (isHovered) {
                pointColor = 'var(--accent-color)';
            }

            const pointGroup = new Konva.Group({
                x: p.x,
                y: p.y,
                draggable: currentTool === 'select' && !p.fixed,
                id: p.id
            });

            const dot = new Konva.Circle({
                name: 'dot',
                radius: isHovered || isSelected ? 6 : 4.5,
                fill: pointColor,
                stroke: p.fixed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0,0,0,0.5)',
                strokeWidth: 1.5
            });

            const hitArea = new Konva.Circle({
                name: 'hitArea',
                radius: 16,
                fill: 'rgba(0, 0, 0, 0)'
            });

            pointGroup.add(hitArea);
            pointGroup.add(dot);

            pointGroup.on('mousedown', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                }
            });

            pointGroup.on('dragstart', () => {
                this.draggedPointId = p.id;
            });

            pointGroup.on('dragmove', () => {
                p.x = pointGroup.x();
                p.y = pointGroup.y();
                if (this.onDragMove) this.onDragMove(p.id, p.x, p.y);
            });

            pointGroup.on('dragend', () => {
                this.draggedPointId = null;
                if (this.onDragEnd) this.onDragEnd();
            });

            pointGroup.on('mouseenter', () => {
                if (this.model.getTool() === 'select') {
                    this.model.setHoveredEntityId(p.id);
                    this.stage.container().style.cursor = 'pointer';
                    this.updateEntityVisuals();
                }
            });

            pointGroup.on('mouseleave', () => {
                if (this.model.getHoveredEntityId() === p.id) {
                    this.model.setHoveredEntityId(null);
                    this.stage.container().style.cursor = 'crosshair';
                    this.updateEntityVisuals();
                }
            });

            pointGroup.on('click', (e: any) => {
                e.cancelBubble = true;
                if (this.onEntityClick) this.onEntityClick(p.id, e);
            });

            this.mainLayer.add(pointGroup);
        });

        this.mainLayer.draw();
    }

    updateEntityVisuals() {
        if (!this.mainLayer) return;

        const selectedEntityIds = this.model.getSelectedEntityIds();
        const hoveredEntityId = this.model.getHoveredEntityId();
        const hoveredConstraintId = this.model.getHoveredConstraintId();

        const isConstraintEntityHovered = (entityId: string): boolean => {
            if (!hoveredConstraintId) return false;
            const con = this.model.getConstraint(hoveredConstraintId);
            if (!con) return false;
            switch (con.type) {
                case 'coincident':
                case 'distance':
                    return con.p1Id === entityId || con.p2Id === entityId;
                case 'vertical':
                case 'horizontal':
                    return con.lineId === entityId;
                case 'parallel':
                case 'perpendicular':
                    return con.line1Id === entityId || con.line2Id === entityId;
            }
            return false;
        };

        // Update Lines
        this.model.getLines().forEach(l => {
            const lineShape = this.mainLayer.findOne('#' + l.id) as any;
            if (!lineShape) return;

            const isSelected = selectedEntityIds.includes(l.id);
            const isHovered = hoveredEntityId === l.id || isConstraintEntityHovered(l.id);

            lineShape.stroke(isSelected ? '#3b82f6' : (isHovered ? '#1a73e8' : '#64748b'));
            lineShape.strokeWidth(isSelected || isHovered ? 4 : 2.5);
        });

        // Update Circles
        this.model.getCircles().forEach(c => {
            const circleShape = this.mainLayer.findOne('#' + c.id) as any;
            if (!circleShape) return;

            const isSelected = selectedEntityIds.includes(c.id);
            const isHovered = hoveredEntityId === c.id || isConstraintEntityHovered(c.id);

            circleShape.stroke(isSelected ? '#3b82f6' : (isHovered ? '#1a73e8' : '#64748b'));
            circleShape.strokeWidth(isSelected || isHovered ? 3.5 : 2);
        });

        // Update Points
        this.model.getPoints().forEach(p => {
            if (p.id === this.draggedPointId) return;

            const pointGroup = this.mainLayer.findOne('#' + p.id) as any;
            if (!pointGroup) return;

            const isSelected = selectedEntityIds.includes(p.id);
            const isHovered = hoveredEntityId === p.id || isConstraintEntityHovered(p.id);

            let pointColor = '#334155'; // var(--text-color) fallback
            if (p.fixed) {
                pointColor = '#ef4444'; // var(--danger-color) fallback
            } else if (isSelected) {
                pointColor = '#3b82f6';
            } else if (isHovered) {
                pointColor = '#1a73e8'; // var(--accent-color) fallback
            }

            const dot = pointGroup.findOne('.dot');
            if (dot) {
                dot.radius(isHovered || isSelected ? 6 : 4.5);
                dot.fill(pointColor);
            }
        });

        this.mainLayer.batchDraw();
    }

    updateLineVisualPosition(lineId: string, x1: number, y1: number, x2: number, y2: number) {
        const lineShape = this.mainLayer?.findOne('#' + lineId);
        if (lineShape) {
            lineShape.points([x1, y1, x2, y2]);
        }
    }

    updateCircleVisualPosition(circleId: string, cx: number, cy: number, r: number) {
        const circleShape = this.mainLayer?.findOne('#' + circleId);
        if (circleShape) {
            circleShape.x(cx);
            circleShape.y(cy);
            circleShape.radius(r);
        }
    }

    updatePointVisualPosition(pointId: string, x: number, y: number) {
        const pointGroup = this.mainLayer?.findOne('#' + pointId);
        if (pointGroup) {
            pointGroup.x(x);
            pointGroup.y(y);
        }
    }

    // --- Private Setup Events ---

    private setupViewportEvents() {
        if (!this.stage) return;

        this.stage.on('mousedown', (e: any) => {
            if (e.evt.button === 1) { // Middle click
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
            if (pos && this.onStageMouseDown) {
                this.onStageMouseDown(pos, e);
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
            if (pos && this.onStageMouseMove) {
                this.onStageMouseMove(pos);
            }
        });

        this.stage.on('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.stage.container().style.cursor = 
                    this.model.getTool() === 'select' ? 'default' : 'crosshair';
            }
        });

        // Double Click to Zoom to Fit
        this.stage.on('dblclick', () => {
            this.zoomToFit();
        });

        // Wheel Zoom
        this.stage.on('wheel', (e: any) => {
            e.evt.preventDefault();

            const scaleBy = 1.1;
            const oldScale = this.stage.scaleX();
            const pointer = this.stage.getPointerPosition();
            if (!pointer) return;

            const mousePointTo = {
                x: (pointer.x - this.stage.x()) / oldScale,
                y: (pointer.y - this.stage.y()) / oldScale
            };

            const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            const boundedScale = Math.max(0.1, Math.min(newScale, 15));

            this.stage.scale({ x: boundedScale, y: boundedScale });

            const newPos = {
                x: pointer.x - mousePointTo.x * boundedScale,
                y: pointer.y - mousePointTo.y * boundedScale
            };
            this.stage.position(newPos);
            this.drawGrid();
        });
    }
}
