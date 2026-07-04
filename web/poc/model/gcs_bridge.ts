import { GCSapi, GCSSketchState } from '../gcsapi/gcsapi.js';
import { SketchModel, cloneSketch } from './sketch.js';

export class GCSBridge {
    private readonly gcs = new GCSapi();
    private isInitialized = false;

    async init(wasmUrl = '/solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen_bg.wasm'): Promise<void> {
        if (this.isInitialized) return;
        await this.gcs.init(wasmUrl);
        this.isInitialized = true;
    }

    solve(sketch: SketchModel, draggedPointId: string | null = null): { success: boolean; sketch: SketchModel; error?: string } {
        if (!this.isInitialized) {
            return { success: false, sketch, error: 'Solver not initialized' };
        }

        // Clone sketch to avoid mutating the input state directly
        const cloned = cloneSketch(sketch);

        // Temporarily fix the dragged point so the GCS solves around it
        let tempFixedPoint = cloned.points.find(p => p.id === draggedPointId);
        let originalFixedState = false;
        if (tempFixedPoint) {
            originalFixedState = !!tempFixedPoint.fixed;
            tempFixedPoint.fixed = true;
        }

        const state: GCSSketchState = {
            points: cloned.points,
            lines: cloned.lines,
            circles: cloned.circles,
            constraints: cloned.constraints
        };

        try {
            const result = this.gcs.solve(state);

            // Restore original fixed state
            if (tempFixedPoint) {
                tempFixedPoint.fixed = originalFixedState;
            }

            if (result.success) {
                // Update point positions
                result.points.forEach((sp: any) => {
                    const p = cloned.points.find(x => x.id === sp.id);
                    if (p) {
                        p.x = sp.x;
                        p.y = sp.y;
                    }
                });

                // Update circle radius values
                result.circles.forEach((sc: any) => {
                    const c = cloned.circles.find(x => x.id === sc.id);
                    if (c) {
                        c.radius = sc.radius;
                    }
                });

                return { success: true, sketch: cloned };
            } else {
                return { success: false, sketch, error: result.error || 'Over-constrained' };
            }
        } catch (e: any) {
            // Restore original fixed state on crash
            if (tempFixedPoint) {
                tempFixedPoint.fixed = originalFixedState;
            }
            return { success: false, sketch, error: e.message || String(e) };
        }
    }
}
