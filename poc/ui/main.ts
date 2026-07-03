import { GCSapi, GCSPoint, GCSLine, GCSCircle, GCSConstraint, GCSSketchState } from '../gcsapi/gcsapi.js';

// Declare Konva globally since it is loaded via CDN script
declare const Konva: any;

// App State
let points: GCSPoint[] = [];
let lines: GCSLine[] = [];
let circles: GCSCircle[] = [];
let constraints: GCSConstraint[] = [];

let selectedEntityIds: string[] = [];
let hoveredEntityId: string | null = null;
let hoveredConstraintId: string | null = null;

// Drawing state
type ToolMode = 'select' | 'point' | 'line' | 'circle';
let currentTool: ToolMode = 'select';

// Temporary drawing states
let lineStartPointId: string | null = null;
let circleCenterPointId: string | null = null;
let tempLinePreview: any = null;
let tempCirclePreview: any = null;

// Snap State
let activeSnapPointId: string | null = null;
let snapIndicator: any = null;

// Stage Panning State
let isPanning = false;
let panStart = { x: 0, y: 0 };
let stageStart = { x: 0, y: 0 };
let draggedPointId: string | null = null;

// GCS API Client
const gcs = new GCSapi();

// IndexedDB Persistence Setup
const DB_NAME = 'WebCADSketcherDB';
const STORE_NAME = 'SketchStateStore';
const SKETCH_KEY = 'currentSketch';

function getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveSketchToDB() {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const state: GCSSketchState = { points, lines, circles, constraints };
        store.put(state, SKETCH_KEY);
    } catch (e) {
        console.error('Failed to save sketch to IndexedDB:', e);
    }
}

async function loadSketchFromDB() {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(SKETCH_KEY);
        
        return new Promise<void>((resolve) => {
            request.onsuccess = () => {
                const state = request.result as GCSSketchState | undefined;
                if (state) {
                    points = state.points || [];
                    lines = state.lines || [];
                    circles = state.circles || [];
                    constraints = state.constraints || [];
                    console.log('Sketch state loaded from IndexedDB.');
                }
                resolve();
            };
            request.onerror = () => {
                console.error('Failed to load sketch from IndexedDB:', request.error);
                resolve();
            };
        });
    } catch (e) {
        console.error('Failed to initialize IndexedDB for loading:', e);
    }
}

// Initialize GCS solver
async function initSolver() {
    try {
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = 'Loading GCS...';
        
        // Pass path to the generated WASM binary relative to current URL
        await gcs.init('/dist/solver-wasm/solver_wasm_bindgen/solver_wasm_bindgen_bg.wasm');
        
        if (statusText) {
            statusText.innerText = 'GCS Solver Ready';
            statusText.style.color = 'var(--success-color)';
            statusText.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            statusText.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
        }
        console.log('GCS solver loaded successfully.');
    } catch (e) {
        console.error('Failed to initialize GCS solver:', e);
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.innerText = 'Solver Error';
            statusText.style.color = 'var(--danger-color)';
            statusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            statusText.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        }
    }
}

// Konva Graphics Setup
let stage: any;
let mainLayer: any;
let gridLayer: any;

function setupCanvas() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    stage = new Konva.Stage({
        container: 'canvas-container',
        width: container.clientWidth,
        height: container.clientHeight
    });

    gridLayer = new Konva.Layer();
    mainLayer = new Konva.Layer();

    stage.add(gridLayer);
    stage.add(mainLayer);

    drawGrid();

    // Resize Handler
    window.addEventListener('resize', () => {
        stage.width(container.clientWidth);
        stage.height(container.clientHeight);
        drawGrid();
    });

    // Snap Indicator setup
    snapIndicator = new Konva.Circle({
        radius: 8,
        stroke: 'var(--success-color)',
        strokeWidth: 2,
        visible: false,
        listening: false
    });
    mainLayer.add(snapIndicator);

    // Event Listeners
    stage.on('mousedown', (e: any) => {
        if (e.evt.button === 1) { // Middle click
            isPanning = true;
            const pos = stage.getPointerPosition();
            if (pos) {
                panStart = { x: pos.x, y: pos.y };
                stageStart = { x: stage.x(), y: stage.y() };
            }
            stage.container().style.cursor = 'grabbing';
            e.cancelBubble = true;
            return;
        }
        handleStageMouseDown(e);
    });

    stage.on('mousemove', (e: any) => {
        if (isPanning) {
            const pos = stage.getPointerPosition();
            if (pos) {
                const dx = pos.x - panStart.x;
                const dy = pos.y - panStart.y;
                stage.position({
                    x: stageStart.x + dx,
                    y: stageStart.y + dy
                });
                redrawAll();
            }
            return;
        }
        handleStageMouseMove();
    });

    stage.on('mouseup', (e: any) => {
        if (isPanning) {
            isPanning = false;
            stage.container().style.cursor = currentTool === 'select' ? 'default' : 'crosshair';
        }
    });

    stage.on('mouseleave', () => {
        if (isPanning) {
            isPanning = false;
            stage.container().style.cursor = currentTool === 'select' ? 'default' : 'crosshair';
        }
    });

    // Zoom on scroll (wheel)
    stage.on('wheel', (e: any) => {
        e.evt.preventDefault();
        const scaleBy = 1.08;
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        const boundedScale = Math.max(0.1, Math.min(newScale, 15.0));

        stage.scale({ x: boundedScale, y: boundedScale });

        const newPos = {
            x: pointer.x - mousePointTo.x * boundedScale,
            y: pointer.y - mousePointTo.y * boundedScale,
        };
        stage.position(newPos);
        redrawAll();
    });

    stage.on('dblclick', () => {
        zoomToFit();
    });

    // Initial Render
    redrawAll();
}

function drawGrid() {
    gridLayer.destroyChildren();
    const width = stage.width();
    const height = stage.height();

    const scale = stage.scaleX();
    const posX = stage.x();
    const posY = stage.y();

    const gridSpacing = 40;

    // Calculate grid boundaries in screen coordinates
    const startX = Math.floor(-posX / (gridSpacing * scale)) * gridSpacing;
    const endX = startX + (width / scale) + gridSpacing;

    const startY = Math.floor(-posY / (gridSpacing * scale)) * gridSpacing;
    const endY = startY + (height / scale) + gridSpacing;

    // Draw grid dots
    for (let x = startX; x < endX; x += gridSpacing) {
        for (let y = startY; y < endY; y += gridSpacing) {
            // Transform grid coordinate to screen pixels
            const screenX = posX + x * scale;
            const screenY = posY + y * scale;

            if (screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height) {
                const dot = new Konva.Circle({
                    x: screenX,
                    y: screenY,
                    radius: 1,
                    fill: 'var(--border-color)',
                    opacity: 0.3,
                    listening: false
                });
                gridLayer.add(dot);
            }
        }
    }
    gridLayer.draw();
}

function zoomToFit() {
    const padding = 60;
    const width = stage.width();
    const height = stage.height();

    if (points.length === 0) {
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        redrawAll();
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const boxW = (maxX - minX) || 120;
    const boxH = (maxY - minY) || 120;
    const centerX = minX + boxW / 2;
    const centerY = minY + boxH / 2;

    const scaleX = (width - padding * 2) / boxW;
    const scaleY = (height - padding * 2) / boxH;
    const newScale = Math.max(0.2, Math.min(scaleX, scaleY, 2.5));

    stage.scale({ x: newScale, y: newScale });
    stage.position({
        x: width / 2 - centerX * newScale,
        y: height / 2 - centerY * newScale
    });

    redrawAll();
}

// Entity & Coordinate Helpers
function getPoint(id: string): GCSPoint | undefined {
    return points.find(p => p.id === id);
}

function getStagePointerPosition(): { x: number, y: number } | null {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(pos);
}

function generateId(prefix: string): string {
    return prefix + '_' + Math.random().toString(36).substr(2, 9);
}

// Distance helper
function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Find closest point within snap tolerance
function findClosestPoint(x: number, y: number, tolerance = 12): GCSPoint | null {
    let closest: GCSPoint | null = null;
    let minDist = tolerance;

    for (const p of points) {
        const d = distance(x, y, p.x, p.y);
        if (d < minDist) {
            minDist = d;
            closest = p;
        }
    }
    return closest;
}

// Update UI Tool / HUD status
function setTool(mode: ToolMode) {
    currentTool = mode;
    
    // Update toolbar active class
    const buttons = document.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tool') === mode) {
            btn.classList.add('active');
        }
    });

    // Update HUD text
    const hud = document.getElementById('help-hud');
    if (hud) {
        switch (mode) {
            case 'select':
                hud.innerHTML = `Mode: <span>Select</span>. Click canvas to select or drag entities.`;
                break;
            case 'point':
                hud.innerHTML = `Mode: <span>Point</span>. Click canvas to place new points.`;
                break;
            case 'line':
                hud.innerHTML = `Mode: <span>Line</span>. Click to select/create start point, click again to connect.`;
                break;
            case 'circle':
                hud.innerHTML = `Mode: <span>Circle</span>. Click to select center point, click again to define radius.`;
                break;
        }
    }

    // Reset temporary states
    resetDrawingState();
    redrawAll();
}

function resetDrawingState() {
    lineStartPointId = null;
    circleCenterPointId = null;
    
    if (tempLinePreview) {
        tempLinePreview.destroy();
        tempLinePreview = null;
    }
    if (tempCirclePreview) {
        tempCirclePreview.destroy();
        tempCirclePreview = null;
    }
    snapIndicator.visible(false);
    activeSnapPointId = null;
}

// GCS SOLVING PIPELINE
function runGCSSolver() {
    try {
        // Temporarily fix the dragged point so the GCS solves around it
        let originalFixedState = false;
        let tempFixedPoint: GCSPoint | undefined;
        if (draggedPointId) {
            tempFixedPoint = getPoint(draggedPointId);
            if (tempFixedPoint) {
                originalFixedState = !!tempFixedPoint.fixed;
                tempFixedPoint.fixed = true;
            }
        }

        const state: GCSSketchState = { points, lines, circles, constraints };
        const result = gcs.solve(state);

        // Restore original fixed state
        if (tempFixedPoint) {
            tempFixedPoint.fixed = originalFixedState;
        }

        const statusText = document.getElementById('status-text');

        if (result.success) {
            // Update point positions
            result.points.forEach(sp => {
                const p = getPoint(sp.id);
                if (p) {
                    p.x = sp.x;
                    p.y = sp.y;
                }
            });

            // Update circle radius values
            result.circles.forEach(sc => {
                const c = circles.find(x => x.id === sc.id);
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
        } else {
            if (statusText) {
                statusText.innerText = 'Over-constrained / Error';
                statusText.style.color = 'var(--danger-color)';
                statusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                statusText.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            }
            console.warn('GCS solver warning:', result.error);
        }
        saveSketchToDB();
    } catch (e) {
        console.error('Solver crash:', e);
    }
}

// STAGE EVENTS
function handleStageMouseDown(e: any) {
    const pos = getStagePointerPosition();
    if (!pos) return;

    // Check snapping
    const snap = findClosestPoint(pos.x, pos.y);
    const targetX = snap ? snap.x : pos.x;
    const targetY = snap ? snap.y : pos.y;

    if (currentTool === 'point') {
        if (!snap) {
            const pId = generateId('P');
            points.push({ id: pId, x: pos.x, y: pos.y });
            runGCSSolver();
            redrawAll();
        }
    } else if (currentTool === 'line') {
        if (lineStartPointId === null) {
            // Select start point
            if (snap) {
                lineStartPointId = snap.id;
            } else {
                const pId = generateId('P');
                points.push({ id: pId, x: pos.x, y: pos.y });
                lineStartPointId = pId;
            }
            
            // Start preview
            tempLinePreview = new Konva.Line({
                points: [targetX, targetY, targetX, targetY],
                stroke: 'var(--accent-color)',
                strokeWidth: 2,
                dash: [4, 4],
                listening: false
            });
            mainLayer.add(tempLinePreview);
        } else {
            // Finish line
            let endId: string;
            if (snap) {
                endId = snap.id;
            } else {
                endId = generateId('P');
                points.push({ id: endId, x: pos.x, y: pos.y });
            }

            // Create Line
            if (lineStartPointId !== endId) {
                lines.push({
                    id: generateId('L'),
                    p1Id: lineStartPointId,
                    p2Id: endId
                });
            }

            resetDrawingState();
            runGCSSolver();
            redrawAll();
        }
    } else if (currentTool === 'circle') {
        if (circleCenterPointId === null) {
            // Select center point
            if (snap) {
                circleCenterPointId = snap.id;
            } else {
                const pId = generateId('P');
                points.push({ id: pId, x: pos.x, y: pos.y });
                circleCenterPointId = pId;
            }

            // Start preview
            tempCirclePreview = new Konva.Circle({
                x: targetX,
                y: targetY,
                radius: 0,
                stroke: 'var(--accent-color)',
                strokeWidth: 2,
                dash: [4, 4],
                listening: false
            });
            mainLayer.add(tempCirclePreview);
        } else {
            // Finish Circle
            const center = getPoint(circleCenterPointId);
            if (center) {
                const rad = distance(center.x, center.y, pos.x, pos.y);
                circles.push({
                    id: generateId('C'),
                    centerId: circleCenterPointId,
                    radius: Math.max(5, rad)
                });
            }
            resetDrawingState();
            runGCSSolver();
            redrawAll();
        }
    } else if (currentTool === 'select') {
        // Handle clear selection if clicking empty canvas space
        const clickedOnEmpty = e.target === stage || e.target === gridLayer;
        if (clickedOnEmpty) {
            selectedEntityIds = [];
            redrawAll();
        }
    }
}

function handleStageMouseMove() {
    const pos = getStagePointerPosition();
    if (!pos) return;

    // Snap and Highlights checking
    const snap = findClosestPoint(pos.x, pos.y);
    if (snap) {
        snapIndicator.x(snap.x);
        snapIndicator.y(snap.y);
        snapIndicator.visible(true);
        activeSnapPointId = snap.id;
    } else {
        snapIndicator.visible(false);
        activeSnapPointId = null;
    }

    const targetX = snap ? snap.x : pos.x;
    const targetY = snap ? snap.y : pos.y;

    // Update previews
    if (currentTool === 'line' && lineStartPointId) {
        const start = getPoint(lineStartPointId);
        if (start && tempLinePreview) {
            tempLinePreview.points([start.x, start.y, targetX, targetY]);
        }
    } else if (currentTool === 'circle' && circleCenterPointId) {
        const center = getPoint(circleCenterPointId);
        if (center && tempCirclePreview) {
            const rad = distance(center.x, center.y, targetX, targetY);
            tempCirclePreview.radius(rad);
        }
    }

    mainLayer.batchDraw();
}

// RENDERING / CANVAS REDRAW
function redrawAll() {
    // 1. Clear Layer
    mainLayer.destroyChildren();

    // Re-add snap indicator
    mainLayer.add(snapIndicator);

    // 2. Draw Lines
    lines.forEach(l => {
        const p1 = getPoint(l.p1Id);
        const p2 = getPoint(l.p2Id);
        if (!p1 || !p2) return;

        const isSelected = selectedEntityIds.includes(l.id);
        const isHovered = hoveredEntityId === l.id || 
            (hoveredConstraintId && isConstraintEntityHovered(l.id));

        const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : 'var(--text-muted)');
        const strokeWidth = isSelected || isHovered ? 4 : 2.5;

        const lineShape = new Konva.Line({
            points: [p1.x, p1.y, p2.x, p2.y],
            stroke: strokeColor,
            strokeWidth: strokeWidth,
            id: l.id
        });

        // Hover events (in-place visual updates to preserve Konva node references)
        lineShape.on('mouseenter', () => {
            if (currentTool === 'select') {
                hoveredEntityId = l.id;
                stage.container().style.cursor = 'pointer';
                updateEntityVisuals();
            }
        });
        lineShape.on('mouseleave', () => {
            if (hoveredEntityId === l.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                updateEntityVisuals();
            }
        });

        // Select click
        lineShape.on('click', (e: any) => {
            if (currentTool === 'select') {
                e.cancelBubble = true; // Stop event bubbling to stage
                toggleSelect(l.id);
            }
        });

        mainLayer.add(lineShape);
    });

    // 3. Draw Circles
    circles.forEach(c => {
        const center = getPoint(c.centerId);
        if (!center) return;

        const isSelected = selectedEntityIds.includes(c.id);
        const isHovered = hoveredEntityId === c.id ||
            (hoveredConstraintId && isConstraintEntityHovered(c.id));

        const strokeColor = isSelected ? '#3b82f6' : (isHovered ? 'var(--accent-color)' : '#64748b');
        const strokeWidth = isSelected || isHovered ? 3.5 : 2;

        const circleShape = new Konva.Circle({
            x: center.x,
            y: center.y,
            radius: c.radius,
            stroke: strokeColor,
            strokeWidth: strokeWidth,
            id: c.id
        });

        circleShape.on('mouseenter', () => {
            if (currentTool === 'select') {
                hoveredEntityId = c.id;
                stage.container().style.cursor = 'pointer';
                updateEntityVisuals();
            }
        });
        circleShape.on('mouseleave', () => {
            if (hoveredEntityId === c.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                updateEntityVisuals();
            }
        });

        circleShape.on('click', (e: any) => {
            if (currentTool === 'select') {
                e.cancelBubble = true;
                toggleSelect(c.id);
            }
        });

        mainLayer.add(circleShape);
    });

    // 4. Draw Points (Interactive draggable objects)
    points.forEach(p => {
        const isSelected = selectedEntityIds.includes(p.id);
        const isHovered = hoveredEntityId === p.id ||
            (hoveredConstraintId && isConstraintEntityHovered(p.id));

        let pointColor = 'var(--text-color)';
        if (p.fixed) {
            pointColor = 'var(--danger-color)'; // Red lock point
        } else if (isSelected) {
            pointColor = '#3b82f6';
        } else if (isHovered) {
            pointColor = 'var(--accent-color)';
        }

        const pointGroup = new Konva.Group({
            x: p.x,
            y: p.y,
            draggable: currentTool === 'select' && !p.fixed,
            id: p.id
        });

        // Visible circle dot
        const dot = new Konva.Circle({
            name: 'dot',
            radius: isHovered || isSelected ? 6 : 4.5,
            fill: pointColor,
            stroke: p.fixed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0,0,0,0.5)',
            strokeWidth: 1.5
        });

        // Invisible larger hit area for easier grabbing (using rgba for hit detection)
        const hitArea = new Konva.Circle({
            name: 'hitArea',
            radius: 16,
            fill: 'rgba(0, 0, 0, 0)'
        });

        pointGroup.add(hitArea);
        pointGroup.add(dot);

        // Prevent event bubbling to stage on mousedown
        pointGroup.on('mousedown', (e: any) => {
            if (currentTool === 'select') {
                e.cancelBubble = true;
            }
        });

        // Drag handlers
        pointGroup.on('dragstart', () => {
            draggedPointId = p.id;
        });

        pointGroup.on('dragmove', (e: any) => {
            p.x = pointGroup.x();
            p.y = pointGroup.y();
            runGCSSolver();

            // Update lines in-place to follow drag without disrupting gesture
            lines.forEach(l => {
                const p1 = getPoint(l.p1Id);
                const p2 = getPoint(l.p2Id);
                if (!p1 || !p2) return;
                const lineShape = mainLayer.findOne('#' + l.id);
                if (lineShape) {
                    lineShape.points([p1.x, p1.y, p2.x, p2.y]);
                }
            });

            // Update circles in-place
            circles.forEach(c => {
                const center = getPoint(c.centerId);
                if (!center) return;
                const circleShape = mainLayer.findOne('#' + c.id);
                if (circleShape) {
                    circleShape.x(center.x);
                    circleShape.y(center.y);
                    circleShape.radius(c.radius);
                }
            });

            // Update other points in case solver shifted them due to constraints
            points.forEach(otherPoint => {
                if (otherPoint.id !== p.id) {
                    const ptGroup = mainLayer.findOne('#' + otherPoint.id);
                    if (ptGroup) {
                        ptGroup.x(otherPoint.x);
                        ptGroup.y(otherPoint.y);
                    }
                }
            });

            mainLayer.batchDraw();
        });

        pointGroup.on('dragend', () => {
            draggedPointId = null;
            runGCSSolver();
            redrawAll();
        });

        pointGroup.on('mouseenter', () => {
            if (currentTool === 'select') {
                hoveredEntityId = p.id;
                stage.container().style.cursor = 'pointer';
                updateEntityVisuals();
            }
        });
        pointGroup.on('mouseleave', () => {
            if (hoveredEntityId === p.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                updateEntityVisuals();
            }
        });

        pointGroup.on('click', (e: any) => {
            if (isDistanceSelectionActive) {
                e.cancelBubble = true;
                if (!selectedEntityIds.includes(p.id)) {
                    selectedEntityIds.push(p.id);
                    const hud = document.getElementById('help-hud');
                    if (selectedEntityIds.length === 1) {
                        if (hud) hud.innerHTML = `Mode: <span>Distance Selection</span>. Select second point.`;
                    } else if (selectedEntityIds.length === 2) {
                        applyDistance();
                    }
                }
                redrawAll();
            } else if (currentTool === 'select') {
                e.cancelBubble = true;
                toggleSelect(p.id);
            }
        });

        mainLayer.add(pointGroup);
    });

    mainLayer.draw();

    // 5. Update Sidebar List Elements
    renderSidebar();
}

/**
 * Updates visual properties (fill, stroke, radius) of existing Konva nodes
 * in-place based on hover and selection state.
 *
 * Unlike redrawAll(), this function does NOT destroy or recreate any nodes.
 * This is critical because Konva tracks drag state internally via node
 * references. Calling mainLayer.destroyChildren() during a mouseenter event
 * invalidates the node reference under the cursor, making subsequent
 * mousedown/drag events silently fail.
 */
function updateEntityVisuals() {
    // Update line visuals
    lines.forEach(l => {
        const lineShape = mainLayer.findOne('#' + l.id) as any;
        if (!lineShape) return;

        const isSelected = selectedEntityIds.includes(l.id);
        const isHovered = hoveredEntityId === l.id ||
            (hoveredConstraintId && isConstraintEntityHovered(l.id));

        lineShape.stroke(isSelected ? '#3b82f6' : (isHovered ? '#1a73e8' : '#64748b'));
        lineShape.strokeWidth(isSelected || isHovered ? 4 : 2.5);
    });

    // Update circle visuals
    circles.forEach(c => {
        const circleShape = mainLayer.findOne('#' + c.id) as any;
        if (!circleShape) return;

        const isSelected = selectedEntityIds.includes(c.id);
        const isHovered = hoveredEntityId === c.id ||
            (hoveredConstraintId && isConstraintEntityHovered(c.id));

        circleShape.stroke(isSelected ? '#3b82f6' : (isHovered ? '#1a73e8' : '#64748b'));
        circleShape.strokeWidth(isSelected || isHovered ? 3.5 : 2);
    });

    // Update point visuals (skip the currently dragged point to prevent
    // fill/stroke separation artifacts during active drag gestures)
    points.forEach(p => {
        if (p.id === draggedPointId) return;

        const pointGroup = mainLayer.findOne('#' + p.id) as any;
        if (!pointGroup) return;

        const isSelected = selectedEntityIds.includes(p.id);
        const isHovered = hoveredEntityId === p.id ||
            (hoveredConstraintId && isConstraintEntityHovered(p.id));

        let pointColor = '#334155';  // var(--text-color) fallback
        if (p.fixed) {
            pointColor = '#ef4444';  // var(--danger-color) fallback
        } else if (isSelected) {
            pointColor = '#3b82f6';
        } else if (isHovered) {
            pointColor = '#1a73e8';  // var(--accent-color) fallback
        }

        // Find the visible dot by name instead of child index
        const dot = pointGroup.findOne('.dot');
        if (dot) {
            dot.radius(isHovered || isSelected ? 6 : 4.5);
            dot.fill(pointColor);
        }
    });

    mainLayer.batchDraw();
}

function toggleSelect(id: string) {
    const idx = selectedEntityIds.indexOf(id);
    if (idx > -1) {
        selectedEntityIds.splice(idx, 1);
    } else {
        selectedEntityIds.push(id);
    }
    redrawAll();
}

// RHS SIDEBAR RENDER SYNC
function renderSidebar() {
    // 1. Render Points
    const pContainer = document.getElementById('list-points');
    if (pContainer) {
        pContainer.innerHTML = '';
        points.forEach(p => {
            const item = document.createElement('div');
            item.className = `list-item ${selectedEntityIds.includes(p.id) ? 'selected' : ''}`;
            item.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${p.id} ${p.fixed ? '🔒' : ''}</span>
                    <span class="item-subtitle">X: ${p.x.toFixed(1)}, Y: ${p.y.toFixed(1)}</span>
                </div>
                <div class="item-actions">
                    <button class="action-btn" data-delete="${p.id}">✕</button>
                </div>
            `;
            // Hover highlights
            item.addEventListener('mouseenter', () => { hoveredEntityId = p.id; redrawAll(); });
            item.addEventListener('mouseleave', () => { hoveredEntityId = null; redrawAll(); });
            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    toggleSelect(p.id);
                }
            });
            pContainer.appendChild(item);
        });
    }

    // 2. Render Lines
    const lContainer = document.getElementById('list-lines');
    if (lContainer) {
        lContainer.innerHTML = '';
        lines.forEach(l => {
            const item = document.createElement('div');
            item.className = `list-item ${selectedEntityIds.includes(l.id) ? 'selected' : ''}`;
            item.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${l.id}</span>
                    <span class="item-subtitle">${l.p1Id} ➔ ${l.p2Id}</span>
                </div>
                <div class="item-actions">
                    <button class="action-btn" data-delete="${l.id}">✕</button>
                </div>
            `;
            item.addEventListener('mouseenter', () => { hoveredEntityId = l.id; redrawAll(); });
            item.addEventListener('mouseleave', () => { hoveredEntityId = null; redrawAll(); });
            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    toggleSelect(l.id);
                }
            });
            lContainer.appendChild(item);
        });
    }

    // 3. Render Circles
    const cContainer = document.getElementById('list-circles');
    if (cContainer) {
        cContainer.innerHTML = '';
        circles.forEach(c => {
            const item = document.createElement('div');
            item.className = `list-item ${selectedEntityIds.includes(c.id) ? 'selected' : ''}`;
            item.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${c.id}</span>
                    <span class="item-subtitle">Center: ${c.centerId}, R: ${c.radius.toFixed(1)}</span>
                </div>
                <div class="item-actions">
                    <button class="action-btn" data-delete="${c.id}">✕</button>
                </div>
            `;
            item.addEventListener('mouseenter', () => { hoveredEntityId = c.id; redrawAll(); });
            item.addEventListener('mouseleave', () => { hoveredEntityId = null; redrawAll(); });
            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    toggleSelect(c.id);
                }
            });
            cContainer.appendChild(item);
        });
    }

    // 4. Render Constraints
    const conContainer = document.getElementById('list-constraints');
    if (conContainer) {
        conContainer.innerHTML = '';
        constraints.forEach(con => {
            const item = document.createElement('div');
            item.className = 'list-item';
            
            let desc = '';
            switch (con.type) {
                case 'coincident': desc = `Coincident: ${con.p1Id} & ${con.p2Id}`; break;
                case 'distance': desc = `Distance: ${con.p1Id} & ${con.p2Id} = ${con.value.toFixed(1)}`; break;
                case 'vertical': desc = `Vertical: ${con.lineId}`; break;
                case 'horizontal': desc = `Horizontal: ${con.lineId}`; break;
                case 'parallel': desc = `Parallel: ${con.line1Id} & ${con.line2Id}`; break;
                case 'perpendicular': desc = `Perpendicular: ${con.line1Id} & ${con.line2Id}`; break;
            }

            item.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${con.type.toUpperCase()}</span>
                    <span class="item-subtitle">${desc}</span>
                </div>
                <div class="item-actions">
                    <button class="action-btn" data-con-delete="${con.id}">✕</button>
                </div>
            `;
            item.addEventListener('mouseenter', () => { hoveredConstraintId = con.id; redrawAll(); });
            item.addEventListener('mouseleave', () => { hoveredConstraintId = null; redrawAll(); });
            conContainer.appendChild(item);
        });
    }

    // Bind Delete Click Handlers
    const deleteBtns = document.querySelectorAll('[data-delete]');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).getAttribute('data-delete');
            if (id) deleteEntity(id);
        });
    });

    const deleteConBtns = document.querySelectorAll('[data-con-delete]');
    deleteConBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).getAttribute('data-con-delete');
            if (id) deleteConstraint(id);
        });
    });
}

// HELPER: Checks if an entity is part of the hovered constraint
function isConstraintEntityHovered(entityId: string): boolean {
    if (!hoveredConstraintId) return false;
    const con = constraints.find(c => c.id === hoveredConstraintId);
    if (!con) return false;

    switch (con.type) {
        case 'coincident':
        case 'distance':
            return con.p1Id === entityId || con.p2Id === entityId;
        case 'vertical':
        case 'horizontal':
            return con.lineId === entityId;
        case 'parallel':
        case 'perpendicular':
            return con.line1Id === entityId || con.line2Id === entityId;
    }
    return false;
}

// ENTITY & CONSTRAINT DELETION
function deleteEntity(id: string) {
    // 1. Remove entity
    points = points.filter(p => p.id !== id);
    lines = lines.filter(l => l.id !== id);
    circles = circles.filter(c => c.id !== id);

    // 2. Cascade delete lines/circles linked to deleted points
    if (id.startsWith('P_')) {
        lines = lines.filter(l => l.p1Id !== id && l.p2Id !== id);
        circles = circles.filter(c => c.centerId !== id);
    }

    // 3. Cascade delete constraints referencing deleted items
    constraints = constraints.filter(con => {
        switch (con.type) {
            case 'coincident':
            case 'distance':
                return con.p1Id !== id && con.p2Id !== id;
            case 'vertical':
            case 'horizontal':
                return con.lineId !== id;
            case 'parallel':
            case 'perpendicular':
                return con.line1Id !== id && con.line2Id !== id;
        }
        return true;
    });

    selectedEntityIds = selectedEntityIds.filter(x => x !== id);
    runGCSSolver();
    redrawAll();
}

function deleteConstraint(id: string) {
    constraints = constraints.filter(c => c.id !== id);
    runGCSSolver();
    redrawAll();
}

// APPLYING CONSTRAINTS VIA SELECTION
function applyCoincident() {
    const selectedPoints = selectedEntityIds.filter(id => id.startsWith('P_'));
    if (selectedPoints.length !== 2) {
        alert("Select exactly 2 points to make coincident.");
        return;
    }

    constraints.push({
        id: generateId('CON'),
        type: 'coincident',
        p1Id: selectedPoints[0],
        p2Id: selectedPoints[1]
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

let isDistanceSelectionActive = false;

function showInlineDistanceInput(p1: GCSPoint, p2: GCSPoint) {
    const input = document.getElementById('inline-distance-input') as HTMLInputElement;
    if (!input) return;

    // Calculate current Euclidean distance
    const currentDist = distance(p1.x, p1.y, p2.x, p2.y);
    
    // Position input near the second point (taking zoom and pan into account)
    const screenX = stage.x() + p2.x * stage.scaleX();
    const screenY = stage.y() + p2.y * stage.scaleY();

    input.value = currentDist.toFixed(1);
    input.style.left = `${screenX + 15}px`;
    input.style.top = `${screenY - 15}px`;
    input.style.display = 'block';
    
    input.focus();
    input.select();

    // Input handlers
    const applyInput = () => {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val > 0) {
            constraints.push({
                id: generateId('CON'),
                type: 'distance',
                p1Id: p1.id,
                p2Id: p2.id,
                value: val
            });
            runGCSSolver();
        }
        hideInlineDistanceInput();
    };

    const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            applyInput();
        } else if (e.key === 'Escape') {
            hideInlineDistanceInput();
        }
    };

    const blurHandler = () => {
        applyInput();
    };

    input.addEventListener('keydown', keyHandler);
    input.addEventListener('blur', blurHandler);

    // Store references to clean up listeners later
    (input as any)._cleanup = () => {
        input.removeEventListener('keydown', keyHandler);
        input.removeEventListener('blur', blurHandler);
    };
}

function hideInlineDistanceInput() {
    const input = document.getElementById('inline-distance-input') as HTMLInputElement;
    if (!input) return;
    
    input.style.display = 'none';
    if ((input as any)._cleanup) {
        (input as any)._cleanup();
        (input as any)._cleanup = null;
    }
    selectedEntityIds = [];
    isDistanceSelectionActive = false;
    setTool('select');
    redrawAll();
}

function applyDistance() {
    const selectedPoints = selectedEntityIds.filter(id => id.startsWith('P_'));
    
    if (selectedPoints.length === 2) {
        const p1 = getPoint(selectedPoints[0]);
        const p2 = getPoint(selectedPoints[1]);
        if (p1 && p2) {
            showInlineDistanceInput(p1, p2);
        }
    } else {
        // Start sequential distance selection mode
        isDistanceSelectionActive = true;
        selectedEntityIds = [];
        const hud = document.getElementById('help-hud');
        if (hud) hud.innerHTML = `Mode: <span>Distance Selection</span>. Select first point for distance constraint.`;
        setTool('select'); // Ensure we are in select tool
        redrawAll();
    }
}

function applyHorizontal() {
    const selectedLines = selectedEntityIds.filter(id => id.startsWith('L_'));
    if (selectedLines.length !== 1) {
        alert("Select exactly 1 line to make horizontal.");
        return;
    }

    constraints.push({
        id: generateId('CON'),
        type: 'horizontal',
        lineId: selectedLines[0]
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

function applyVertical() {
    const selectedLines = selectedEntityIds.filter(id => id.startsWith('L_'));
    if (selectedLines.length !== 1) {
        alert("Select exactly 1 line to make vertical.");
        return;
    }

    constraints.push({
        id: generateId('CON'),
        type: 'vertical',
        lineId: selectedLines[0]
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

function applyParallel() {
    const selectedLines = selectedEntityIds.filter(id => id.startsWith('L_'));
    if (selectedLines.length !== 2) {
        alert("Select exactly 2 lines to make parallel.");
        return;
    }

    constraints.push({
        id: generateId('CON'),
        type: 'parallel',
        line1Id: selectedLines[0],
        line2Id: selectedLines[1]
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

function applyPerpendicular() {
    const selectedLines = selectedEntityIds.filter(id => id.startsWith('L_'));
    if (selectedLines.length !== 2) {
        alert("Select exactly 2 lines to make perpendicular.");
        return;
    }

    constraints.push({
        id: generateId('CON'),
        type: 'perpendicular',
        line1Id: selectedLines[0],
        line2Id: selectedLines[1]
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

function togglePointFixed() {
    const selectedPoints = selectedEntityIds.filter(id => id.startsWith('P_'));
    if (selectedPoints.length === 0) {
        alert("Select one or more points to toggle position lock.");
        return;
    }

    selectedPoints.forEach(id => {
        const p = getPoint(id);
        if (p) {
            p.fixed = !p.fixed;
        }
    });

    selectedEntityIds = [];
    runGCSSolver();
    redrawAll();
}

// INLINE VALUE DIALOG
let dialogCallback: ((val: number) => void) | null = null;

function showValDialog(title: string, defaultValue: number, callback: (val: number) => void) {
    const overlay = document.getElementById('dialog-overlay');
    const input = document.getElementById('dialog-input') as HTMLInputElement;
    const titleEl = document.getElementById('dialog-title');

    if (!overlay || !input || !titleEl) return;

    titleEl.innerText = title;
    input.value = defaultValue.toFixed(1);
    dialogCallback = callback;
    overlay.style.display = 'flex';
    input.focus();
}

function closeDialog() {
    const overlay = document.getElementById('dialog-overlay');
    if (overlay) overlay.style.display = 'none';
    dialogCallback = null;
}

// MAIN SETUP BINDINGS
window.addEventListener('DOMContentLoaded', async () => {
    // Setup toolbar clicks
    document.getElementById('btn-select')?.addEventListener('click', () => setTool('select'));
    document.getElementById('btn-point')?.addEventListener('click', () => setTool('point'));
    document.getElementById('btn-line')?.addEventListener('click', () => setTool('line'));
    document.getElementById('btn-circle')?.addEventListener('click', () => setTool('circle'));

    // Setup sidebar tab buttons
    const tabEnt = document.getElementById('tab-entities');
    const tabCon = document.getElementById('tab-constraints');
    const contentEnt = document.getElementById('content-entities');
    const contentCon = document.getElementById('content-constraints');

    tabEnt?.addEventListener('click', () => {
        tabEnt.classList.add('active');
        tabCon?.classList.remove('active');
        contentEnt?.classList.add('active');
        contentCon?.classList.remove('active');
    });

    tabCon?.addEventListener('click', () => {
        tabCon.classList.add('active');
        tabEnt?.classList.remove('active');
        contentCon?.classList.add('active');
        contentEnt?.classList.remove('active');
    });

    // Setup constraint actions
    document.getElementById('cbtn-coincident')?.addEventListener('click', applyCoincident);
    document.getElementById('cbtn-distance')?.addEventListener('click', applyDistance);
    document.getElementById('cbtn-horizontal')?.addEventListener('click', applyHorizontal);
    document.getElementById('cbtn-vertical')?.addEventListener('click', applyVertical);
    document.getElementById('cbtn-parallel')?.addEventListener('click', applyParallel);
    document.getElementById('cbtn-perpendicular')?.addEventListener('click', applyPerpendicular);
    document.getElementById('btn-fix-point')?.addEventListener('click', togglePointFixed);

    // Workspace clearing
    document.getElementById('btn-clear-all')?.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear the entire workspace?")) {
            points = [];
            lines = [];
            circles = [];
            constraints = [];
            selectedEntityIds = [];
            resetDrawingState();
            saveSketchToDB();
            redrawAll();
        }
    });

    // Dialog buttons
    document.getElementById('dialog-cancel')?.addEventListener('click', closeDialog);
    document.getElementById('dialog-submit')?.addEventListener('click', () => {
        const input = document.getElementById('dialog-input') as HTMLInputElement;
        if (input && dialogCallback) {
            const val = parseFloat(input.value);
            if (!isNaN(val)) {
                dialogCallback(val);
            }
        }
        closeDialog();
    });

    // Setup Canvas viewport and load WASM solver
    setupCanvas();
    await initSolver();

    // Load persisted state from IndexedDB
    await loadSketchFromDB();
    runGCSSolver();
    redrawAll();

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        // Ignore key shortcuts when typing inside form inputs
        if (document.activeElement?.tagName === 'INPUT') {
            return;
        }

        if (e.key === 'd' || e.key === 'D') {
            applyDistance();
        }
    });

    // Run self-test if ?test=true query parameter is present
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('test') === 'true') {
        setTimeout(runSelfTest, 1000);
    }
});

function runSelfTest() {
    console.log("--- Starting Viewport UI Diagnostics Self-Test ---");
    const results: { name: string; pass: boolean; detail: string }[] = [];

    function assert(name: string, condition: boolean, detail: string) {
        results.push({ name, pass: condition, detail });
        console.log(`  ${condition ? 'PASS' : 'FAIL'}: ${name} — ${detail}`);
    }

    // Clear everything
    points = [];
    lines = [];
    circles = [];
    constraints = [];
    selectedEntityIds = [];
    resetDrawingState();
    setTool('select');
    redrawAll();

    // --- Test 1: Point creation ---
    console.log("\n1. Point creation...");
    const pId = 'P_test';
    points.push({ id: pId, x: 100, y: 100 });
    runGCSSolver();
    redrawAll();

    const ptGroup = mainLayer.findOne('#' + pId) as any;
    assert("Point group exists", !!ptGroup, `findOne('#${pId}') = ${ptGroup}`);
    assert("Point is draggable", ptGroup?.draggable() === true, `draggable=${ptGroup?.draggable()}`);
    assert("Point at correct position", ptGroup?.x() === 100 && ptGroup?.y() === 100,
        `pos=(${ptGroup?.x()}, ${ptGroup?.y()})`);

    // --- Test 2: Hover preserves node identity ---
    // This is the critical test. Previously, mouseenter called redrawAll() which
    // destroyed all nodes. After the fix, mouseenter calls updateEntityVisuals()
    // which modifies properties in-place. The node reference must survive hover.
    console.log("\n2. Hover preserves node identity...");
    const nodeBeforeHover = mainLayer.findOne('#' + pId);
    // Simulate mouseenter
    hoveredEntityId = pId;
    updateEntityVisuals();
    const nodeAfterHover = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after hover",
        nodeBeforeHover === nodeAfterHover,
        `same ref = ${nodeBeforeHover === nodeAfterHover}`);
    assert("Node still draggable after hover",
        (nodeAfterHover as any)?.draggable() === true,
        `draggable=${(nodeAfterHover as any)?.draggable()}`);

    // Simulate mouseleave
    hoveredEntityId = null;
    updateEntityVisuals();
    const nodeAfterLeave = mainLayer.findOne('#' + pId);
    assert("Node identity preserved after leave",
        nodeBeforeHover === nodeAfterLeave,
        `same ref = ${nodeBeforeHover === nodeAfterLeave}`);

    // --- Test 3: Drag after hover (the real user scenario) ---
    console.log("\n3. Drag after hover...");
    // Simulate: hover → then drag
    hoveredEntityId = pId;
    updateEntityVisuals();

    const dragNode = mainLayer.findOne('#' + pId) as any;
    assert("Drag node found after hover", !!dragNode, `node=${dragNode}`);

    draggedPointId = pId;
    dragNode.fire('dragstart');

    dragNode.x(200);
    dragNode.y(150);
    dragNode.fire('dragmove');

    dragNode.fire('dragend');

    const pData = getPoint(pId);
    assert("Point data updated after drag",
        pData?.x === 200 && pData?.y === 150,
        `data=(${pData?.x}, ${pData?.y})`);

    // --- Test 4: redrawAll destroys nodes (regression proof) ---
    // This documents why we must NOT call redrawAll from mouseenter.
    console.log("\n4. redrawAll() destroys node references (regression proof)...");
    const nodeBefore = mainLayer.findOne('#' + pId);
    redrawAll();
    const nodeAfterRedraw = mainLayer.findOne('#' + pId);
    assert("redrawAll creates different node",
        nodeBefore !== nodeAfterRedraw,
        `same ref = ${nodeBefore === nodeAfterRedraw} (expected false)`);

    // --- Summary ---
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const summary = `Self-test complete: ${passed} passed, ${failed} failed out of ${results.length} assertions.`;
    console.log(`\n--- ${summary} ---`);

    if (failed === 0) {
        alert(`SUCCESS: ${summary}`);
    } else {
        const failDetails = results.filter(r => !r.pass).map(r => `• ${r.name}: ${r.detail}`).join('\n');
        alert(`FAILED: ${summary}\n\nFailures:\n${failDetails}`);
    }
}

