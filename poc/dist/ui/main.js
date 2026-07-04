import { SketchStateModel } from './state.js';
import { SketchStore } from './store.js';
import { SolverService } from './solver.js';
import { CanvasViewport } from './viewport.js';
import { SidebarController } from './sidebar.js';
/**
 * Helper to generate unique identifiers for entities and constraints.
 */
function generateId(prefix) {
    return prefix + '_' + Math.random().toString(36).substring(2, 11);
}
/**
 * Euclidean distance helper.
 */
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
/**
 * Coordinates all modules (state, storage, solver, viewport, sidebar)
 * and manages interactive tool actions, drawing, and constraint bindings.
 */
export class SketchController {
    constructor() {
        // Temporary drawing state
        this.lineStartPointId = null;
        this.circleCenterPointId = null;
        this.isDistanceSelectionActive = false;
        this.model = new SketchStateModel();
        this.store = new SketchStore();
        this.solver = new SolverService();
        this.viewport = new CanvasViewport('canvas-container', this.model);
        this.sidebar = new SidebarController(this.model);
    }
    /**
     * Initializes all controllers, registers event callbacks, loads DB state,
     * and sets up the solver.
     */
    async init() {
        // Initialize viewport and sidebar DOM elements
        this.viewport.init();
        this.sidebar.init();
        // Register Viewport Callbacks
        this.viewport.setDragMoveCallback((id, x, y) => this.handleDragMove(id, x, y));
        this.viewport.setDragEndCallback(() => this.handleDragEnd());
        this.viewport.setEntityClickCallback((id, e) => this.handleEntityClick(id, e));
        this.viewport.setStageMouseDownCallback((pos, e) => this.handleStageMouseDown(pos, e));
        this.viewport.setStageMouseMoveCallback((pos) => this.handleStageMouseMove(pos));
        // Register Sidebar Button/Constraint Callbacks
        this.sidebar.setCoincidentCallback(() => this.applyCoincident());
        this.sidebar.setDistanceCallback(() => this.applyDistance());
        this.sidebar.setHorizontalCallback(() => this.applyHorizontal());
        this.sidebar.setVerticalCallback(() => this.applyVertical());
        this.sidebar.setParallelCallback(() => this.applyParallel());
        this.sidebar.setPerpendicularCallback(() => this.applyPerpendicular());
        this.sidebar.setToggleFixedCallback(() => this.togglePointFixed());
        this.sidebar.setClearAllCallback(() => this.clearWorkspace());
        // Bind Model changes to UI renders
        this.model.on('change', () => {
            this.viewport.redrawAll();
            this.sidebar.render();
        });
        this.model.on('tool-change', () => {
            this.resetDrawingState();
        });
        // Initialize GCS WASM solver
        try {
            await this.solver.init();
        }
        catch (err) {
            console.error('Failed to init solver service:', err);
        }
        // Load persisted sketch
        await this.store.load(this.model);
        this.runGCSSolver();
        this.viewport.redrawAll();
        this.sidebar.render();
    }
    // --- Controller Pipeline Iterations ---
    runGCSSolver() {
        const solved = this.solver.solve(this.model, this.viewport.getDraggedPointId());
        if (solved) {
            this.store.save(this.model);
        }
        return solved;
    }
    resetDrawingState() {
        this.lineStartPointId = null;
        this.circleCenterPointId = null;
        this.isDistanceSelectionActive = false;
        this.viewport.clearPreviews();
    }
    // --- Entity Snapping ---
    findClosestPoint(x, y, tolerance = 12) {
        let closest = null;
        let minDist = tolerance;
        for (const p of this.model.getPoints()) {
            const d = distance(x, y, p.x, p.y);
            if (d < minDist) {
                minDist = d;
                closest = p;
            }
        }
        return closest;
    }
    // --- Viewport Event Handlers ---
    handleStageMouseDown(pos, e) {
        const snap = this.findClosestPoint(pos.x, pos.y);
        const targetX = snap ? snap.x : pos.x;
        const targetY = snap ? snap.y : pos.y;
        const currentTool = this.model.getTool();
        if (currentTool === 'point') {
            if (!snap) {
                const pId = generateId('P');
                this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                this.runGCSSolver();
            }
        }
        else if (currentTool === 'line') {
            if (this.lineStartPointId === null) {
                // Select start point
                if (snap) {
                    this.lineStartPointId = snap.id;
                }
                else {
                    const pId = generateId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    this.lineStartPointId = pId;
                }
                this.viewport.updateLinePreview(targetX, targetY, targetX, targetY);
            }
            else {
                // Finish Line
                let endPointId;
                if (snap) {
                    endPointId = snap.id;
                }
                else {
                    const pId = generateId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    endPointId = pId;
                }
                if (this.lineStartPointId !== endPointId) {
                    this.model.addLine({
                        id: generateId('L'),
                        p1Id: this.lineStartPointId,
                        p2Id: endPointId
                    });
                }
                this.resetDrawingState();
                this.runGCSSolver();
            }
        }
        else if (currentTool === 'circle') {
            if (this.circleCenterPointId === null) {
                // Select center point
                if (snap) {
                    this.circleCenterPointId = snap.id;
                }
                else {
                    const pId = generateId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    this.circleCenterPointId = pId;
                }
                this.viewport.updateCirclePreview(targetX, targetY, 0);
            }
            else {
                // Finish Circle
                const center = this.model.getPoint(this.circleCenterPointId);
                if (center) {
                    const rad = distance(center.x, center.y, pos.x, pos.y);
                    this.model.addCircle({
                        id: generateId('C'),
                        centerId: this.circleCenterPointId,
                        radius: Math.max(5, rad)
                    });
                }
                this.resetDrawingState();
                this.runGCSSolver();
            }
        }
        else if (currentTool === 'select') {
            const clickedOnEmpty = e.target === this.viewport['stage'] || e.target === this.viewport['gridLayer'];
            if (clickedOnEmpty) {
                this.model.clearSelection();
            }
        }
    }
    handleStageMouseMove(pos) {
        const snap = this.findClosestPoint(pos.x, pos.y);
        if (snap) {
            this.viewport.updateSnapIndicator(snap.x, snap.y, true);
        }
        else {
            this.viewport.updateSnapIndicator(0, 0, false);
        }
        const targetX = snap ? snap.x : pos.x;
        const targetY = snap ? snap.y : pos.y;
        const currentTool = this.model.getTool();
        if (currentTool === 'line' && this.lineStartPointId) {
            const start = this.model.getPoint(this.lineStartPointId);
            if (start) {
                this.viewport.updateLinePreview(start.x, start.y, targetX, targetY);
            }
        }
        else if (currentTool === 'circle' && this.circleCenterPointId) {
            const center = this.model.getPoint(this.circleCenterPointId);
            if (center) {
                const rad = distance(center.x, center.y, targetX, targetY);
                this.viewport.updateCirclePreview(center.x, center.y, rad);
            }
        }
    }
    handleEntityClick(id, e) {
        if (this.isDistanceSelectionActive) {
            e.cancelBubble = true;
            const selectedIds = this.model.getSelectedEntityIds();
            if (id.startsWith('P_') && !selectedIds.includes(id)) {
                selectedIds.push(id);
                this.model.setSelectedEntityIds(selectedIds);
                const hud = document.getElementById('help-hud');
                if (selectedIds.length === 1) {
                    if (hud)
                        hud.innerHTML = `Mode: <span>Distance Selection</span>. Select second point.`;
                }
                else if (selectedIds.length === 2) {
                    this.applyDistance();
                }
            }
        }
        else if (this.model.getTool() === 'select') {
            e.cancelBubble = true;
            this.model.toggleSelect(id);
        }
    }
    handleDragMove(id, x, y) {
        this.viewport.setDraggedPointId(id);
        this.runGCSSolver();
        // Perform fast in-place update of visual lines and circles
        this.model.getLines().forEach(l => {
            const p1 = this.model.getPoint(l.p1Id);
            const p2 = this.model.getPoint(l.p2Id);
            if (p1 && p2) {
                this.viewport.updateLineVisualPosition(l.id, p1.x, p1.y, p2.x, p2.y);
            }
        });
        this.model.getCircles().forEach(c => {
            const center = this.model.getPoint(c.centerId);
            if (center) {
                this.viewport.updateCircleVisualPosition(c.id, center.x, center.y, c.radius);
            }
        });
        this.model.getPoints().forEach(otherPoint => {
            if (otherPoint.id !== id) {
                this.viewport.updatePointVisualPosition(otherPoint.id, otherPoint.x, otherPoint.y);
            }
        });
        this.viewport.updateEntityVisuals();
    }
    handleDragEnd() {
        this.runGCSSolver();
        this.model.setSelectedEntityIds(this.model.getSelectedEntityIds()); // trigger change
    }
    // --- Constraints Deletion & Creation ---
    deleteEntity(id) {
        this.model.deleteEntity(id);
        this.runGCSSolver();
    }
    deleteConstraint(id) {
        this.model.deleteConstraint(id);
        this.runGCSSolver();
    }
    applyCoincident() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => id.startsWith('P_'));
        if (selectedPoints.length !== 2) {
            alert("Select exactly 2 points to make coincident.");
            return;
        }
        this.model.addConstraint({
            id: generateId('CON'),
            type: 'coincident',
            p1Id: selectedPoints[0],
            p2Id: selectedPoints[1]
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    applyDistance() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => id.startsWith('P_'));
        if (selectedPoints.length === 2) {
            const p1 = this.model.getPoint(selectedPoints[0]);
            const p2 = this.model.getPoint(selectedPoints[1]);
            if (p1 && p2) {
                this.showInlineDistanceInput(p1, p2);
            }
        }
        else {
            this.isDistanceSelectionActive = true;
            this.model.setSelectedEntityIds([]);
            const hud = document.getElementById('help-hud');
            if (hud)
                hud.innerHTML = `Mode: <span>Distance Selection</span>. Select first point for distance constraint.`;
            this.model.setTool('select');
        }
    }
    showInlineDistanceInput(p1, p2) {
        const input = document.getElementById('inline-distance-input');
        if (!input)
            return;
        const currentDist = distance(p1.x, p1.y, p2.x, p2.y);
        const stage = this.viewport['stage'];
        const screenX = stage.x() + p2.x * stage.scaleX();
        const screenY = stage.y() + p2.y * stage.scaleY();
        input.value = currentDist.toFixed(1);
        input.style.left = `${screenX + 15}px`;
        input.style.top = `${screenY - 15}px`;
        input.style.display = 'block';
        input.focus();
        input.select();
        const applyInput = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0) {
                this.model.addConstraint({
                    id: generateId('CON'),
                    type: 'distance',
                    p1Id: p1.id,
                    p2Id: p2.id,
                    value: val
                });
                this.runGCSSolver();
            }
            this.hideInlineDistanceInput();
        };
        const keyHandler = (e) => {
            if (e.key === 'Enter') {
                applyInput();
            }
            else if (e.key === 'Escape') {
                this.hideInlineDistanceInput();
            }
        };
        const blurHandler = () => {
            applyInput();
        };
        input.addEventListener('keydown', keyHandler);
        input.addEventListener('blur', blurHandler);
        input._cleanup = () => {
            input.removeEventListener('keydown', keyHandler);
            input.removeEventListener('blur', blurHandler);
        };
    }
    hideInlineDistanceInput() {
        const input = document.getElementById('inline-distance-input');
        if (!input)
            return;
        input.style.display = 'none';
        if (input._cleanup) {
            input._cleanup();
            input._cleanup = null;
        }
        this.model.setSelectedEntityIds([]);
        this.isDistanceSelectionActive = false;
        this.model.setTool('select');
    }
    applyHorizontal() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => id.startsWith('L_'));
        if (selectedLines.length !== 1) {
            alert("Select exactly 1 line to make horizontal.");
            return;
        }
        this.model.addConstraint({
            id: generateId('CON'),
            type: 'horizontal',
            lineId: selectedLines[0]
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    applyVertical() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => id.startsWith('L_'));
        if (selectedLines.length !== 1) {
            alert("Select exactly 1 line to make vertical.");
            return;
        }
        this.model.addConstraint({
            id: generateId('CON'),
            type: 'vertical',
            lineId: selectedLines[0]
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    applyParallel() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => id.startsWith('L_'));
        if (selectedLines.length !== 2) {
            alert("Select exactly 2 lines to make parallel.");
            return;
        }
        this.model.addConstraint({
            id: generateId('CON'),
            type: 'parallel',
            line1Id: selectedLines[0],
            line2Id: selectedLines[1]
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    applyPerpendicular() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => id.startsWith('L_'));
        if (selectedLines.length !== 2) {
            alert("Select exactly 2 lines to make perpendicular.");
            return;
        }
        this.model.addConstraint({
            id: generateId('CON'),
            type: 'perpendicular',
            line1Id: selectedLines[0],
            line2Id: selectedLines[1]
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    togglePointFixed() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => id.startsWith('P_'));
        if (selectedPoints.length === 0) {
            alert("Select one or more points to toggle position lock.");
            return;
        }
        selectedPoints.forEach(id => {
            const p = this.model.getPoint(id);
            if (p) {
                p.fixed = !p.fixed;
            }
        });
        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }
    clearWorkspace() {
        if (confirm("Are you sure you want to clear the entire workspace?")) {
            this.model.clear();
            this.resetDrawingState();
            this.store.save(this.model);
        }
    }
}
// Global Application Instance
let controller;
// Bootstrap DOM bindings on load
window.addEventListener('DOMContentLoaded', async () => {
    controller = new SketchController();
    await controller.init();
    // Bind toolbar button selections
    const tools = ['select', 'point', 'line', 'circle'];
    tools.forEach(tool => {
        document.getElementById(`btn-${tool}`)?.addEventListener('click', () => {
            controller.model.setTool(tool);
        });
    });
    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (document.activeElement?.tagName === 'INPUT') {
            return;
        }
        if (e.key === 'd' || e.key === 'D') {
            controller.viewport.zoomToFit();
        }
    });
    // Expose self-test function globally for manual/automated test runners
    window.runSelfTest = runSelfTest;
});
/**
 * Diagnostics self-test. Integrates with the new object-oriented structure
 * to simulate entity creation, hover visuals updates, and active drags.
 */
export function runSelfTest() {
    console.log("--- Starting Viewport UI Diagnostics Self-Test ---");
    const results = [];
    function assert(name, condition, detail) {
        results.push({ name, pass: condition, detail });
        console.log(`  ${condition ? 'PASS' : 'FAIL'}: ${name} — ${detail}`);
    }
    // Clear everything
    controller.model.clear();
    controller.model.setTool('select');
    // --- Test 1: Point creation ---
    console.log("\n1. Point creation...");
    const pId = 'P_test';
    controller.model.addPoint({ id: pId, x: 100, y: 100 });
    controller.runGCSSolver();
    const mainLayer = controller.viewport['mainLayer'];
    const ptGroup = mainLayer.findOne('#' + pId);
    assert("Point group exists", !!ptGroup, `findOne('#${pId}') = ${ptGroup}`);
    assert("Point is draggable", ptGroup?.draggable() === true, `draggable=${ptGroup?.draggable()}`);
    assert("Point at correct position", ptGroup?.x() === 100 && ptGroup?.y() === 100, `pos=(${ptGroup?.x()}, ${ptGroup?.y()})`);
    // --- Test 2: Hover preserves node identity ---
    console.log("\n2. Hover preserves node identity...");
    const nodeBeforeHover = mainLayer.findOne('#' + pId);
    controller.model.setHoveredEntityId(pId);
    controller.viewport.updateEntityVisuals();
    const nodeAfterHover = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after hover", nodeBeforeHover === nodeAfterHover, `same ref = ${nodeBeforeHover === nodeAfterHover}`);
    assert("Node still draggable after hover", nodeAfterHover?.draggable() === true, `draggable=${nodeAfterHover?.draggable()}`);
    controller.model.setHoveredEntityId(null);
    controller.viewport.updateEntityVisuals();
    const nodeAfterLeave = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after leave", nodeBeforeHover === nodeAfterLeave, `same ref = ${nodeBeforeHover === nodeAfterLeave}`);
    // --- Test 3: Drag after hover (the real user scenario) ---
    console.log("\n3. Drag after hover...");
    controller.model.setHoveredEntityId(pId);
    controller.viewport.updateEntityVisuals();
    const dragNode = mainLayer.findOne('#' + pId);
    assert("Drag node found after hover", !!dragNode, `node=${dragNode}`);
    controller.viewport.setDraggedPointId(pId);
    dragNode.fire('dragstart');
    dragNode.x(200);
    dragNode.y(150);
    // Simulate drag move updates in data model and visually
    controller.model.getPoint(pId).x = 200;
    controller.model.getPoint(pId).y = 150;
    dragNode.fire('dragmove');
    dragNode.fire('dragend');
    controller.viewport.setDraggedPointId(null);
    const pData = controller.model.getPoint(pId);
    assert("Point data updated after drag", pData?.x === 200 && pData?.y === 150, `data=(${pData?.x}, ${pData?.y})`);
    // --- Test 4: redrawAll destroys nodes (regression proof) ---
    console.log("\n4. redrawAll() destroys node references (regression proof)...");
    const nodeBefore = mainLayer.findOne('#' + pId);
    controller.viewport.redrawAll();
    const nodeAfterRedraw = mainLayer.findOne('#' + pId);
    assert("redrawAll creates different node", nodeBefore !== nodeAfterRedraw, `same ref = ${nodeBefore === nodeAfterRedraw} (expected false)`);
    // --- Summary ---
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const summary = `Self-test complete: ${passed} passed, ${failed} failed out of ${results.length} assertions.`;
    if (failed === 0) {
        console.log(`%cSUCCESS: ${summary}`, 'color: #10b981; font-weight: bold; font-size: 1.1em;');
    }
    else {
        const failDetails = results.filter(r => !r.pass).map(r => `• ${r.name}: ${r.detail}`).join('\n');
        console.error(`FAILED: ${summary}\n\nFailures:\n${failDetails}`);
    }
}
