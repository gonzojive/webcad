import { Injectable, signal, computed } from '@angular/core';
import { Document, createEmptyDocument } from '../../../model/document.js';
import { SketchModel, createEmptySketch, cloneSketchForMutation } from '../../../model/sketch.js';
import { HistoryManager } from '../../../model/history.js';
import { GCSBridge } from '../../../model/gcs_bridge.js';
import { Vector2D } from '../../../geometry/vector.js';
import { ToolContext } from '../../../tools/tool.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../../../../../ts/gcsapi/dist/index.js';
import { Unit } from '../../../units/units.js';
import { SketchStore } from '../../../model/store.js';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService implements ToolContext {
    private readonly history = new HistoryManager();
    private readonly bridge = new GCSBridge();
    private readonly store = new SketchStore();
    
    // Signals
    readonly document = signal<Document>(createEmptyDocument('mm'));
    readonly selectedEntityIds = signal<string[]>([]);
    readonly hoveredEntityId = signal<string | null>(null);
    readonly hoveredConstraintId = signal<string | null>(null);
    readonly solverStatus = signal<string>('GCS Ready');
    readonly solverStatusType = signal<'success' | 'danger' | 'warning'>('success');
    
    private readonly historyVersion = signal(0);
    
    // Computed signals for UI binding
    readonly sketch = computed(() => this.document().sketch);
    readonly points = computed(() => this.sketch().points);
    readonly lines = computed(() => this.sketch().lines);
    readonly circles = computed(() => this.sketch().circles);
    readonly constraints = computed(() => this.sketch().constraints);
    readonly preferredUnit = computed(() => this.document().preferredUnit);
    
    readonly canUndo = computed(() => {
        this.historyVersion();
        return this.history.canUndo();
    });
    readonly canRedo = computed(() => {
        this.historyVersion();
        return this.history.canRedo();
    });
    
    // Inline dimension input request state
    readonly activeDimensionInputRequest = signal<{
        pos: Vector2D;
        defaultValue: number;
        callback: (val: number) => void;
        onCancel?: () => void;
    } | null>(null);

    constructor() {
        this.initSolver();
    }

    private async initSolver() {
        this.solverStatus.set('Loading GCS...');
        try {
            await this.bridge.init();
            const saved = await this.store.load();
            if (saved) {
                this.updateSketch(saved, false);
                this.history.clear(saved);
            } else {
                this.history.clear(this.document().sketch);
            }
            this.historyVersion.update(v => v + 1);
            this.solverStatus.set('GCS Solver Ready');
            this.solverStatusType.set('success');
        } catch (e) {
            this.solverStatus.set('Solver Error');
            this.solverStatusType.set('danger');
        }
    }

    // --- ToolContext Implementation ---

    getPoints(): GCSPoint[] { return this.points(); }
    getLines(): GCSLine[] { return this.lines(); }
    getCircles(): GCSCircle[] { return this.circles(); }
    getConstraints(): GCSConstraint[] { return this.constraints(); }

    getPoint(id: string): GCSPoint | undefined {
        return this.points().find(p => p.id === id);
    }
    getLine(id: string): GCSLine | undefined {
        return this.lines().find(l => l.id === id);
    }
    getCircle(id: string): GCSCircle | undefined {
        return this.circles().find(c => c.id === id);
    }
    getConstraint(id: string): GCSConstraint | undefined {
        return this.constraints().find(c => c.id === id);
    }

    getSelectedEntityIds(): string[] { return this.selectedEntityIds(); }
    setSelectedEntityIds(ids: string[]): void { this.selectedEntityIds.set(ids); }

    setHoveredEntityId(id: string | null): void { this.hoveredEntityId.set(id); }
    setHoveredConstraintId(id: string | null): void { this.hoveredConstraintId.set(id); }

    generateNextId(prefix: string): string {
        const sketch = this.document().sketch;
        let counter = 1;
        
        const exists = (id: string) => {
            return sketch.points.some(p => p.id === id) ||
                   sketch.lines.some(l => l.id === id) ||
                   sketch.circles.some(c => c.id === id) ||
                   sketch.constraints.some(c => c.id === id);
        };
        
        while (exists(`${prefix}${counter}`)) {
            counter++;
        }
        return `${prefix}${counter}`;
    }

    solve(draggedPointId: string | null = null): boolean {
        const res = this.bridge.solve(this.document().sketch, draggedPointId);
        
        if (res.success) {
            this.updateSketch(res.sketch, false); // Don't push to history here, let tool commit it
            this.solverStatus.set(draggedPointId ? 'Solving...' : 'Solved Successfully');
            this.solverStatusType.set('success');
            return true;
        } else {
            this.solverStatus.set(res.error || 'Over-constrained');
            this.solverStatusType.set('danger');
            return false;
        }
    }

    commitHistory(): void {
        this.history.pushState(this.document().sketch);
        this.historyVersion.update(v => v + 1);
    }

    requestDimensionInput(
        pos: Vector2D,
        defaultValue: number,
        callback: (val: number) => void,
        onCancel?: () => void
    ): void {
        this.activeDimensionInputRequest.set({ pos, defaultValue, callback, onCancel });
    }

    // --- State Mutators ---

    updateSketch(newSketch: SketchModel, pushHistory = true) {
        this.document.update(doc => ({
            ...doc,
            sketch: newSketch
        }));
        if (pushHistory) {
            this.history.pushState(newSketch);
            this.historyVersion.update(v => v + 1);
        }
        this.store.save(newSketch);
    }

    addPoint(pos: Vector2D): string {
        const id = this.generateNextId('P');
        const sketch = cloneSketchForMutation(this.document().sketch);
        sketch.points.push({ id, x: pos.x, y: pos.y });
        this.updateSketch(sketch, false);
        return id;
    }

    updatePointPosition(id: string, pos: Vector2D) {
        const currentSketch = this.document().sketch;
        const pCurrent = currentSketch.points.find(x => x.id === id);
        if (pCurrent && pCurrent.x === pos.x && pCurrent.y === pos.y) {
            return; // No-op, position didn't change
        }

        const sketch = cloneSketchForMutation(currentSketch);
        const p = sketch.points.find(x => x.id === id);
        if (p) {
            p.x = pos.x;
            p.y = pos.y;
            this.updateSketch(sketch, false);
        }
    }

    addLine(p1Id: string, p2Id: string): string {
        const id = this.generateNextId('L');
        const sketch = cloneSketchForMutation(this.document().sketch);
        sketch.lines.push({ id, p1Id, p2Id });
        this.updateSketch(sketch, false);
        return id;
    }

    addCircle(centerId: string, radius: number): string {
        const id = this.generateNextId('C');
        const sketch = cloneSketchForMutation(this.document().sketch);
        sketch.circles.push({ id, centerId, radius });
        this.updateSketch(sketch, false);
        return id;
    }

    addConstraint(constraint: GCSConstraint): string {
        const sketch = cloneSketchForMutation(this.document().sketch);
        constraint.id = this.makeUniqueConstraintId(constraint.id, sketch);
        sketch.constraints.push(constraint);
        this.updateSketch(sketch, false);
        return constraint.id;
    }

    private makeUniqueConstraintId(id: string, sketch: SketchModel): string {
        let unique = id;
        let counter = 1;
        while (sketch.constraints.some(c => c.id === unique)) {
            unique = `${id}_${counter}`;
            counter++;
        }
        return unique;
    }

    togglePointFixed(pointId: string) {
        const sketch = cloneSketchForMutation(this.document().sketch);
        const p = sketch.points.find(x => x.id === pointId);
        if (p) {
            p.fixed = !p.fixed;
            this.updateSketch(sketch, false);
            this.solve();
            this.commitHistory();
        }
    }

    deleteEntity(id: string, commit = true) {
        const sketch = cloneSketchForMutation(this.document().sketch);
        
        sketch.points = sketch.points.filter(p => p.id !== id);
        sketch.lines = sketch.lines.filter(l => l.id !== id && l.p1Id !== id && l.p2Id !== id);
        sketch.circles = sketch.circles.filter(c => c.id !== id && c.centerId !== id);
        
        sketch.constraints = sketch.constraints.filter(c => {
            const refersTo = (entityId: string) => entityId === id;
            switch (c.type) {
                case 'coincident':
                case 'distance':
                case 'horizontalDistance':
                case 'verticalDistance':
                    return !refersTo(c.p1Id) && !refersTo(c.p2Id);
                case 'pointLineDistance':
                    return !refersTo(c.pointId) && !refersTo(c.lineId);
                case 'vertical':
                case 'horizontal':
                    return !refersTo(c.lineId);
                case 'parallel':
                case 'perpendicular':
                    return !refersTo(c.line1Id) && !refersTo(c.line2Id);
                default:
                    return true;
            }
        });

        this.setSelectedEntityIds(this.selectedEntityIds().filter(x => x !== id));
        this.updateSketch(sketch, false);
        this.solve();
        if (commit) {
            this.commitHistory();
        }
    }

    deleteSelectedEntities() {
        const selected = this.selectedEntityIds();
        if (selected.length === 0) return;

        const sketch = cloneSketchForMutation(this.document().sketch);
        
        sketch.points = sketch.points.filter(p => !selected.includes(p.id));
        sketch.lines = sketch.lines.filter(l => !selected.includes(l.id));
        sketch.circles = sketch.circles.filter(c => !selected.includes(c.id));
        
        sketch.constraints = sketch.constraints.filter(c => {
            const refersToSelected = (id: string) => selected.includes(id);
            switch (c.type) {
                case 'coincident':
                case 'distance':
                case 'horizontalDistance':
                case 'verticalDistance':
                    return !refersToSelected(c.p1Id) && !refersToSelected(c.p2Id);
                case 'pointLineDistance':
                    return !refersToSelected(c.pointId) && !refersToSelected(c.lineId);
                case 'vertical':
                case 'horizontal':
                    return !refersToSelected(c.lineId);
                case 'parallel':
                case 'perpendicular':
                    return !refersToSelected(c.line1Id) && !refersToSelected(c.line2Id);
                default:
                    return true;
            }
        });

        this.setSelectedEntityIds([]);
        this.updateSketch(sketch, false);
        this.solve();
        this.commitHistory();
    }

    deleteConstraint(constraintId: string) {
        const sketch = cloneSketchForMutation(this.document().sketch);
        sketch.constraints = sketch.constraints.filter(c => c.id !== constraintId);
        this.updateSketch(sketch, false);
        this.solve();
        this.commitHistory();
    }

    clearWorkspace() {
        const sketch = createEmptySketch();
        this.updateSketch(sketch, false);
        this.setSelectedEntityIds([]);
        this.commitHistory();
        this.solverStatus.set('GCS Solver Ready');
        this.solverStatusType.set('success');
    }

    undo() {
        const prev = this.history.undo();
        if (prev) {
            this.updateSketch(prev, false);
            this.historyVersion.update(v => v + 1);
            this.solve();
        }
    }

    redo() {
        const next = this.history.redo();
        if (next) {
            this.updateSketch(next, false);
            this.historyVersion.update(v => v + 1);
            this.solve();
        }
    }

    setPreferredUnit(unit: Unit) {
        this.document.update(doc => ({
            ...doc,
            preferredUnit: unit
        }));
    }
}

