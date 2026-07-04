import { GCSPoint, GCSLine, GCSCircle, GCSConstraint, GCSValueConstraint } from '../gcsapi/gcsapi.js';
import { SketchStateModel, ToolMode } from './state.js';
import { SketchStore } from './store.js';
import { SolverService } from './solver.js';
import { CanvasViewport } from './viewport.js';
import { SidebarController } from './sidebar.js';

/**
 * Helper to generate unique identifiers for entities and constraints.
 */
function generateId(prefix: string): string {
    return prefix + '_' + Math.random().toString(36).substring(2, 11);
}

/**
 * Euclidean distance helper.
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}



function getImpliedDimensionType(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    mouse: { x: number; y: number }
): 'distance' | 'horizontal_distance' | 'vertical_distance' {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) return 'distance';

    const mx = mouse.x - cx;
    const my = mouse.y - cy;

    const nx = -dy / segLen;
    const ny = dx / segLen;

    const dotPerp = mx * nx + my * ny;
    const dotSeg = (mx * dx + my * dy) / segLen;

    if (Math.abs(dotSeg) < Math.abs(dotPerp) * 0.414) {
        return 'distance';
    }

    if (Math.abs(my) > Math.abs(mx)) {
        return 'horizontal_distance';
    } else {
        return 'vertical_distance';
    }
}

/**
 * Coordinates all modules (state, storage, solver, viewport, sidebar)
 * and manages interactive tool actions, drawing, and constraint bindings.
 */
export class SketchController {
    public readonly model: SketchStateModel;
    private readonly store: SketchStore;
    private readonly solver: SolverService;
    public readonly viewport: CanvasViewport;
    private readonly sidebar: SidebarController;

    // Temporary drawing state
    private lineStartPointId: string | null = null;
    private circleCenterPointId: string | null = null;
    private isDistanceSelectionActive = false;
    private dimensionFirstEntityId: string | null = null;
    private placingDimension: {
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance';
        entityIds: string[];
    } | null = null;
    private currentPreviewDimensionType: 'distance' | 'horizontal_distance' | 'vertical_distance' = 'distance';

    constructor() {
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
        this.viewport.setConstraintDblClickCallback((id: string) => this.handleConstraintDblClick(id));
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
            this.updateToolbarUI();
        });

        // Initialize GCS WASM solver
        try {
            await this.solver.init();
        } catch (err) {
            console.error('Failed to init solver service:', err);
        }

        // Load persisted sketch
        await this.store.load(this.model);
        this.runGCSSolver();
        this.viewport.redrawAll();
        this.sidebar.render();
    }

    // --- Controller Pipeline Iterations ---

    public runGCSSolver() {
        const solved = this.solver.solve(this.model, this.viewport.getDraggedPointId());
        if (solved) {
            this.store.save(this.model);
        }
        return solved;
    }

    private resetDrawingState() {
        this.lineStartPointId = null;
        this.circleCenterPointId = null;
        this.isDistanceSelectionActive = false;
        this.dimensionFirstEntityId = null;
        this.placingDimension = null;
        this.viewport.clearPreviews();
        this.viewport.clearDimensionPreview();
    }

    public cancelActiveOperation() {
        this.resetDrawingState();
        this.model.setTool('select');
    }

    private updateToolbarUI() {
        const activeTool = this.model.getTool();
        const tools: ToolMode[] = ['select', 'point', 'line', 'circle', 'dimension'];
        tools.forEach(t => {
            const btn = document.getElementById(`btn-${t}`);
            if (btn) {
                if (t === activeTool) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });

        const hud = document.getElementById('help-hud');
        if (hud) {
            let helpText = '';
            if (activeTool === 'select') {
                helpText = 'Mode: <span>Select</span>. Click canvas to select or drag entities.';
            } else if (activeTool === 'point') {
                helpText = 'Mode: <span>Point</span>. Click canvas to place points.';
            } else if (activeTool === 'line') {
                helpText = 'Mode: <span>Line</span>. Click canvas or snap to points to draw lines.';
            } else if (activeTool === 'circle') {
                helpText = 'Mode: <span>Circle</span>. Click center point then drag/click radius.';
            } else if (activeTool === 'dimension') {
                helpText = 'Mode: <span>Dimension</span>. Click point/line to place dimensions.';
            }
            hud.innerHTML = helpText;
        }
    }

    // --- Entity Snapping ---

    public findClosestPoint(x: number, y: number, tolerance = 12): GCSPoint | null {
        let closest: GCSPoint | null = null;
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

    private handleStageMouseDown(pos: { x: number; y: number }, e: any) {
        const snap = this.findClosestPoint(pos.x, pos.y);
        const targetX = snap ? snap.x : pos.x;
        const targetY = snap ? snap.y : pos.y;
        const currentTool = this.model.getTool();

        if (currentTool === 'point') {
            if (!snap) {
                const pId = this.model.generateNextId('P');
                this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                this.runGCSSolver();
            }
        } else if (currentTool === 'line') {
            if (this.lineStartPointId === null) {
                // Select start point
                if (snap) {
                    this.lineStartPointId = snap.id;
                } else {
                    const pId = this.model.generateNextId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    this.lineStartPointId = pId;
                }
                this.viewport.updateLinePreview(targetX, targetY, targetX, targetY);
            } else {
                // Finish Line
                let endPointId: string;
                if (snap) {
                    endPointId = snap.id;
                } else {
                    const pId = this.model.generateNextId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    endPointId = pId;
                }

                if (this.lineStartPointId !== endPointId) {
                    this.model.addLine({
                        id: this.model.generateNextId('L'),
                        p1Id: this.lineStartPointId,
                        p2Id: endPointId
                    });
                }
                this.resetDrawingState();
                this.runGCSSolver();
            }
        } else if (currentTool === 'circle') {
            if (this.circleCenterPointId === null) {
                // Select center point
                if (snap) {
                    this.circleCenterPointId = snap.id;
                } else {
                    const pId = this.model.generateNextId('P');
                    this.model.addPoint({ id: pId, x: pos.x, y: pos.y });
                    this.circleCenterPointId = pId;
                }
                this.viewport.updateCirclePreview(targetX, targetY, 0);
            } else {
                // Finish Circle
                const center = this.model.getPoint(this.circleCenterPointId);
                if (center) {
                    const rad = distance(center.x, center.y, pos.x, pos.y);
                    this.model.addCircle({
                        id: this.model.generateNextId('C'),
                        centerId: this.circleCenterPointId,
                        radius: Math.max(5, rad)
                    });
                }
                this.resetDrawingState();
                this.runGCSSolver();
            }
        } else if (currentTool === 'select') {
            const clickedOnEmpty = e.target === this.viewport['stage'] || e.target === this.viewport['gridLayer'];
            if (clickedOnEmpty) {
                this.model.clearSelection();
            }
        } else if (currentTool === 'dimension') {
            const clickedOnEmpty = e.target === this.viewport['stage'] || e.target === this.viewport['gridLayer'];
            if (clickedOnEmpty && this.placingDimension) {
                e.cancelBubble = true;
                const { type, entityIds } = this.placingDimension;
                const finalType = (type === 'point_line_distance') ? 'point_line_distance' : this.currentPreviewDimensionType;

                this.placingDimension = null;
                this.viewport.clearDimensionPreview();

                const layoutProps: { offset?: number; offsetX?: number; offsetY?: number } = {};

                if (finalType === 'point_line_distance') {
                    const p = this.model.getPoint(entityIds[0]);
                    const l = this.model.getLine(entityIds[1]);
                    if (p && l) {
                        const lp1 = this.model.getPoint(l.p1Id);
                        const lp2 = this.model.getPoint(l.p2Id);
                        if (lp1 && lp2) {
                            const ux = lp2.x - lp1.x;
                            const uy = lp2.y - lp1.y;
                            const len2 = ux*ux + uy*uy;
                            let projX = lp1.x;
                            let projY = lp1.y;
                            if (len2 > 0) {
                                const t = ((p.x - lp1.x)*ux + (p.y - lp1.y)*uy) / len2;
                                projX = lp1.x + t * ux;
                                projY = lp1.y + t * uy;
                            }
                            const val = distance(p.x, p.y, projX, projY);
                            
                            const cx = (p.x + projX) / 2;
                            const cy = (p.y + projY) / 2;
                            layoutProps.offsetX = pos.x - cx;
                            layoutProps.offsetY = pos.y - cy;

                            this.showInlineDimensionInput('point_line_distance', entityIds, val, pos, layoutProps);
                        }
                    }
                } else {
                    const p1 = this.model.getPoint(entityIds[0]);
                    const p2 = this.model.getPoint(entityIds[1]);
                    if (p1 && p2) {
                        const val = (finalType === 'horizontal_distance') ? Math.abs(p2.x - p1.x)
                                  : (finalType === 'vertical_distance') ? Math.abs(p2.y - p1.y)
                                  : distance(p1.x, p1.y, p2.x, p2.y);
                        
                        if (finalType === 'distance') {
                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const len = Math.hypot(dx, dy);
                            if (len > 0) {
                                const nx = -dy / len;
                                const ny = dx / len;
                                const cx = (p1.x + p2.x) / 2;
                                const cy = (p1.y + p2.y) / 2;
                                layoutProps.offset = (pos.x - cx) * nx + (pos.y - cy) * ny;
                            }
                        } else if (finalType === 'horizontal_distance') {
                            const minY = Math.min(p1.y, p2.y);
                            layoutProps.offset = pos.y - minY;
                        } else if (finalType === 'vertical_distance') {
                            const maxX = Math.max(p1.x, p2.x);
                            layoutProps.offset = pos.x - maxX;
                        }

                        this.showInlineDimensionInput(finalType, entityIds, val, pos, layoutProps);
                    }
                }
            }
        }
    }

    private handleStageMouseMove(pos: { x: number; y: number }) {
        const snap = this.findClosestPoint(pos.x, pos.y);
        
        if (snap) {
            this.viewport.updateSnapIndicator(snap.x, snap.y, true);
            this.viewport.clearPointPreview();
        } else {
            this.viewport.updateSnapIndicator(0, 0, false);
        }

        const targetX = snap ? snap.x : pos.x;
        const targetY = snap ? snap.y : pos.y;
        const currentTool = this.model.getTool();

        if (!snap) {
            if (currentTool === 'point' || currentTool === 'line' || currentTool === 'circle') {
                this.viewport.setPointPreview(pos.x, pos.y);
            } else {
                this.viewport.clearPointPreview();
            }
        }

        if (currentTool === 'line' && this.lineStartPointId) {
            const start = this.model.getPoint(this.lineStartPointId);
            if (start) {
                this.viewport.updateLinePreview(start.x, start.y, targetX, targetY);
            }
        } else if (currentTool === 'circle' && this.circleCenterPointId) {
            const center = this.model.getPoint(this.circleCenterPointId);
            if (center) {
                const rad = distance(center.x, center.y, targetX, targetY);
                this.viewport.updateCirclePreview(center.x, center.y, rad);
            }
        } else if (currentTool === 'dimension' && this.placingDimension) {
            const { type, entityIds } = this.placingDimension;
            if (type !== 'point_line_distance') {
                const p1 = this.model.getPoint(entityIds[0]);
                const p2 = this.model.getPoint(entityIds[1]);
                if (p1 && p2) {
                    const impliedType = getImpliedDimensionType(p1, p2, pos);
                    this.currentPreviewDimensionType = impliedType;
                    this.viewport.setDimensionPreview(impliedType, entityIds, pos);
                }
            } else {
                this.viewport.setDimensionPreview('point_line_distance', entityIds, pos);
            }
        }
    }

    private handleEntityClick(id: string, e: any) {
        if (this.isDistanceSelectionActive) {
            e.cancelBubble = true;
            const selectedIds = this.model.getSelectedEntityIds();
            
            if (/^P\d+$/.test(id) && !selectedIds.includes(id)) {
                selectedIds.push(id);
                this.model.setSelectedEntityIds(selectedIds);
                
                const hud = document.getElementById('help-hud');
                if (selectedIds.length === 1) {
                    if (hud) hud.innerHTML = `Mode: <span>Distance Selection</span>. Select second point.`;
                } else if (selectedIds.length === 2) {
                    this.applyDistance();
                }
            }
        } else if (this.model.getTool() === 'dimension') {
            this.handleDimensionEntityClick(id, e);
        } else if (this.model.getTool() === 'select') {
            e.cancelBubble = true;
            this.model.toggleSelect(id);
        }
    }

    private handleDragMove(id: string, x: number, y: number) {
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

    private handleDragEnd() {
        this.runGCSSolver();
        this.model.setSelectedEntityIds(this.model.getSelectedEntityIds()); // trigger change
    }

    // --- Constraints Deletion & Creation ---

    private deleteEntity(id: string) {
        this.model.deleteEntity(id);
        this.runGCSSolver();
    }

    private deleteConstraint(id: string) {
        this.model.deleteConstraint(id);
        this.runGCSSolver();
    }

    private applyCoincident() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => /^P\d+$/.test(id));
        if (selectedPoints.length !== 2) {
            alert("Select exactly 2 points to make coincident.");
            return;
        }

        const conId = this.model.makeUniqueConstraintId(`Coincident_${selectedPoints[0]}_${selectedPoints[1]}`);
        this.model.addConstraint({
            id: conId,
            type: 'coincident',
            p1Id: selectedPoints[0],
            p2Id: selectedPoints[1]
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private applyDistance() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => /^P\d+$/.test(id));
        
        if (selectedPoints.length === 2) {
            const p1 = this.model.getPoint(selectedPoints[0]);
            const p2 = this.model.getPoint(selectedPoints[1]);
            if (p1 && p2) {
                const currentVal = distance(p1.x, p1.y, p2.x, p2.y);
                const spawnPos = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                this.showInlineDimensionInput('distance', [p1.id, p2.id], currentVal, spawnPos);
            }
        } else {
            this.isDistanceSelectionActive = true;
            this.model.setSelectedEntityIds([]);
            const hud = document.getElementById('help-hud');
            if (hud) hud.innerHTML = `Mode: <span>Distance Selection</span>. Select first point for distance constraint.`;
            this.model.setTool('select');
        }
    }

    private handleDimensionEntityClick(id: string, e: any) {
        e.cancelBubble = true;

        if (this.placingDimension) {
            return;
        }
        
        if (this.dimensionFirstEntityId === null) {
            if (/^L\d+$/.test(id)) {
                const line = this.model.getLine(id);
                if (line) {
                    this.placingDimension = {
                        type: 'distance',
                        entityIds: [line.p1Id, line.p2Id]
                    };
                    this.model.setSelectedEntityIds([id]);
                    const hud = document.getElementById('help-hud');
                    if (hud) hud.innerHTML = `Mode: <span>Dimension</span>. Move mouse and click canvas to place dimension.`;
                }
            } else if (/^P\d+$/.test(id)) {
                this.dimensionFirstEntityId = id;
                this.model.setSelectedEntityIds([id]);
                const hud = document.getElementById('help-hud');
                if (hud) hud.innerHTML = `Mode: <span>Dimension</span>. Select second Point or Line.`;
            }
        } else {
            const firstId = this.dimensionFirstEntityId;
            const secondId = id;
            this.startTwoEntityDimensionPlacement(firstId, secondId);
        }
    }

    private startTwoEntityDimensionPlacement(firstId: string, secondId: string) {
        if (firstId === secondId) return;

        if (/^P\d+$/.test(firstId) && /^P\d+$/.test(secondId)) {
            this.placingDimension = {
                type: 'distance',
                entityIds: [firstId, secondId]
            };
            this.dimensionFirstEntityId = null;
            this.model.setSelectedEntityIds([firstId, secondId]);
            const hud = document.getElementById('help-hud');
            if (hud) hud.innerHTML = `Mode: <span>Dimension</span>. Move mouse and click canvas to place point-to-point dimension.`;

        } else if ((/^P\d+$/.test(firstId) && /^L\d+$/.test(secondId)) || 
                   (/^L\d+$/.test(firstId) && /^P\d+$/.test(secondId))) {
            const pointId = /^P\d+$/.test(firstId) ? firstId : secondId;
            const lineId = /^L\d+$/.test(firstId) ? firstId : secondId;

            this.placingDimension = {
                type: 'point_line_distance',
                entityIds: [pointId, lineId]
            };
            this.dimensionFirstEntityId = null;
            this.model.setSelectedEntityIds([pointId, lineId]);
            const hud = document.getElementById('help-hud');
            if (hud) hud.innerHTML = `Mode: <span>Dimension</span>. Move mouse and click canvas to place point-to-line dimension.`;
        } else {
            alert("Dimension between these entities not supported yet.");
            this.model.setSelectedEntityIds([]);
            this.dimensionFirstEntityId = null;
        }
    }

    private showInlineDimensionInput(
        type: 'distance' | 'horizontal_distance' | 'vertical_distance' | 'point_line_distance',
        entityIds: string[],
        defaultValue: number,
        spawnPos: { x: number; y: number },
        layoutProps?: { offset?: number; offsetX?: number; offsetY?: number }
    ) {
        const input = document.getElementById('inline-distance-input') as HTMLInputElement;
        if (!input) return;

        const stage = this.viewport['stage'];
        const screenX = stage.x() + spawnPos.x * stage.scaleX();
        const screenY = stage.y() + spawnPos.y * stage.scaleY();

        input.value = defaultValue.toFixed(1);
        input.style.left = `${screenX + 15}px`;
        input.style.top = `${screenY - 15}px`;
        input.style.display = 'block';
        input.focus();
        input.select();

        const applyInput = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0) {
                if (type === 'distance' || type === 'horizontal_distance' || type === 'vertical_distance') {
                    const prefix = type === 'distance' ? 'Distance' : type === 'horizontal_distance' ? 'HorizDist' : 'VertDist';
                    const conId = this.model.makeUniqueConstraintId(`${prefix}_${entityIds[0]}_${entityIds[1]}`);
                    this.model.addConstraint({
                        id: conId,
                        type: type,
                        p1Id: entityIds[0],
                        p2Id: entityIds[1],
                        value: val,
                        layoutOffset: layoutProps?.offset
                    });
                } else if (type === 'point_line_distance') {
                    const conId = this.model.makeUniqueConstraintId(`Dist_${entityIds[0]}_${entityIds[1]}`);
                    this.model.addConstraint({
                        id: conId,
                        type: 'point_line_distance',
                        pointId: entityIds[0],
                        lineId: entityIds[1],
                        value: val,
                        layoutOffsetX: layoutProps?.offsetX,
                        layoutOffsetY: layoutProps?.offsetY
                    });
                }
                this.runGCSSolver();
            }
            this.hideInlineDistanceInput();
        };

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                applyInput();
            } else if (e.key === 'Escape') {
                this.hideInlineDistanceInput();
            }
        };

        const blurHandler = () => {
            applyInput();
        };

        input.addEventListener('keydown', keyHandler);
        input.addEventListener('blur', blurHandler);

        (input as any)._cleanup = () => {
            input.removeEventListener('keydown', keyHandler);
            input.removeEventListener('blur', blurHandler);
        };
    }

    private hideInlineDistanceInput() {
        const input = document.getElementById('inline-distance-input') as HTMLInputElement;
        if (!input) return;

        input.style.display = 'none';
        if ((input as any)._cleanup) {
            (input as any)._cleanup();
            (input as any)._cleanup = null;
        }

        this.model.setSelectedEntityIds([]);
        this.dimensionFirstEntityId = null;
        if (this.isDistanceSelectionActive) {
            this.isDistanceSelectionActive = false;
            this.model.setTool('select');
        }
    }

    private handleConstraintDblClick(id: string) {
        const con = this.model.getConstraint(id);
        if (con) {
            this.editConstraintValue(con);
        }
    }

    private editConstraintValue(con: GCSConstraint) {
        if (con.type === 'distance' || con.type === 'horizontal_distance' || con.type === 'vertical_distance' || con.type === 'point_line_distance') {
            const labelPos = this.viewport.getConstraintLabelPosition(con);
            if (labelPos) {
                this.showInlineDimensionInputForEdit(con as GCSValueConstraint, labelPos);
            }
        }
    }

    private showInlineDimensionInputForEdit(con: GCSValueConstraint, spawnPos: { x: number; y: number }) {
        const input = document.getElementById('inline-distance-input') as HTMLInputElement;
        if (!input) return;

        const stage = this.viewport['stage'];
        const screenX = stage.x() + spawnPos.x * stage.scaleX();
        const screenY = stage.y() + spawnPos.y * stage.scaleY();

        input.value = con.value!.toFixed(1);
        input.style.left = `${screenX + 15}px`;
        input.style.top = `${screenY - 15}px`;
        input.style.display = 'block';
        input.focus();
        input.select();

        const applyInput = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0) {
                con.value = val;
                this.model.updateConstraint(con);
                this.runGCSSolver();
            }
            this.hideInlineDistanceInput();
        };

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                applyInput();
            } else if (e.key === 'Escape') {
                this.hideInlineDistanceInput();
            }
        };

        const blurHandler = () => {
            applyInput();
        };

        input.addEventListener('keydown', keyHandler);
        input.addEventListener('blur', blurHandler);

        (input as any)._cleanup = () => {
            input.removeEventListener('keydown', keyHandler);
            input.removeEventListener('blur', blurHandler);
        };
    }

    public deleteSelected() {
        const selectedIds = this.model.getSelectedEntityIds();
        if (selectedIds.length === 0) return;

        selectedIds.forEach(id => {
            if (this.model.getConstraints().some(c => c.id === id)) {
                this.model.deleteConstraint(id);
            } else {
                this.model.deleteEntity(id);
            }
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private applyHorizontal() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => /^L\d+$/.test(id));
        if (selectedLines.length !== 1) {
            alert("Select exactly 1 line to make horizontal.");
            return;
        }

        const conId = this.model.makeUniqueConstraintId(`Horizontal_${selectedLines[0]}`);
        this.model.addConstraint({
            id: conId,
            type: 'horizontal',
            lineId: selectedLines[0]
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private applyVertical() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => /^L\d+$/.test(id));
        if (selectedLines.length !== 1) {
            alert("Select exactly 1 line to make vertical.");
            return;
        }

        const conId = this.model.makeUniqueConstraintId(`Vertical_${selectedLines[0]}`);
        this.model.addConstraint({
            id: conId,
            type: 'vertical',
            lineId: selectedLines[0]
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private applyParallel() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => /^L\d+$/.test(id));
        if (selectedLines.length !== 2) {
            alert("Select exactly 2 lines to make parallel.");
            return;
        }

        const conId = this.model.makeUniqueConstraintId(`Parallel_${selectedLines[0]}_${selectedLines[1]}`);
        this.model.addConstraint({
            id: conId,
            type: 'parallel',
            line1Id: selectedLines[0],
            line2Id: selectedLines[1]
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private applyPerpendicular() {
        const selectedLines = this.model.getSelectedEntityIds().filter(id => /^L\d+$/.test(id));
        if (selectedLines.length !== 2) {
            alert("Select exactly 2 lines to make perpendicular.");
            return;
        }

        const conId = this.model.makeUniqueConstraintId(`Perp_${selectedLines[0]}_${selectedLines[1]}`);
        this.model.addConstraint({
            id: conId,
            type: 'perpendicular',
            line1Id: selectedLines[0],
            line2Id: selectedLines[1]
        });

        this.model.setSelectedEntityIds([]);
        this.runGCSSolver();
    }

    private togglePointFixed() {
        const selectedPoints = this.model.getSelectedEntityIds().filter(id => /^P\d+$/.test(id));
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

    private clearWorkspace() {
        if (confirm("Are you sure you want to clear the entire workspace?")) {
            this.model.clear();
            this.resetDrawingState();
            this.store.save(this.model);
        }
    }
}

// Global Application Instance
let controller: SketchController;

// Bootstrap DOM bindings on load
window.addEventListener('DOMContentLoaded', async () => {
    controller = new SketchController();
    await controller.init();

    // Bind toolbar button selections
    const tools: ToolMode[] = ['select', 'point', 'line', 'circle', 'dimension'];
    tools.forEach(tool => {
        document.getElementById(`btn-${tool}`)?.addEventListener('click', () => {
            controller.model.setTool(tool);
        });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (document.activeElement?.tagName === 'INPUT') {
            return;
        }

        if (e.key === 'Escape') {
            controller.cancelActiveOperation();
        } else if (e.key === 'd' || e.key === 'D') {
            controller.model.setTool('dimension');
        } else if (e.key === 'f' || e.key === 'F') {
            controller.viewport.zoomToFit();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            controller.deleteSelected();
        }
    });

    // Expose self-test function globally for manual/automated test runners
    (window as any).runSelfTest = runSelfTest;
});

/**
 * Diagnostics self-test. Integrates with the new object-oriented structure
 * to simulate entity creation, hover visuals updates, and active drags.
 */
export function runSelfTest() {
    console.log("--- Starting Viewport UI Diagnostics Self-Test ---");
    const results: { name: string; pass: boolean; detail: string }[] = [];

    function assert(name: string, condition: boolean, detail: string) {
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
    const ptGroup = mainLayer.findOne('#' + pId) as any;
    assert("Point group exists", !!ptGroup, `findOne('#${pId}') = ${ptGroup}`);
    assert("Point is draggable", ptGroup?.draggable() === true, `draggable=${ptGroup?.draggable()}`);
    assert("Point at correct position", ptGroup?.x() === 100 && ptGroup?.y() === 100,
        `pos=(${ptGroup?.x()}, ${ptGroup?.y()})`);

    // --- Test 2: Hover preserves node identity ---
    console.log("\n2. Hover preserves node identity...");
    const nodeBeforeHover = mainLayer.findOne('#' + pId);
    controller.model.setHoveredEntityId(pId);
    controller.viewport.updateEntityVisuals();
    const nodeAfterHover = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after hover",
        nodeBeforeHover === nodeAfterHover,
        `same ref = ${nodeBeforeHover === nodeAfterHover}`);
    assert("Node still draggable after hover",
        (nodeAfterHover as any)?.draggable() === true,
        `draggable=${(nodeAfterHover as any)?.draggable()}`);

    controller.model.setHoveredEntityId(null);
    controller.viewport.updateEntityVisuals();
    const nodeAfterLeave = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after leave",
        nodeBeforeHover === nodeAfterLeave,
        `same ref = ${nodeBeforeHover === nodeAfterLeave}`);

    // --- Test 3: Drag after hover (the real user scenario) ---
    console.log("\n3. Drag after hover...");
    controller.model.setHoveredEntityId(pId);
    controller.viewport.updateEntityVisuals();

    const dragNode = mainLayer.findOne('#' + pId) as any;
    assert("Drag node found after hover", !!dragNode, `node=${dragNode}`);

    controller.viewport.setDraggedPointId(pId);
    dragNode.fire('dragstart');

    dragNode.x(200);
    dragNode.y(150);
    // Simulate drag move updates in data model and visually
    controller.model.getPoint(pId)!.x = 200;
    controller.model.getPoint(pId)!.y = 150;
    dragNode.fire('dragmove');

    dragNode.fire('dragend');
    controller.viewport.setDraggedPointId(null);

    const pData = controller.model.getPoint(pId);
    assert("Point data updated after drag",
        pData?.x === 200 && pData?.y === 150,
        `data=(${pData?.x}, ${pData?.y})`);

    // --- Test 4: redrawAll destroys nodes (regression proof) ---
    console.log("\n4. redrawAll() destroys node references (regression proof)...");
    const nodeBefore = mainLayer.findOne('#' + pId);
    controller.viewport.redrawAll();
    const nodeAfterRedraw = mainLayer.findOne('#' + pId);
    assert("redrawAll creates different node",
        nodeBefore !== nodeAfterRedraw,
        `same ref = ${nodeBefore === nodeAfterRedraw} (expected false)`);

    // --- Summary ---
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const summary = `Self-test complete: ${passed} passed, ${failed} failed out of ${results.length} assertions.`;
    
    if (failed === 0) {
        console.log(`%cSUCCESS: ${summary}`, 'color: #10b981; font-weight: bold; font-size: 1.1em;');
    } else {
        const failDetails = results.filter(r => !r.pass).map(r => `• ${r.name}: ${r.detail}`).join('\n');
        console.error(`FAILED: ${summary}\n\nFailures:\n${failDetails}`);
    }
}
