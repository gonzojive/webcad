import { GCSConstraint, GCSPoint, GCSLine } from '../../../../../ts/gcsapi/dist/index.js';
import { Vector2D, dist } from '../../../geometry/vector.js';
import { projectPointOntoLine } from '../../../geometry/project.js';

declare const Konva: any;

export interface AnnotationDrawerCallbacks {
    onLabelDragStart(constraintId: string, initialOffset: number | { x: number; y: number }): void;
}

export interface WorkspaceLookup {
    getPoint(id: string): GCSPoint | undefined;
    getLine(id: string): GCSLine | undefined;
    getConstraint(id: string): GCSConstraint | undefined;
}

export class AnnotationDrawer {
    constructor(
        private readonly workspace: WorkspaceLookup,
        private readonly callbacks: AnnotationDrawerCallbacks
    ) {}

    drawConstraints(
        layer: any,
        constraints: GCSConstraint[],
        hoveredConstraintId: string | null,
        invS: number,
        stageContainer: HTMLDivElement,
        onMouseEnter: (conId: string) => void,
        onMouseLeave: (conId: string) => void
    ) {
        constraints.forEach(con => {
            const isHovered = hoveredConstraintId === con.id;
            const color = isHovered ? 'var(--accent-color)' : 'rgba(148, 163, 184, 0.85)';
            const strokeWidth = (isHovered ? 2.5 : 1.25) * invS;

            const conGroup = new Konva.Group({
                id: con.id,
                listening: true
            });

            conGroup.on('mouseenter', () => {
                onMouseEnter(con.id);
            });
            conGroup.on('mouseleave', () => {
                onMouseLeave(con.id);
            });

            if (con.type === 'coincident') {
                const p1 = this.workspace.getPoint(con.p1Id);
                if (p1) this.drawCoincidentConstraint(p1, color, conGroup, invS);
            } else if (con.type === 'distance' || con.type === 'horizontalDistance' || con.type === 'verticalDistance') {
                const p1 = this.workspace.getPoint(con.p1Id);
                const p2 = this.workspace.getPoint(con.p2Id);
                if (p1 && p2) {
                    this.drawDistanceConstraint(con.type, p1, p2, con.value, color, strokeWidth, conGroup, con, invS);
                }
            } else if (con.type === 'pointLineDistance') {
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

            layer.add(conGroup);
        });
    }

    drawPreview(
        layer: any,
        type: 'distance' | 'horizontalDistance' | 'verticalDistance' | 'pointLineDistance',
        entityIds: string[],
        mousePos: Vector2D,
        color: string,
        invS: number
    ) {
        const previewGroup = new Konva.Group({ listening: false });
        if (type === 'pointLineDistance') {
            const p = this.workspace.getPoint(entityIds[0]);
            const l = this.workspace.getLine(entityIds[1]);
            if (p && l) {
                const lp1 = this.workspace.getPoint(l.p1Id);
                const lp2 = this.workspace.getPoint(l.p2Id);
                if (lp1 && lp2) {
                    const proj = projectPointOntoLine(p, lp1, lp2);
                    const val = dist(p, proj);
                    this.drawPointLineDistanceConstraintPreview(p, lp1, lp2, val, mousePos, color, previewGroup, invS);
                }
            }
        } else {
            const p1 = this.workspace.getPoint(entityIds[0]);
            const p2 = this.workspace.getPoint(entityIds[1]);
            if (p1 && p2) {
                const val = type === 'horizontalDistance' ? Math.abs(p2.x - p1.x)
                    : type === 'verticalDistance' ? Math.abs(p2.y - p1.y)
                    : dist(p1, p2);
                this.drawDistanceConstraintPreview(type, p1, p2, val, mousePos, color, previewGroup, invS);
            }
        }
        layer.add(previewGroup);
    }

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
        type: 'distance' | 'horizontalDistance' | 'verticalDistance',
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

        const offset = (con as any).layoutOffset !== undefined ? (con as any).layoutOffset : 30;

        let ap1X = 0, ap1Y = 0, ap2X = 0, ap2Y = 0;

        if (type === 'distance') {
            const nx = -dy / len;
            const ny = dx / len;
            const offX = nx * offset;
            const offY = ny * offset;
            ap1X = p1.x + offX;
            ap1Y = p1.y + offY;
            ap2X = p2.x + offX;
            ap2Y = p2.y + offY;
        } else if (type === 'horizontalDistance') {
            const yLevel = ((p1.y + p2.y) / 2) + offset;
            ap1X = p1.x;
            ap1Y = yLevel;
            ap2X = p2.x;
            ap2Y = yLevel;
        } else if (type === 'verticalDistance') {
            const xLevel = ((p1.x + p2.x) / 2) + offset;
            ap1X = xLevel;
            ap1Y = p1.y;
            ap2X = xLevel;
            ap2Y = p2.y;
        }

        if (type === 'horizontalDistance') {
            const ext1 = new Konva.Line({ points: [p1.x, p1.y, p1.x, ap1Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            const ext2 = new Konva.Line({ points: [p2.x, p2.y, p2.x, ap2Y], stroke: 'rgba(148, 163, 184, 0.4)', strokeWidth: 1 * invS, dash: [4, 4] });
            parentGroup.add(ext1, ext2);
        } else if (type === 'verticalDistance') {
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
            this.callbacks.onLabelDragStart(con.id, offset);
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
            this.callbacks.onLabelDragStart(con.id, { x: offX, y: offY });
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
        type: 'distance' | 'horizontalDistance' | 'verticalDistance',
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

        let ap1X = 0, ap1Y = 0, ap2X = 0, ap2Y = 0;

        if (type === 'distance') {
            const nx = -dy / len;
            const ny = dx / len;
            const mx = mousePos.x - (p1.x + p2.x)/2;
            const my = mousePos.y - (p1.y + p2.y)/2;
            const offset = mx * nx + my * ny;
            const offX = nx * offset;
            const offY = ny * offset;
            ap1X = p1.x + offX;
            ap1Y = p1.y + offY;
            ap2X = p2.x + offX;
            ap2Y = p2.y + offY;
        } else if (type === 'horizontalDistance') {
            const yLevel = mousePos.y;
            ap1X = p1.x;
            ap1Y = yLevel;
            ap2X = p2.x;
            ap2Y = yLevel;
        } else if (type === 'verticalDistance') {
            const xLevel = mousePos.x;
            ap1X = xLevel;
            ap1Y = p1.y;
            ap2X = xLevel;
            ap2Y = p2.y;
        }

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

    calculateConstraintOffset(con: GCSConstraint, mousePos: Vector2D): number | { x: number; y: number } | null {
        if (con.type === 'pointLineDistance') {
            const p = this.workspace.getPoint(con.pointId);
            if (!p) return null;
            return {
                x: mousePos.x - p.x,
                y: mousePos.y - p.y
            };
        } else if (con.type === 'distance' || con.type === 'horizontalDistance' || con.type === 'verticalDistance') {
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
            } else if (con.type === 'horizontalDistance') {
                nx = 0;
                ny = 1;
            } else if (con.type === 'verticalDistance') {
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
