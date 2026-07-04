import { GCSPoint, GCSLine, GCSCircle, GCSConstraint, DistanceConstraint, HorizontalDistanceConstraint, VerticalDistanceConstraint, PointLineDistanceConstraint } from '../gcsapi/gcsapi.js';
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
    private tempPointPreview: any = null;
    private tempDimensionPreview: {
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance';
        entityIds: string[];
        mousePos: { x: number; y: number };
    } | null = null;
    private draggedConstraintId: string | null = null;

    // Viewport panning/zooming state
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private stageStart = { x: 0, y: 0 };
    private draggedPointId: string | null = null;

    // Interactive callbacks
    private onDragMove: ((id: string, x: number, y: number) => void) | null = null;
    private onDragEnd: (() => void) | null = null;
    private onEntityClick: ((id: string, event: any) => void) | null = null;
    private onConstraintDblClick: ((id: string, event: any) => void) | null = null;
    private onStageMouseDown: ((pos: { x: number; y: number }, event: any) => void) | null = null;
    private onStageMouseMove: ((pos: { x: number; y: number }, e: any) => void) | null = null;

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

    setConstraintDblClickCallback(cb: (id: string, event: any) => void) {
        this.onConstraintDblClick = cb;
    }

    setStageMouseDownCallback(cb: (pos: { x: number; y: number }, event: any) => void) {
        this.onStageMouseDown = cb;
    }

    setStageMouseMoveCallback(cb: (pos: { x: number; y: number }) => void) {
        this.onStageMouseMove = cb;
    }

    setDimensionPreview(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance',
        entityIds: string[],
        mousePos: { x: number; y: number }
    ) {
        this.tempDimensionPreview = { type, entityIds, mousePos };
        this.redrawAll();
    }

    clearDimensionPreview() {
        if (this.tempDimensionPreview) {
            this.tempDimensionPreview = null;
            this.redrawAll();
        }
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
        if (this.tempPointPreview) {
            this.tempPointPreview.destroy();
            this.tempPointPreview = null;
        }
        if (this.snapIndicator) {
            this.snapIndicator.visible(false);
        }
        this.mainLayer.batchDraw();
    }

    public setPointPreview(x: number, y: number) {
        if (!this.tempPointPreview) {
            this.tempPointPreview = new Konva.Circle({
                radius: 4.5,
                fill: 'rgba(51, 65, 85, 0.4)',
                stroke: 'rgba(255, 255, 255, 0.8)',
                strokeWidth: 1,
                listening: false
            });
            this.mainLayer.add(this.tempPointPreview);
        }
        this.tempPointPreview.position({ x, y });
        this.tempPointPreview.visible(true);
        this.mainLayer.draw();
    }

    public clearPointPreview() {
        if (this.tempPointPreview) {
            this.tempPointPreview.visible(false);
            this.mainLayer.draw();
        }
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

    private isConstraintEntityHovered(conId: string | null, entityId: string): boolean {
        if (!conId) return false;
        const con = this.model.getConstraint(conId);
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
        }
        return false;
    }

    public getConstraintLabelPosition(con: GCSConstraint): { x: number; y: number } | null {
        switch (con.type) {
            case 'distance':
            case 'horizontal_distance':
            case 'vertical_distance': {
                const p1 = this.model.getPoint(con.p1Id);
                const p2 = this.model.getPoint(con.p2Id);
                if (!p1 || !p2) return null;
                
                const offset = con.layoutOffset !== undefined ? con.layoutOffset : 30;

                if (con.type === 'distance') {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len === 0) return null;
                    const nx = -dy / len;
                    const ny = dx / len;
                    return { x: (p1.x + p2.x) / 2 + nx * offset, y: (p1.y + p2.y) / 2 + ny * offset };
                } else if (con.type === 'horizontal_distance') {
                    const minY = Math.min(p1.y, p2.y);
                    const offsetVal = con.layoutOffset !== undefined ? con.layoutOffset : -30;
                    return { x: (p1.x + p2.x) / 2, y: minY + offsetVal };
                } else if (con.type === 'vertical_distance') {
                    const maxX = Math.max(p1.x, p2.x);
                    const offsetVal = con.layoutOffset !== undefined ? con.layoutOffset : 30;
                    return { x: maxX + offsetVal, y: (p1.y + p2.y) / 2 };
                }
                break;
            }
            case 'point_line_distance': {
                const p = this.model.getPoint(con.pointId);
                const l = this.model.getLine(con.lineId);
                if (!p || !l) return null;
                const lp1 = this.model.getPoint(l.p1Id);
                const lp2 = this.model.getPoint(l.p2Id);
                if (!lp1 || !lp2) return null;

                const ux = lp2.x - lp1.x;
                const uy = lp2.y - lp1.y;
                const len2 = ux*ux + uy*uy;
                let projX = lp1.x;
                let projY = lp1.y;
                if (len2 > 0) {
                    const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
                    projX = lp1.x + t * ux;
                    projY = lp1.y + t * uy;
                }
                const cx = (p.x + projX) / 2;
                const cy = (p.y + projY) / 2;
                const ox = con.layoutOffsetX !== undefined ? con.layoutOffsetX : 0;
                const oy = con.layoutOffsetY !== undefined ? con.layoutOffsetY : 0;
                return { x: cx + ox, y: cy + oy };
            }
            case 'horizontal':
            case 'vertical': {
                const l = this.model.getLine(con.lineId);
                if (!l) return null;
                const p1 = this.model.getPoint(l.p1Id);
                const p2 = this.model.getPoint(l.p2Id);
                if (!p1 || !p2) return null;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy);
                if (len === 0) return null;
                const nx = -dy / len;
                const ny = dx / len;
                return { x: (p1.x + p2.x) / 2 + nx * 12, y: (p1.y + p2.y) / 2 + ny * 12 };
            }
        }
        return null;
    }

    private drawConstraints() {
        const constraints = this.model.getConstraints();
        const hoveredConstraintId = this.model.getHoveredConstraintId();
        const selectedEntityIds = this.model.getSelectedEntityIds();

        constraints.forEach(con => {
            const isSelected = selectedEntityIds.includes(con.id);
            const isHovered = con.id === hoveredConstraintId;
            const color = isSelected || isHovered ? '#3b82f6' : 'rgba(148, 163, 184, 0.6)';
            const strokeWidth = isSelected || isHovered ? 2 : 1.2;

            const conGroup = new Konva.Group({
                id: con.id,
                listening: true
            });

            conGroup.on('mouseenter', () => {
                if (this.model.getTool() === 'select') {
                    this.model.setHoveredConstraintId(con.id);
                    this.stage.container().style.cursor = 'pointer';
                }
            });

            conGroup.on('mouseleave', () => {
                if (this.model.getHoveredConstraintId() === con.id) {
                    this.model.setHoveredConstraintId(null);
                    this.stage.container().style.cursor = 
                        this.model.getTool() === 'select' ? 'default' : 'crosshair';
                }
            });

            conGroup.on('click', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                    if (this.onEntityClick) this.onEntityClick(con.id, e);
                }
            });

            conGroup.on('dblclick', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                    if (this.onConstraintDblClick) this.onConstraintDblClick(con.id, e);
                }
            });

            conGroup.on('mousedown', (e: any) => {
                if (this.model.getTool() === 'select') {
                    e.cancelBubble = true;
                    this.draggedConstraintId = con.id;
                }
            });

            switch (con.type) {
                case 'distance':
                case 'horizontal_distance':
                case 'vertical_distance': {
                    const p1 = this.model.getPoint(con.p1Id);
                    const p2 = this.model.getPoint(con.p2Id);
                    if (!p1 || !p2) break;
                    this.drawDistanceConstraint(con.type, p1, p2, con.value, color, strokeWidth, conGroup, con);
                    break;
                }
                case 'point_line_distance': {
                    const p = this.model.getPoint(con.pointId);
                    const l = this.model.getLine(con.lineId);
                    if (!p || !l) break;
                    const lp1 = this.model.getPoint(l.p1Id);
                    const lp2 = this.model.getPoint(l.p2Id);
                    if (!lp1 || !lp2) break;
                    this.drawPointLineDistanceConstraint(p, lp1, lp2, con.value, color, strokeWidth, conGroup, con);
                    break;
                }
                case 'horizontal':
                case 'vertical': {
                    const l = this.model.getLine(con.lineId);
                    if (!l) break;
                    const p1 = this.model.getPoint(l.p1Id);
                    const p2 = this.model.getPoint(l.p2Id);
                    if (!p1 || !p2) break;
                    this.drawHorizVertConstraint(con.type, p1, p2, color, conGroup);
                    break;
                }
                case 'parallel':
                case 'perpendicular': {
                    const l1 = this.model.getLine(con.line1Id);
                    const l2 = this.model.getLine(con.line2Id);
                    if (!l1 || !l2) break;
                    const l1p1 = this.model.getPoint(l1.p1Id);
                    const l1p2 = this.model.getPoint(l1.p2Id);
                    const l2p1 = this.model.getPoint(l2.p1Id);
                    const l2p2 = this.model.getPoint(l2.p2Id);
                    if (!l1p1 || !l1p2 || !l2p1 || !l2p2) break;
                    this.drawParallelPerpConstraint(con.type, l1p1, l1p2, l2p1, l2p2, color, conGroup);
                    break;
                }
                case 'coincident': {
                    const p1 = this.model.getPoint(con.p1Id);
                    const p2 = this.model.getPoint(con.p2Id);
                    if (!p1 || !p2) break;
                    this.drawCoincidentConstraint(p1, color, conGroup);
                    break;
                }
            }

            this.mainLayer.add(conGroup);
        });
    }

    private drawDistanceConstraint(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance',
        p1: GCSPoint,
        p2: GCSPoint,
        val: number,
        color: string,
        strokeWidth: number,
        parentGroup: any,
        con: DistanceConstraint | HorizontalDistanceConstraint | VerticalDistanceConstraint
    ) {
        let d1x = p1.x, d1y = p1.y;
        let d2x = p2.x, d2y = p2.y;
        let ext1StartX = p1.x, ext1StartY = p1.y;
        let ext2StartX = p2.x, ext2StartY = p2.y;

        const offset = con.layoutOffset !== undefined ? con.layoutOffset : 30;

        if (type === 'distance') {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len === 0) return;
            const nx = -dy / len;
            const ny = dx / len;

            d1x = p1.x + nx * offset;
            d1y = p1.y + ny * offset;
            d2x = p2.x + nx * offset;
            d2y = p2.y + ny * offset;

        } else if (type === 'horizontal_distance') {
            const minY = Math.min(p1.y, p2.y);
            const offsetVal = con.layoutOffset !== undefined ? con.layoutOffset : -30;
            const dimY = minY + offsetVal;

            d1x = p1.x;
            d1y = dimY;
            d2x = p2.x;
            d2y = dimY;

        } else if (type === 'vertical_distance') {
            const maxX = Math.max(p1.x, p2.x);
            const offsetVal = con.layoutOffset !== undefined ? con.layoutOffset : 30;
            const dimX = maxX + offsetVal;

            d1x = dimX;
            d1y = p1.y;
            d2x = dimX;
            d2y = p2.y;
        }

        const ext1 = new Konva.Line({
            points: [ext1StartX, ext1StartY, d1x, d1y],
            stroke: 'rgba(148, 163, 184, 0.3)',
            strokeWidth: 1,
            dash: [2, 2],
            listening: false
        });
        const ext2 = new Konva.Line({
            points: [ext2StartX, ext2StartY, d2x, d2y],
            stroke: 'rgba(148, 163, 184, 0.3)',
            strokeWidth: 1,
            dash: [2, 2],
            listening: false
        });
        parentGroup.add(ext1);
        parentGroup.add(ext2);

        const mx = (d1x + d2x) / 2;
        const my = (d1y + d2y) / 2;

        const arrow1 = new Konva.Arrow({
            points: [mx, my, d1x, d1y],
            stroke: color,
            strokeWidth: strokeWidth,
            pointerLength: 6,
            pointerWidth: 4,
            listening: true
        });
        const arrow2 = new Konva.Arrow({
            points: [mx, my, d2x, d2y],
            stroke: color,
            strokeWidth: strokeWidth,
            pointerLength: 6,
            pointerWidth: 4,
            listening: true
        });
        parentGroup.add(arrow1);
        parentGroup.add(arrow2);

        const text = new Konva.Text({
            x: mx,
            y: my,
            text: val.toFixed(1),
            fontSize: 10,
            fontFamily: 'sans-serif',
            fill: color,
            listening: true
        });
        
        text.offsetX(text.width() / 2);
        text.offsetY(text.height() / 2);

        const rect = new Konva.Rect({
            x: mx - text.width()/2 - 2,
            y: my - text.height()/2 - 1,
            width: text.width() + 4,
            height: text.height() + 2,
            fill: 'white',
            listening: true
        });

        parentGroup.add(rect);
        parentGroup.add(text);
    }

    private drawPointLineDistanceConstraint(
        p: GCSPoint,
        lp1: GCSPoint,
        lp2: GCSPoint,
        val: number,
        color: string,
        strokeWidth: number,
        parentGroup: any,
        con: PointLineDistanceConstraint
    ) {
        const ux = lp2.x - lp1.x;
        const uy = lp2.y - lp1.y;
        const len2 = ux*ux + uy*uy;
        let projX = lp1.x;
        let projY = lp1.y;
        if (len2 > 0) {
            const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
            projX = lp1.x + t * ux;
            projY = lp1.y + t * uy;
        }

        const perpLine = new Konva.Line({
            points: [p.x, p.y, projX, projY],
            stroke: color,
            strokeWidth: strokeWidth,
            dash: [3, 3],
            listening: true
        });
        parentGroup.add(perpLine);

        const labelPos = this.getConstraintLabelPosition(con);
        if (!labelPos) return;

        const projMidX = (p.x + projX) / 2;
        const projMidY = (p.y + projY) / 2;

        const ox = con.layoutOffsetX || 0;
        const oy = con.layoutOffsetY || 0;
        if (Math.hypot(ox, oy) > 2) {
            const leaderLine = new Konva.Line({
                points: [projMidX, projMidY, labelPos.x, labelPos.y],
                stroke: 'rgba(148, 163, 184, 0.4)',
                strokeWidth: 1,
                dash: [2, 2],
                listening: false
            });
            parentGroup.add(leaderLine);
        }

        const text = new Konva.Text({
            x: labelPos.x,
            y: labelPos.y,
            text: val.toFixed(1),
            fontSize: 10,
            fontFamily: 'sans-serif',
            fill: color,
            listening: true
        });
        text.offsetX(text.width() / 2);
        text.offsetY(text.height() / 2);

        const rect = new Konva.Rect({
            x: labelPos.x - text.width()/2 - 2,
            y: labelPos.y - text.height()/2 - 1,
            width: text.width() + 4,
            height: text.height() + 2,
            fill: 'white',
            listening: true
        });

        parentGroup.add(rect);
        parentGroup.add(text);
    }

    private drawHorizVertConstraint(
        type: 'horizontal' | 'vertical',
        p1: GCSPoint,
        p2: GCSPoint,
        color: string,
        parentGroup: any
    ) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const nx = -dy / len;
        const ny = dx / len;

        const labelX = mx + nx * 12;
        const labelY = my + ny * 12;

        const label = new Konva.Label({
            x: labelX,
            y: labelY,
            listening: true
        });

        label.add(new Konva.Tag({
            fill: 'rgba(241, 245, 249, 0.9)',
            stroke: color,
            strokeWidth: 1,
            cornerRadius: 2
        }));

        label.add(new Konva.Text({
            text: type === 'horizontal' ? 'H' : 'V',
            fontSize: 9,
            padding: 2,
            fontFamily: 'monospace',
            fill: color
        }));

        label.offsetX(label.width() / 2);
        label.offsetY(label.height() / 2);

        parentGroup.add(label);
    }

    private drawParallelPerpConstraint(
        type: 'parallel' | 'perpendicular',
        l1p1: GCSPoint,
        l1p2: GCSPoint,
        l2p1: GCSPoint,
        l2p2: GCSPoint,
        color: string,
        parentGroup: any
    ) {
        const drawIconAt = (mx: number, my: number, nx: number, ny: number) => {
            const labelX = mx + nx * 12;
            const labelY = my + ny * 12;

            const label = new Konva.Label({
                x: labelX,
                y: labelY,
                listening: true
            });

            label.add(new Konva.Tag({
                fill: 'rgba(241, 245, 249, 0.9)',
                stroke: color,
                strokeWidth: 1,
                cornerRadius: 2
            }));

            label.add(new Konva.Text({
                text: type === 'parallel' ? '//' : '⊥',
                fontSize: 9,
                padding: 2,
                fontFamily: 'monospace',
                fill: color
            }));

            label.offsetX(label.width() / 2);
            label.offsetY(label.height() / 2);

            parentGroup.add(label);
        };

        const m1x = (l1p1.x + l1p2.x) / 2;
        const m1y = (l1p1.y + l1p2.y) / 2;
        const l1dx = l1p2.x - l1p1.x;
        const l1dy = l1p2.y - l1p1.y;
        const l1len = Math.hypot(l1dx, l1dy);
        if (l1len > 0) {
            drawIconAt(m1x, m1y, -l1dy / l1len, l1dx / l1len);
        }

        const m2x = (l2p1.x + l2p2.x) / 2;
        const m2y = (l2p1.y + l2p2.y) / 2;
        const l2dx = l2p2.x - l2p1.x;
        const l2dy = l2p2.y - l2p1.y;
        const l2len = Math.hypot(l2dx, l2dy);
        if (l2len > 0) {
            drawIconAt(m2x, m2y, -l2dy / l2len, l2dx / l2len);
        }
    }

    private drawCoincidentConstraint(p1: GCSPoint, color: string, parentGroup: any) {
        const ring = new Konva.Ring({
            x: p1.x,
            y: p1.y,
            innerRadius: 7,
            outerRadius: 8.5,
            fill: color,
            listening: true,
            opacity: 0.8
        });
        parentGroup.add(ring);
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
            return this.isConstraintEntityHovered(hoveredConstraintId, entityId);
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

        // Draw constraints annotations
        this.drawConstraints();

        // Draw active dimension preview
        if (this.tempDimensionPreview) {
            const { type, entityIds, mousePos } = this.tempDimensionPreview;
            if (type === 'point_line_distance') {
                const p = this.model.getPoint(entityIds[0]);
                const l = this.model.getLine(entityIds[1]);
                if (p && l) {
                    const lp1 = this.model.getPoint(l.p1Id);
                    const lp2 = this.model.getPoint(l.p2Id);
                    if (lp1 && lp2) {
                        const previewColor = 'rgba(100, 116, 139, 0.6)';
                        const ux = lp2.x - lp1.x;
                        const uy = lp2.y - lp1.y;
                        const len2 = ux*ux + uy*uy;
                        let projX = lp1.x;
                        let projY = lp1.y;
                        if (len2 > 0) {
                            const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
                            projX = lp1.x + t * ux;
                            projY = lp1.y + t * uy;
                        }
                        const val = Math.hypot(p.x - projX, p.y - projY);

                        const previewGroup = new Konva.Group({ listening: false });
                        this.drawPointLineDistanceConstraintPreview(p, lp1, lp2, val, mousePos, previewColor, previewGroup);
                        this.mainLayer.add(previewGroup);
                    }
                }
            } else {
                const p1 = this.model.getPoint(entityIds[0]);
                const p2 = this.model.getPoint(entityIds[1]);
                if (p1 && p2) {
                    const previewColor = 'rgba(100, 116, 139, 0.6)';
                    const val = (type === 'horizontal_distance') ? Math.abs(p2.x - p1.x)
                              : (type === 'vertical_distance') ? Math.abs(p2.y - p1.y)
                              : Math.hypot(p2.x - p1.x, p2.y - p1.y);

                    const previewGroup = new Konva.Group({ listening: false });
                    this.drawDistanceConstraintPreview(type, p1, p2, val, mousePos, previewColor, previewGroup);
                    this.mainLayer.add(previewGroup);
                }
            }
        }

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
            return this.isConstraintEntityHovered(hoveredConstraintId, entityId);
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

        // Update Constraints
        this.model.getConstraints().forEach(con => {
            const conGroup = this.mainLayer.findOne('#' + con.id) as any;
            if (!conGroup) return;

            const isSelected = selectedEntityIds.includes(con.id);
            const isHovered = hoveredConstraintId === con.id;
            const color = isSelected || isHovered ? '#3b82f6' : 'rgba(148, 163, 184, 0.6)';
            const strokeWidth = isSelected || isHovered ? 2 : 1.2;

            conGroup.getChildren().forEach((child: any) => {
                if (child.className === 'Line' || child.className === 'Arrow' || child.className === 'Ring') {
                    child.stroke(color);
                    if (child.className === 'Arrow') {
                        child.strokeWidth(strokeWidth);
                    }
                } else if (child.className === 'Text') {
                    child.fill(color);
                } else if (child.className === 'Label') {
                    const tag = child.getTag();
                    if (tag) tag.stroke(color);
                    const text = child.getText();
                    if (text) text.fill(color);
                }
            });
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
            if (pos) {
                if (this.draggedConstraintId !== null) {
                    const con = this.model.getConstraint(this.draggedConstraintId);
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
                            this.model.updateConstraint(con);
                            this.redrawAll();
                        }
                    }
                }

                if (this.onStageMouseMove) {
                    this.onStageMouseMove(pos, e);
                }
            }
        });

        this.stage.on('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.stage.container().style.cursor = 
                    this.model.getTool() === 'select' ? 'default' : 'crosshair';
            }

            if (this.draggedConstraintId !== null) {
                this.draggedConstraintId = null;
                if (this.onDragEnd) this.onDragEnd();
                this.redrawAll();
            }
        });

        this.stage.on('mouseleave', () => {
            this.updateSnapIndicator(0, 0, false);
            this.clearPointPreview();
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

    private drawPointLineDistanceConstraintPreview(
        p: GCSPoint,
        lp1: GCSPoint,
        lp2: GCSPoint,
        val: number,
        mousePos: { x: number; y: number },
        color: string,
        parent: any
    ) {
        const ux = lp2.x - lp1.x;
        const uy = lp2.y - lp1.y;
        const len2 = ux*ux + uy*uy;
        let projX = lp1.x;
        let projY = lp1.y;
        if (len2 > 0) {
            const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
            projX = lp1.x + t * ux;
            projY = lp1.y + t * uy;
        }

        const perpLine = new Konva.Line({
            points: [p.x, p.y, projX, projY],
            stroke: color,
            strokeWidth: 1,
            dash: [3, 3],
            listening: false
        });
        parent.add(perpLine);

        const projMidX = (p.x + projX) / 2;
        const projMidY = (p.y + projY) / 2;

        const leaderLine = new Konva.Line({
            points: [projMidX, projMidY, mousePos.x, mousePos.y],
            stroke: 'rgba(148, 163, 184, 0.2)',
            strokeWidth: 0.8,
            dash: [2, 2],
            listening: false
        });
        parent.add(leaderLine);

        const text = new Konva.Text({
            x: mousePos.x,
            y: mousePos.y,
            text: val.toFixed(1),
            fontSize: 9,
            fontFamily: 'sans-serif',
            fill: color,
            listening: false
        });
        text.offsetX(text.width() / 2);
        text.offsetY(text.height() / 2);

        const rect = new Konva.Rect({
            x: mousePos.x - text.width()/2 - 2,
            y: mousePos.y - text.height()/2 - 1,
            width: text.width() + 4,
            height: text.height() + 2,
            fill: 'white',
            listening: false
        });

        parent.add(rect);
        parent.add(text);
    }

    private drawDistanceConstraintPreview(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance',
        p1: GCSPoint,
        p2: GCSPoint,
        val: number,
        mousePos: { x: number; y: number },
        color: string,
        parent: any
    ) {
        let d1x = p1.x, d1y = p1.y;
        let d2x = p2.x, d2y = p2.y;
        let ext1StartX = p1.x, ext1StartY = p1.y;
        let ext2StartX = p2.x, ext2StartY = p2.y;

        if (type === 'distance') {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len === 0) return;
            const nx = -dy / len;
            const ny = dx / len;

            const cx = (p1.x + p2.x) / 2;
            const cy = (p1.y + p2.y) / 2;
            const mx = mousePos.x - cx;
            const my = mousePos.y - cy;
            const offset = mx * nx + my * ny;

            d1x = p1.x + nx * offset;
            d1y = p1.y + ny * offset;
            d2x = p2.x + nx * offset;
            d2y = p2.y + ny * offset;

        } else if (type === 'horizontal_distance') {
            d1x = p1.x;
            d1y = mousePos.y;
            d2x = p2.x;
            d2y = mousePos.y;

        } else if (type === 'vertical_distance') {
            d1x = mousePos.x;
            d1y = p1.y;
            d2x = mousePos.x;
            d2y = p2.y;
        }

        const ext1 = new Konva.Line({
            points: [ext1StartX, ext1StartY, d1x, d1y],
            stroke: 'rgba(148, 163, 184, 0.2)',
            strokeWidth: 1,
            dash: [2, 2],
            listening: false
        });
        const ext2 = new Konva.Line({
            points: [ext2StartX, ext2StartY, d2x, d2y],
            stroke: 'rgba(148, 163, 184, 0.2)',
            strokeWidth: 1,
            dash: [2, 2],
            listening: false
        });
        parent.add(ext1);
        parent.add(ext2);

        const mx = (d1x + d2x) / 2;
        const my = (d1y + d2y) / 2;

        const arrow1 = new Konva.Arrow({
            points: [mx, my, d1x, d1y],
            stroke: color,
            strokeWidth: 1,
            pointerLength: 5,
            pointerWidth: 3,
            listening: false
        });
        const arrow2 = new Konva.Arrow({
            points: [mx, my, d2x, d2y],
            stroke: color,
            strokeWidth: 1,
            pointerLength: 5,
            pointerWidth: 3,
            listening: false
        });
        parent.add(arrow1);
        parent.add(arrow2);

        const text = new Konva.Text({
            x: mx,
            y: my,
            text: val.toFixed(1),
            fontSize: 9,
            fontFamily: 'sans-serif',
            fill: color,
            listening: false
        });
        text.offsetX(text.width() / 2);
        text.offsetY(text.height() / 2);

        const rect = new Konva.Rect({
            x: mx - text.width()/2 - 2,
            y: my - text.height()/2 - 1,
            width: text.width() + 4,
            height: text.height() + 2,
            fill: 'white',
            listening: false
        });

        parent.add(rect);
        parent.add(text);
    }

    public calculateConstraintOffset(con: GCSConstraint, mousePos: { x: number; y: number }): number | { x: number; y: number } | null {
        switch (con.type) {
            case 'distance': {
                const p1 = this.model.getPoint(con.p1Id);
                const p2 = this.model.getPoint(con.p2Id);
                if (!p1 || !p2) return null;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy);
                if (len === 0) return null;
                const nx = -dy / len;
                const ny = dx / len;
                const cx = (p1.x + p2.x) / 2;
                const cy = (p1.y + p2.y) / 2;
                return (mousePos.x - cx) * nx + (mousePos.y - cy) * ny;
            }
            case 'horizontal_distance': {
                const p1 = this.model.getPoint(con.p1Id);
                const p2 = this.model.getPoint(con.p2Id);
                if (!p1 || !p2) return null;
                const minY = Math.min(p1.y, p2.y);
                return mousePos.y - minY;
            }
            case 'vertical_distance': {
                const p1 = this.model.getPoint(con.p1Id);
                const p2 = this.model.getPoint(con.p2Id);
                if (!p1 || !p2) return null;
                const maxX = Math.max(p1.x, p2.x);
                return mousePos.x - maxX;
            }
            case 'point_line_distance': {
                const p = this.model.getPoint(con.pointId);
                const l = this.model.getLine(con.lineId);
                if (!p || !l) return null;
                const lp1 = this.model.getPoint(l.p1Id);
                const lp2 = this.model.getPoint(l.p2Id);
                if (!lp1 || !lp2) return null;
                const ux = lp2.x - lp1.x;
                const uy = lp2.y - lp1.y;
                const len2 = ux*ux + uy*uy;
                let projX = lp1.x;
                let projY = lp1.y;
                if (len2 > 0) {
                    const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
                    projX = lp1.x + t * ux;
                    projY = lp1.y + t * uy;
                }
                const cx = (p.x + projX) / 2;
                const cy = (p.y + projY) / 2;
                return { x: mousePos.x - cx, y: mousePos.y - cy };
            }
        }
        return null;
    }
}
