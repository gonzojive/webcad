import { GCSSolver, GCSSketchState, GCSPoint, GCSCircle, SolverResult } from '../../../ts/gcsapi/dist/index.js';
import { SketchModel, cloneSketch } from './sketch.js';

interface DragOverride {
    point: GCSPoint;
    originalFixedState: boolean;
}

export class GCSBridge {
    private readonly gcs = new GCSSolver();
    private isInitialized = false;

    async init(wasmSource: string | Uint8Array = '/ui/wasm_solver.wasm'): Promise<void> {
        if (this.isInitialized) return;
        await this.gcs.initGoWasm(wasmSource);
        this.isInitialized = true;
    }

    solve(sketch: SketchModel, draggedPointId: string | null = null): { success: boolean; sketch: SketchModel; error?: string } {
        if (!this.isInitialized) {
            return { success: false, sketch, error: 'Solver not initialized' };
        }

        // Clone sketch to avoid mutating the input state directly
        const cloned = cloneSketch(sketch);

        // Temporarily fix the dragged point so the GCS solves around it
        const override = this.applyDragOverride(cloned, draggedPointId);

        const state: GCSSketchState = {
            points: cloned.points,
            lines: cloned.lines,
            circles: cloned.circles,
            constraints: cloned.constraints
        };

        try {
            const result = this.gcs.solve(state);

            this.restoreDragOverride(override);

            if (result.success) {
                this.applySolveResult(cloned, result);
                return { success: true, sketch: cloned };
            } else {
                return { success: false, sketch, error: result.error || 'Over-constrained' };
            }
        } catch (e: any) {
            this.restoreDragOverride(override);
            return { success: false, sketch, error: e.message || String(e) };
        }
    }

    private applyDragOverride(sketch: SketchModel, draggedPointId: string | null): DragOverride | null {
        if (!draggedPointId) return null;
        const tempFixedPoint = sketch.points.find(p => p.id === draggedPointId);
        if (tempFixedPoint) {
            const originalFixedState = !!tempFixedPoint.fixed;
            tempFixedPoint.fixed = true;
            return { point: tempFixedPoint, originalFixedState };
        }
        return null;
    }

    private restoreDragOverride(override: DragOverride | null): void {
        if (override) {
            override.point.fixed = override.originalFixedState;
        }
    }

    private applySolveResult(sketch: SketchModel, result: SolverResult): void {
        // Update point positions
        result.points.forEach((sp) => {
            const p = sketch.points.find(x => x.id === sp.id);
            if (p) {
                p.x = sp.x;
                p.y = sp.y;
            }
        });

        // Update circle radius values
        result.circles.forEach((sc) => {
            const c = sketch.circles.find(x => x.id === sc.id);
            if (c) {
                c.radius = sc.radius;
            }
        });
    }
}
