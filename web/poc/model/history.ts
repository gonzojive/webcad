import { SketchModel, cloneSketch } from './sketch.js';

export class HistoryManager {
    private undoStack: SketchModel[] = [];
    private redoStack: SketchModel[] = [];
    private maxHistory = 100;

    constructor(initialState?: SketchModel) {
        if (initialState) {
            this.undoStack.push(cloneSketch(initialState));
        }
    }

    /**
     * Pushes a new state onto the history stack and clears the redo stack.
     */
    pushState(state: SketchModel) {
        // Only push if the state has changed from the top of the stack
        const current = this.getCurrentState();
        if (current) {
            if (current.revision !== undefined && state.revision !== undefined) {
                if (current.revision === state.revision) {
                    return;
                }
            } else if (JSON.stringify(current) === JSON.stringify(state)) {
                return;
            }
        }

        this.undoStack.push(cloneSketch(state));
        this.redoStack = [];

        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
    }

    /**
     * Undoes the last action and returns the previous state, or null if no undo is possible.
     */
    undo(): SketchModel | null {
        if (this.undoStack.length <= 1) {
            return null; // Keep at least the initial state
        }
        const current = this.undoStack.pop()!;
        this.redoStack.push(current);
        return cloneSketch(this.undoStack[this.undoStack.length - 1]);
    }

    /**
     * Redoes the last undone action, or null if no redo is possible.
     */
    redo(): SketchModel | null {
        if (this.redoStack.length === 0) {
            return null;
        }
        const nextState = this.redoStack.pop()!;
        this.undoStack.push(nextState);
        return cloneSketch(nextState);
    }

    canUndo(): boolean {
        return this.undoStack.length > 1;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    getCurrentState(): SketchModel | null {
        if (this.undoStack.length === 0) return null;
        return this.undoStack[this.undoStack.length - 1];
    }

    clear(initialState?: SketchModel) {
        this.undoStack = [];
        this.redoStack = [];
        if (initialState) {
            this.undoStack.push(cloneSketch(initialState));
        }
    }
}
