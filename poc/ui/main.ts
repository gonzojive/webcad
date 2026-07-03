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

// GCS API Client
const gcs = new GCSapi();

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
    stage.on('mousedown', handleStageMouseDown);
    stage.on('mousemove', handleStageMouseMove);

    // Initial Render
    redrawAll();
}

function drawGrid() {
    gridLayer.destroyChildren();
    const width = stage.width();
    const height = stage.height();
    const gridSpacing = 40;

    // Subtle Dot Grid
    for (let x = 0; x < width; x += gridSpacing) {
        for (let y = 0; y < height; y += gridSpacing) {
            const dot = new Konva.Circle({
                x: x,
                y: y,
                radius: 1,
                fill: 'var(--border-color)',
                opacity: 0.3,
                listening: false
            });
            gridLayer.add(dot);
        }
    }
    gridLayer.draw();
}

// Entity & Coordinate Helpers
function getPoint(id: string): GCSPoint | undefined {
    return points.find(p => p.id === id);
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
        const state: GCSSketchState = { points, lines, circles, constraints };
        const result = gcs.solve(state);
        
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
    } catch (e) {
        console.error('Solver crash:', e);
    }
}

// STAGE EVENTS
function handleStageMouseDown(e: any) {
    const pos = stage.getPointerPosition();
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
    const pos = stage.getPointerPosition();
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

        // Hover events
        lineShape.on('mouseenter', () => {
            if (currentTool === 'select') {
                hoveredEntityId = l.id;
                stage.container().style.cursor = 'pointer';
                redrawAll();
            }
        });
        lineShape.on('mouseleave', () => {
            if (hoveredEntityId === l.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                redrawAll();
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
                redrawAll();
            }
        });
        circleShape.on('mouseleave', () => {
            if (hoveredEntityId === c.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                redrawAll();
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

        // Visible Circle dot
        const dot = new Konva.Circle({
            radius: isHovered || isSelected ? 6 : 4.5,
            fill: pointColor,
            stroke: p.fixed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0,0,0,0.5)',
            strokeWidth: 1.5
        });

        // Invisible larger hit area for easier grabbing
        const hitArea = new Konva.Circle({
            radius: 12,
            fill: 'transparent'
        });

        pointGroup.add(hitArea);
        pointGroup.add(dot);

        // Drag handlers
        pointGroup.on('dragmove', (e: any) => {
            p.x = e.target.x();
            p.y = e.target.y();
            runGCSSolver();
            redrawAll();
        });

        pointGroup.on('dragend', () => {
            runGCSSolver();
            redrawAll();
        });

        pointGroup.on('mouseenter', () => {
            if (currentTool === 'select') {
                hoveredEntityId = p.id;
                stage.container().style.cursor = 'pointer';
                redrawAll();
            }
        });
        pointGroup.on('mouseleave', () => {
            if (hoveredEntityId === p.id) {
                hoveredEntityId = null;
                stage.container().style.cursor = 'crosshair';
                redrawAll();
            }
        });

        pointGroup.on('click', (e: any) => {
            if (currentTool === 'select') {
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

function applyDistance() {
    const selectedPoints = selectedEntityIds.filter(id => id.startsWith('P_'));
    if (selectedPoints.length !== 2) {
        alert("Select exactly 2 points to constrain distance.");
        return;
    }

    const p1 = getPoint(selectedPoints[0]);
    const p2 = getPoint(selectedPoints[1]);
    if (!p1 || !p2) return;

    const currentDist = distance(p1.x, p1.y, p2.x, p2.y);
    showValDialog("Set Point Distance", currentDist, (val) => {
        constraints.push({
            id: generateId('CON'),
            type: 'distance',
            p1Id: selectedPoints[0],
            p2Id: selectedPoints[1],
            value: val
        });

        selectedEntityIds = [];
        runGCSSolver();
        redrawAll();
    });
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
});
