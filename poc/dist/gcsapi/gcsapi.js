// @ts-ignore
import init, { solve_gcs } from '../solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen.js';
export class GCSapi {
    constructor() {
        this.initialized = false;
    }
    /**
     * Initialize the WebAssembly module.
     * Can optionally pass a custom WASM binary URL.
     */
    async init(wasmUrl) {
        if (this.initialized)
            return;
        await init(wasmUrl);
        this.initialized = true;
    }
    /**
     * Solves the geometric sketch constraints.
     */
    solve(state) {
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
                    throw new Error(`Unsupported constraint type: ${c.type}`);
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
