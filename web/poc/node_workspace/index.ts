import * as fs from 'node:fs';
import * as url from 'node:url';
import { GCSBridge } from '../model/gcs_bridge.js';
import { createEmptySketch, SketchModel, ISketchWorkspace } from '../model/sketch.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../../../ts/gcsapi/dist/index.js';

/**
 * NodeWorkspace implements a standalone, Node.js-compatible CAD sketch workspace.
 * It encapsulates the GCS solver WASM initialization and provides shape creation and constraint solving helper methods.
 */
export class NodeWorkspace implements ISketchWorkspace {
    private readonly bridge = new GCSBridge();
    private sketch: SketchModel = createEmptySketch();
    private pointCounter = 0;
    private lineCounter = 0;
    private circleCounter = 0;
    private constraintCounter = 0;

    /**
     * Initializes the Node.js solver environment and GCS WASM module.
     */
    async init(): Promise<void> {
        // Load the Go WASM execution environment globally
        const wasmExecUrl = (import.meta as any).resolve('../ui/wasm_exec.js');
        // @ts-ignore
        await import(wasmExecUrl);

        // Resolve compiled GCS solver WASM URL
        const solverWasmUrl = (import.meta as any).resolve('../ui/wasm_solver.wasm');

        // Mock fetch to load the local WASM file from the filesystem in Node.js
        globalThis.fetch = async (fileUrl: any) => {
            const buffer = fs.readFileSync(url.fileURLToPath(fileUrl));
            return new Response(buffer, { headers: { 'content-type': 'application/wasm' } });
        };

        await this.bridge.init(solverWasmUrl);
    }

    /**
     * Adds a point to the sketch workspace.
     */
    addPoint(pos: { x: number; y: number }, fixed = false): string {
        const id = `P${++this.pointCounter}`;
        this.sketch.points.push({ id, x: pos.x, y: pos.y, fixed });
        return id;
    }

    /**
     * Adds a line segment connecting two points.
     */
    addLine(p1Id: string, p2Id: string): string {
        const id = `L${++this.lineCounter}`;
        this.sketch.lines.push({ id, p1Id, p2Id });
        return id;
    }

    /**
     * Adds a circle centered at a point.
     */
    addCircle(centerId: string, radius: number): string {
        const id = `C${++this.circleCounter}`;
        this.sketch.circles.push({ id, centerId, radius });
        return id;
    }

    /**
     * Adds a geometric constraint to the workspace.
     */
    addConstraint(constraint: any): string {
        const id = `CST${++this.constraintCounter}`;
        const fullConstraint = { ...constraint, id } as GCSConstraint;
        this.sketch.constraints.push(fullConstraint);
        return id;
    }

    /**
     * Solves the geometric constraints of the sketch workspace.
     * Updates point positions and circle radii in place.
     * 
     * @returns True if the solve succeeded, False otherwise.
     */
    solve(): boolean {
        const result = this.bridge.solve(this.sketch);
        if (result.success) {
            this.sketch = result.sketch;
            return true;
        }
        return false;
    }

    // ISketchWorkspace implementation methods
    getPoints(): GCSPoint[] {
        return this.sketch.points;
    }

    getLines(): GCSLine[] {
        return this.sketch.lines;
    }

    getCircles(): GCSCircle[] {
        return this.sketch.circles;
    }

    getPoint(id: string): GCSPoint | undefined {
        return this.sketch.points.find(p => p.id === id);
    }
}
export { ISketchWorkspace };
