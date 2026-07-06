import { GCSSolver, GCSSketchState, GCSPoint, GCSCircle, SolverResult } from '../../../ts/gcsapi/dist/index.js';
import { SketchModel, cloneSketch } from './sketch.js';

/**
 * Details of a temporary point pin constraint applied during interactive drag operations.
 * Captures the original fixed/free state of the entity so it can be restored post-solve.
 */
interface DragOverride {
    /** The reference to the GCSPoint being dragged. */
    point: GCSPoint;
    /** The original fixed state of the point prior to dragging. */
    originalFixedState: boolean;
}

/**
 * GCSBridge acts as the high-level application adapter between the WebCAD sketch model
 * and the low-level GCSSolver WebAssembly execution environment.
 * 
 * It manages state serialization, defensive cloning, constraint solving, and temporary
 * geometry constraint overrides (e.g., pinning a point to follow the user's mouse position).
 */
export class GCSBridge {
    /** The underlying low-level WebAssembly solver wrapper. */
    private readonly gcs = new GCSSolver();
    /** Flag indicating whether the WebAssembly binary was successfully instantiated. */
    private isInitialized = false;

    /**
     * Initializes the solver's WebAssembly module.
     * 
     * In browser environments, it fetches the compiled solver binary from the server.
     * In headless environments, it receives a pre-loaded Uint8Array buffer of the WASM file.
     *
     * @param wasmSource Server asset URL path or raw binary buffer representing the WASM module.
     * @returns A promise that resolves when the WebAssembly module has loaded and run.
     */
    async init(wasmSource: string | Uint8Array = '/ui/wasm_solver.wasm'): Promise<void> {
        if (this.isInitialized) return;
        await this.gcs.initGoWasm(wasmSource);
        this.isInitialized = true;
    }

    /**
     * Executes the geometric constraint solver on the provided sketch layout.
     * 
     * To protect the application's active state from corrupt geometry in case of a solver
     * stall or over-constrained layout, this method runs solves on a cloned workspace copy,
     * returning the updated copy only upon a successful solve.
     *
     * @param sketch The active CAD workspace sketch containing points, lines, circles, and constraints.
     * @param draggedPointId Optional ID of the point entity currently being dragged by the user.
     * @returns An object indicating the success status, the solved/original sketch, and any optional error messages.
     */
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

    /**
     * Pins the dragged point by setting its fixed status to true.
     * 
     * This forces the solver to treat the dragged point's current coordinates as fixed anchor positions,
     * resolving the positions of all other free-floating entities around it.
     *
     * @param sketch The cloned sketch workspace.
     * @param draggedPointId The ID of the point to temporarily pin.
     * @returns The override capture details, or null if no point is currently being dragged.
     */
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

    /**
     * Restores the original fixed/free state of the dragged point after the solver completes execution.
     *
     * @param override The override details captured at the beginning of the solve.
     */
    private restoreDragOverride(override: DragOverride | null): void {
        if (override) {
            override.point.fixed = override.originalFixedState;
        }
    }

    /**
     * Maps solved coordinate and radius updates from the solver result back into the application's sketch model.
     *
     * @param sketch The sketch model to mutate.
     * @param result The constraint solver output details containing updated coordinate variables.
     */
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
