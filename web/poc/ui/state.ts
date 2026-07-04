import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../gcsapi/gcsapi.js';

export type ToolMode = 'select' | 'point' | 'line' | 'circle' | 'dimension';

export type StateCallback = () => void;

/**
 * Manages the core sketch state, selection state, active tool, and hover states.
 * Uses an event-emitter pattern to notify subscribers (e.g. Viewport, Sidebar) of updates.
 */
export class SketchStateModel {
    private points: GCSPoint[] = [];
    private lines: GCSLine[] = [];
    private circles: GCSCircle[] = [];
    private constraints: GCSConstraint[] = [];

    private selectedEntityIds: string[] = [];
    private hoveredEntityId: string | null = null;
    private hoveredConstraintId: string | null = null;
    private currentTool: ToolMode = 'select';

    private listeners: { [event: string]: StateCallback[] } = {};

    /**
     * Subscribe to state change events.
     */
    on(event: string, callback: StateCallback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * Notify all subscribers of an event.
     */
    private emit(event: string) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try {
                    cb();
                } catch (err) {
                    console.error(`Error in state listener for event "${event}":`, err);
                }
            });
        }
    }

    // --- Entity Getters ---

    getPoints(): GCSPoint[] {
        return this.points;
    }

    getLines(): GCSLine[] {
        return this.lines;
    }

    getCircles(): GCSCircle[] {
        return this.circles;
    }

    getConstraints(): GCSConstraint[] {
        return this.constraints;
    }

    getPoint(id: string): GCSPoint | undefined {
        return this.points.find(p => p.id === id);
    }

    getLine(id: string): GCSLine | undefined {
        return this.lines.find(l => l.id === id);
    }

    getCircle(id: string): GCSCircle | undefined {
        return this.circles.find(c => c.id === id);
    }

    getConstraint(id: string): GCSConstraint | undefined {
        return this.constraints.find(c => c.id === id);
    }

    // --- Mutators ---

    setSketchData(data: { points: GCSPoint[]; lines: GCSLine[]; circles: GCSCircle[]; constraints: GCSConstraint[] }) {
        this.points = data.points || [];
        this.lines = data.lines || [];
        this.circles = data.circles || [];
        this.constraints = data.constraints || [];
        this.emit('change');
    }

    addPoint(p: GCSPoint) {
        this.points.push(p);
        this.emit('change');
    }

    addLine(l: GCSLine) {
        this.lines.push(l);
        this.emit('change');
    }

    addCircle(c: GCSCircle) {
        this.circles.push(c);
        this.emit('change');
    }

    addConstraint(c: GCSConstraint) {
        this.constraints.push(c);
        this.emit('change');
    }

    updateConstraint(c: GCSConstraint) {
        const idx = this.constraints.findIndex(x => x.id === c.id);
        if (idx > -1) {
            this.constraints[idx] = c;
            this.emit('change');
        }
    }

    deleteEntity(id: string) {
        // 1. Remove entity
        this.points = this.points.filter(p => p.id !== id);
        this.lines = this.lines.filter(l => l.id !== id);
        this.circles = this.circles.filter(c => c.id !== id);

        // 2. Cascade delete lines/circles linked to deleted points
        if (/^P\d+$/.test(id)) {
            this.lines = this.lines.filter(l => l.p1Id !== id && l.p2Id !== id);
            this.circles = this.circles.filter(c => c.centerId !== id);
        }

        // 3. Cascade delete constraints referencing deleted items
        this.constraints = this.constraints.filter(con => {
            switch (con.type) {
                case 'coincident':
                case 'distance':
                case 'horizontal_distance':
                case 'vertical_distance':
                    return con.p1Id !== id && con.p2Id !== id;
                case 'point_line_distance':
                    return con.pointId !== id && con.lineId !== id;
                case 'vertical':
                case 'horizontal':
                    return con.lineId !== id;
                case 'parallel':
                case 'perpendicular':
                    return con.line1Id !== id && con.line2Id !== id;
            }
            return true;
        });

        this.selectedEntityIds = this.selectedEntityIds.filter(x => x !== id);
        this.emit('change');
    }

    deleteConstraint(id: string) {
        this.constraints = this.constraints.filter(c => c.id !== id);
        this.emit('change');
    }

    removeConstraint(id: string) {
        this.constraints = this.constraints.filter(c => c.id !== id);
        this.emit('change');
    }

    clear() {
        this.points = [];
        this.lines = [];
        this.circles = [];
        this.constraints = [];
        this.selectedEntityIds = [];
        this.hoveredEntityId = null;
        this.hoveredConstraintId = null;
        this.emit('change');
    }

    // --- Tool State ---

    getTool(): ToolMode {
        return this.currentTool;
    }

    setTool(tool: ToolMode) {
        if (this.currentTool !== tool) {
            this.currentTool = tool;
            this.emit('tool-change');
            this.emit('change');
        }
    }

    // --- Selection State ---

    getSelectedEntityIds(): string[] {
        return this.selectedEntityIds;
    }

    setSelectedEntityIds(ids: string[]) {
        this.selectedEntityIds = [...ids];
        this.emit('change');
    }

    toggleSelect(id: string) {
        const idx = this.selectedEntityIds.indexOf(id);
        if (idx > -1) {
            this.selectedEntityIds.splice(idx, 1);
        } else {
            this.selectedEntityIds.push(id);
        }
        this.emit('change');
    }

    clearSelection() {
        if (this.selectedEntityIds.length > 0) {
            this.selectedEntityIds = [];
            this.emit('change');
        }
    }

    // --- Hover State ---

    getHoveredEntityId(): string | null {
        return this.hoveredEntityId;
    }

    setHoveredEntityId(id: string | null) {
        if (this.hoveredEntityId !== id) {
            this.hoveredEntityId = id;
            this.emit('hover-change');
        }
    }

    getHoveredConstraintId(): string | null {
        return this.hoveredConstraintId;
    }

    setHoveredConstraintId(id: string | null) {
        if (this.hoveredConstraintId !== id) {
            this.hoveredConstraintId = id;
            this.emit('hover-change');
        }
    }

    generateNextId(prefix: string): string {
        let maxNum = 0;
        const regex = new RegExp(`^${prefix}(\\d+)$`);
        const checkId = (id: string) => {
            const match = id.match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        };
        this.points.forEach(p => checkId(p.id));
        this.lines.forEach(l => checkId(l.id));
        this.circles.forEach(c => checkId(c.id));
        this.constraints.forEach(con => checkId(con.id));
        return `${prefix}${maxNum + 1}`;
    }

    makeUniqueConstraintId(baseId: string): string {
        let candidate = baseId;
        let counter = 1;
        while (this.constraints.some(c => c.id === candidate)) {
            candidate = `${baseId}_${counter}`;
            counter++;
        }
        return candidate;
    }
}
