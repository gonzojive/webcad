import { SketchModel, createEmptySketch } from './sketch.js';
import { Unit } from '../units/units.js';

export interface Document {
    sketch: SketchModel;
    preferredUnit: Unit;
}

export function createEmptyDocument(preferredUnit: Unit = 'mm'): Document {
    return {
        sketch: createEmptySketch(),
        preferredUnit
    };
}
