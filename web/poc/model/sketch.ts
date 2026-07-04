import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../../../ts/gcsapi/dist/index.js';

export interface SketchModel {
    points: GCSPoint[];
    lines: GCSLine[];
    circles: GCSCircle[];
    constraints: GCSConstraint[];
}

export function createEmptySketch(): SketchModel {
    return {
        points: [],
        lines: [],
        circles: [],
        constraints: []
    };
}

export function cloneSketch(sketch: SketchModel): SketchModel {
    return {
        points: sketch.points.map(p => ({ ...p })),
        lines: sketch.lines.map(l => ({ ...l })),
        circles: sketch.circles.map(c => ({ ...c })),
        constraints: sketch.constraints.map(c => {
            // Shallow clone of constraints is fine since they are simple objects, 
            // but we can deep copy if needed.
            return { ...c } as GCSConstraint;
        })
    };
}
