import { GCSapi, GCSPoint, GCSSketchState } from '../gcsapi/gcsapi.js';
import { SketchStateModel } from './state.js';

/**
 * Service that wraps the GCSapi WASM solver interface. Handles solver
 * initialization and coordinates state synchronization during solver iterations.
 */
export class SolverService {
    private readonly gcs = new GCSapi();
    private isInitialized = false;

    /**
     * Initializes the solver service and loads the WASM module.
     */
    async init(): Promise<void> {
        if (this.isInitialized) return;
        
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = 'Loading GCS...';
        
        try {
            // Path relative to web root
            await this.gcs.init('/solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen_bg.wasm');
            this.isInitialized = true;
            
            if (statusText) {
                statusText.innerText = 'GCS Solver Ready';
                statusText.style.color = 'var(--success-color)';
                statusText.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                statusText.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
            }
            console.log('GCS solver loaded successfully.');
        } catch (e) {
            console.error('Failed to initialize GCS solver:', e);
            if (statusText) {
                statusText.innerText = 'Solver Error';
                statusText.style.color = 'var(--danger-color)';
                statusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                statusText.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            }
            throw e;
        }
    }

    /**
     * Runs the solver on the current model state.
     * Optionally takes `draggedPointId` to temporarily mark that point as fixed.
     */
    solve(model: SketchStateModel, draggedPointId: string | null = null): boolean {
        if (!this.isInitialized) {
            console.warn('Solver not initialized. Call init() first.');
            return false;
        }

        try {
            // Temporarily fix the dragged point so the GCS solves around it
            let originalFixedState = false;
            let tempFixedPoint: GCSPoint | undefined;
            
            if (draggedPointId) {
                tempFixedPoint = model.getPoint(draggedPointId);
                if (tempFixedPoint) {
                    originalFixedState = !!tempFixedPoint.fixed;
                    tempFixedPoint.fixed = true;
                }
            }

            const state: GCSSketchState = {
                points: model.getPoints(),
                lines: model.getLines(),
                circles: model.getCircles(),
                constraints: model.getConstraints()
            };

            const result = this.gcs.solve(state);

            // Restore original fixed state
            if (tempFixedPoint) {
                tempFixedPoint.fixed = originalFixedState;
            }

            const statusText = document.getElementById('status-text');

            if (result.success) {
                // Update point positions
                result.points.forEach(sp => {
                    const p = model.getPoint(sp.id);
                    if (p) {
                        p.x = sp.x;
                        p.y = sp.y;
                    }
                });

                // Update circle radius values
                result.circles.forEach(sc => {
                    const c = model.getCircles().find(x => x.id === sc.id);
                    if (c) {
                        c.radius = sc.radius;
                    }
                });

                if (statusText) {
                    statusText.innerText = 'Solved Successfully';
                    statusText.style.color = 'var(--success-color)';
                    statusText.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                    statusText.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                }
                return true;
            } else {
                if (statusText) {
                    statusText.innerText = 'Over-constrained / Error';
                    statusText.style.color = 'var(--danger-color)';
                    statusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                    statusText.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                }
                console.warn('GCS solver warning:', result.error);
                return false;
            }
        } catch (e) {
            console.error('Solver crash:', e);
            return false;
        }
    }
}
