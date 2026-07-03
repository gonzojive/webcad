"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCSapi = void 0;
// @ts-ignore
const solver_wasm_bindgen_js_1 = __importStar(require("../solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen.js"));
class GCSapi {
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
        await (0, solver_wasm_bindgen_js_1.default)(wasmUrl);
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
        const outputJson = (0, solver_wasm_bindgen_js_1.solve_gcs)(inputJson);
        const result = JSON.parse(outputJson);
        return result;
    }
}
exports.GCSapi = GCSapi;
