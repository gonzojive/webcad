// @ts-ignore
import init, { solve_gcs } from '../solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen.js';

export type EntityType = 'point' | 'line' | 'circle';

export interface GCSPoint {
    id: string; // Unique string identifier
    x: number;
    y: number;
    fixed?: boolean; // Lock X and Y coordinates in GCS solver
}

export interface GCSLine {
    id: string;
    p1Id: string; // Start point entity ID
    p2Id: string; // End point entity ID
}

export interface GCSCircle {
    id: string;
    centerId: string; // Center point entity ID
    radius: number; // Current radius value
    fixedRadius?: boolean; // Lock radius length in GCS solver
}

// Specialized constraint types
export interface BaseConstraint {
    id: string;
}

export interface CoincidentConstraint extends BaseConstraint {
    type: 'coincident';
    p1Id: string;
    p2Id: string;
}

export interface DistanceConstraint extends BaseConstraint {
    type: 'distance';
    p1Id: string;
    p2Id: string;
    value: number;
}

export interface VerticalConstraint extends BaseConstraint {
    type: 'vertical';
    lineId: string;
}

export interface HorizontalConstraint extends BaseConstraint {
    type: 'horizontal';
    lineId: string;
}

export interface ParallelConstraint extends BaseConstraint {
    type: 'parallel';
    line1Id: string;
    line2Id: string;
}

export interface PerpendicularConstraint extends BaseConstraint {
    type: 'perpendicular';
    line1Id: string;
    line2Id: string;
}

export type GCSConstraint =
    | CoincidentConstraint
    | DistanceConstraint
    | VerticalConstraint
    | HorizontalConstraint
    | ParallelConstraint
    | PerpendicularConstraint;

export interface GCSSketchState {
    points: GCSPoint[];
    lines: GCSLine[];
    circles: GCSCircle[];
    constraints: GCSConstraint[];
}

export interface SolverResult {
    success: boolean;
    points: GCSPoint[];
    circles: GCSCircle[];
    error?: string;
}

export class GCSapi {
    private initialized = false;

    /**
     * Initialize the WebAssembly module.
     * Can optionally pass a custom WASM binary URL.
     */
    async init(wasmUrl?: string): Promise<void> {
        if (this.initialized) return;
        await init(wasmUrl);
        this.initialized = true;
    }

    /**
     * Solves the geometric sketch constraints.
     */
    solve(state: GCSSketchState): SolverResult {
        if (!this.initialized) {
            throw new Error("GCSapi is not initialized. Call init() first.");
        }

        // Map the specialized constraints to the raw JSON structure the Rust solver expects
        const rawConstraints = state.constraints.map(c => {
            switch (c.type) {
                case 'coincident':
                    return {
                        id: c.id,
                        type: 'coincident',
                        entityIds: [c.p1Id, c.p2Id]
                    };
                case 'distance':
                    return {
                        id: c.id,
                        type: 'distance',
                        entityIds: [c.p1Id, c.p2Id],
                        value: c.value
                    };
                case 'vertical':
                    return {
                        id: c.id,
                        type: 'vertical',
                        entityIds: [c.lineId]
                    };
                case 'horizontal':
                    return {
                        id: c.id,
                        type: 'horizontal',
                        entityIds: [c.lineId]
                    };
                case 'parallel':
                    return {
                        id: c.id,
                        type: 'parallel',
                        entityIds: [c.line1Id, c.line2Id]
                    };
                case 'perpendicular':
                    return {
                        id: c.id,
                        type: 'perpendicular',
                        entityIds: [c.line1Id, c.line2Id]
                    };
                default:
                    throw new Error(`Unsupported constraint type: ${(c as any).type}`);
            }
        });

        const inputJson = JSON.stringify({
            points: state.points,
            lines: state.lines,
            circles: state.circles,
            constraints: rawConstraints
        });

        const outputJson = solve_gcs(inputJson);
        const result = JSON.parse(outputJson);

        return result;
    }
}
