/**
 * Manages the core sketch state, selection state, active tool, and hover states.
 * Uses an event-emitter pattern to notify subscribers (e.g. Viewport, Sidebar) of updates.
 */
export class SketchStateModel {
    constructor() {
        this.points = [];
        this.lines = [];
        this.circles = [];
        this.constraints = [];
        this.selectedEntityIds = [];
        this.hoveredEntityId = null;
        this.hoveredConstraintId = null;
        this.currentTool = 'select';
        this.listeners = {};
    }
    /**
     * Subscribe to state change events.
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    /**
     * Notify all subscribers of an event.
     */
    emit(event) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try {
                    cb();
                }
                catch (err) {
                    console.error(`Error in state listener for event "${event}":`, err);
                }
            });
        }
    }
    // --- Entity Getters ---
    getPoints() {
        return this.points;
    }
    getLines() {
        return this.lines;
    }
    getCircles() {
        return this.circles;
    }
    getConstraints() {
        return this.constraints;
    }
    getPoint(id) {
        return this.points.find(p => p.id === id);
    }
    getLine(id) {
        return this.lines.find(l => l.id === id);
    }
    getCircle(id) {
        return this.circles.find(c => c.id === id);
    }
    getConstraint(id) {
        return this.constraints.find(c => c.id === id);
    }
    // --- Mutators ---
    setSketchData(data) {
        this.points = data.points || [];
        this.lines = data.lines || [];
        this.circles = data.circles || [];
        this.constraints = data.constraints || [];
        this.emit('change');
    }
    addPoint(p) {
        this.points.push(p);
        this.emit('change');
    }
    addLine(l) {
        this.lines.push(l);
        this.emit('change');
    }
    addCircle(c) {
        this.circles.push(c);
        this.emit('change');
    }
    addConstraint(c) {
        this.constraints.push(c);
        this.emit('change');
    }
    deleteEntity(id) {
        // 1. Remove entity
        this.points = this.points.filter(p => p.id !== id);
        this.lines = this.lines.filter(l => l.id !== id);
        this.circles = this.circles.filter(c => c.id !== id);
        // 2. Cascade delete lines/circles linked to deleted points
        if (id.startsWith('P_')) {
            this.lines = this.lines.filter(l => l.p1Id !== id && l.p2Id !== id);
            this.circles = this.circles.filter(c => c.centerId !== id);
        }
        // 3. Cascade delete constraints referencing deleted items
        this.constraints = this.constraints.filter(con => {
            switch (con.type) {
                case 'coincident':
                case 'distance':
                    return con.p1Id !== id && con.p2Id !== id;
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
    deleteConstraint(id) {
        this.constraints = this.constraints.filter(c => c.id !== id);
        this.emit('change');
    }
    removeConstraint(id) {
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
    getTool() {
        return this.currentTool;
    }
    setTool(tool) {
        if (this.currentTool !== tool) {
            this.currentTool = tool;
            this.emit('tool-change');
            this.emit('change');
        }
    }
    // --- Selection State ---
    getSelectedEntityIds() {
        return this.selectedEntityIds;
    }
    setSelectedEntityIds(ids) {
        this.selectedEntityIds = [...ids];
        this.emit('change');
    }
    toggleSelect(id) {
        const idx = this.selectedEntityIds.indexOf(id);
        if (idx > -1) {
            this.selectedEntityIds.splice(idx, 1);
        }
        else {
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
    getHoveredEntityId() {
        return this.hoveredEntityId;
    }
    setHoveredEntityId(id) {
        if (this.hoveredEntityId !== id) {
            this.hoveredEntityId = id;
            this.emit('hover-change');
        }
    }
    getHoveredConstraintId() {
        return this.hoveredConstraintId;
    }
    setHoveredConstraintId(id) {
        if (this.hoveredConstraintId !== id) {
            this.hoveredConstraintId = id;
            this.emit('hover-change');
        }
    }
}
