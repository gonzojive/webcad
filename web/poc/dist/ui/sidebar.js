/**
 * Controller that manages the RHS Sidebar lists (entities, constraints),
 * tab selection switching, constraint action buttons, and modal dialogs.
 */
export class SidebarController {
    constructor(model) {
        // Callbacks registered by the main controller
        this.onCoincident = null;
        this.onDistance = null;
        this.onHorizontal = null;
        this.onVertical = null;
        this.onParallel = null;
        this.onPerpendicular = null;
        this.onToggleFixed = null;
        this.onClearAll = null;
        // Modal dialog callback
        this.dialogCallback = null;
        this.model = model;
    }
    /**
     * Initializes sidebar tab switching, button clicks, and modal submit bindings.
     */
    init() {
        this.setupTabs();
        this.setupButtons();
        this.setupDialog();
    }
    // --- Callback Registration ---
    setCoincidentCallback(cb) { this.onCoincident = cb; }
    setDistanceCallback(cb) { this.onDistance = cb; }
    setHorizontalCallback(cb) { this.onHorizontal = cb; }
    setVerticalCallback(cb) { this.onVertical = cb; }
    setParallelCallback(cb) { this.onParallel = cb; }
    setPerpendicularCallback(cb) { this.onPerpendicular = cb; }
    setToggleFixedCallback(cb) { this.onToggleFixed = cb; }
    setClearAllCallback(cb) { this.onClearAll = cb; }
    // --- Modal Value Dialog ---
    showValueDialog(title, defaultValue, callback) {
        const overlay = document.getElementById('dialog-overlay');
        const input = document.getElementById('dialog-input');
        const titleEl = document.getElementById('dialog-title');
        if (!overlay || !input || !titleEl)
            return;
        titleEl.innerText = title;
        input.value = defaultValue.toFixed(1);
        this.dialogCallback = callback;
        overlay.style.display = 'flex';
        input.focus();
    }
    closeValueDialog() {
        const overlay = document.getElementById('dialog-overlay');
        if (overlay)
            overlay.style.display = 'none';
        this.dialogCallback = null;
    }
    // --- Sidebar Rendering ---
    render() {
        this.renderPoints();
        this.renderLines();
        this.renderCircles();
        this.renderConstraints();
    }
    renderPoints() {
        const container = document.getElementById('list-points');
        if (!container)
            return;
        container.innerHTML = '';
        const points = this.model.getPoints();
        if (points.length === 0) {
            container.innerHTML = '<div class="empty-msg">No points placed</div>';
            return;
        }
        const selectedIds = this.model.getSelectedEntityIds();
        points.forEach(p => {
            const item = document.createElement('div');
            item.className = 'list-item' + (selectedIds.includes(p.id) ? ' selected' : '');
            const lockIcon = p.fixed ? '<span class="lock-icon" style="color: var(--danger-color); margin-right: 4px;">🔒</span>' : '';
            item.innerHTML = `
                <div class="entity-info">
                    ${lockIcon}<strong>${p.id}</strong>: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})
                </div>
            `;
            // Hover and Selection Events
            item.addEventListener('mouseenter', () => {
                this.model.setHoveredEntityId(p.id);
            });
            item.addEventListener('mouseleave', () => {
                if (this.model.getHoveredEntityId() === p.id) {
                    this.model.setHoveredEntityId(null);
                }
            });
            item.addEventListener('click', () => {
                if (this.model.getTool() === 'select') {
                    this.model.toggleSelect(p.id);
                }
            });
            container.appendChild(item);
        });
    }
    renderLines() {
        const container = document.getElementById('list-lines');
        if (!container)
            return;
        container.innerHTML = '';
        const lines = this.model.getLines();
        if (lines.length === 0) {
            container.innerHTML = '<div class="empty-msg">No lines drawn</div>';
            return;
        }
        const selectedIds = this.model.getSelectedEntityIds();
        lines.forEach(l => {
            const item = document.createElement('div');
            item.className = 'list-item' + (selectedIds.includes(l.id) ? ' selected' : '');
            item.innerHTML = `
                <div class="entity-info">
                    <strong>${l.id}</strong>: ${l.p1Id} ➔ ${l.p2Id}
                </div>
            `;
            item.addEventListener('mouseenter', () => {
                this.model.setHoveredEntityId(l.id);
            });
            item.addEventListener('mouseleave', () => {
                if (this.model.getHoveredEntityId() === l.id) {
                    this.model.setHoveredEntityId(null);
                }
            });
            item.addEventListener('click', () => {
                if (this.model.getTool() === 'select') {
                    this.model.toggleSelect(l.id);
                }
            });
            container.appendChild(item);
        });
    }
    renderCircles() {
        const container = document.getElementById('list-circles');
        if (!container)
            return;
        container.innerHTML = '';
        const circles = this.model.getCircles();
        if (circles.length === 0) {
            container.innerHTML = '<div class="empty-msg">No circles drawn</div>';
            return;
        }
        const selectedIds = this.model.getSelectedEntityIds();
        circles.forEach(c => {
            const item = document.createElement('div');
            item.className = 'list-item' + (selectedIds.includes(c.id) ? ' selected' : '');
            item.innerHTML = `
                <div class="entity-info">
                    <strong>${c.id}</strong>: Center ${c.centerId}, R: ${c.radius.toFixed(1)}
                </div>
            `;
            item.addEventListener('mouseenter', () => {
                this.model.setHoveredEntityId(c.id);
            });
            item.addEventListener('mouseleave', () => {
                if (this.model.getHoveredEntityId() === c.id) {
                    this.model.setHoveredEntityId(null);
                }
            });
            item.addEventListener('click', () => {
                if (this.model.getTool() === 'select') {
                    this.model.toggleSelect(c.id);
                }
            });
            container.appendChild(item);
        });
    }
    renderConstraints() {
        const container = document.getElementById('list-constraints');
        if (!container)
            return;
        container.innerHTML = '';
        const constraints = this.model.getConstraints();
        if (constraints.length === 0) {
            container.innerHTML = '<div class="empty-msg">No active constraints</div>';
            return;
        }
        constraints.forEach(con => {
            const item = document.createElement('div');
            item.className = 'list-item constraint-item';
            let detail = '';
            if (con.type === 'coincident') {
                detail = `Coincident: ${con.p1Id} & ${con.p2Id}`;
            }
            else if (con.type === 'distance') {
                detail = `Distance: ${con.p1Id} & ${con.p2Id} = ${con.value?.toFixed(1)}`;
            }
            else if (con.type === 'horizontal' || con.type === 'vertical') {
                detail = `${con.type.charAt(0).toUpperCase() + con.type.slice(1)}: ${con.lineId}`;
            }
            else if (con.type === 'parallel' || con.type === 'perpendicular') {
                detail = `${con.type.charAt(0).toUpperCase() + con.type.slice(1)}: ${con.line1Id} & ${con.line2Id}`;
            }
            item.innerHTML = `
                <div class="entity-info">
                    <strong>${con.id}</strong>: ${detail}
                </div>
                <button class="delete-btn" title="Delete constraint" data-id="${con.id}">✕</button>
            `;
            // Hover Highlights
            item.addEventListener('mouseenter', () => {
                this.model.setHoveredConstraintId(con.id);
            });
            item.addEventListener('mouseleave', () => {
                if (this.model.getHoveredConstraintId() === con.id) {
                    this.model.setHoveredConstraintId(null);
                }
            });
            // Delete Constraint Listener
            const deleteBtn = item.querySelector('.delete-btn');
            deleteBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.model.getHoveredConstraintId() === con.id) {
                    this.model.setHoveredConstraintId(null);
                }
                this.model.removeConstraint(con.id);
            });
            container.appendChild(item);
        });
    }
    // --- Private Setup Handlers ---
    setupTabs() {
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
    }
    setupButtons() {
        document.getElementById('cbtn-coincident')?.addEventListener('click', () => {
            if (this.onCoincident)
                this.onCoincident();
        });
        document.getElementById('cbtn-distance')?.addEventListener('click', () => {
            if (this.onDistance)
                this.onDistance();
        });
        document.getElementById('cbtn-horizontal')?.addEventListener('click', () => {
            if (this.onHorizontal)
                this.onHorizontal();
        });
        document.getElementById('cbtn-vertical')?.addEventListener('click', () => {
            if (this.onVertical)
                this.onVertical();
        });
        document.getElementById('cbtn-parallel')?.addEventListener('click', () => {
            if (this.onParallel)
                this.onParallel();
        });
        document.getElementById('cbtn-perpendicular')?.addEventListener('click', () => {
            if (this.onPerpendicular)
                this.onPerpendicular();
        });
        document.getElementById('btn-fix-point')?.addEventListener('click', () => {
            if (this.onToggleFixed)
                this.onToggleFixed();
        });
        document.getElementById('btn-clear-all')?.addEventListener('click', () => {
            if (this.onClearAll)
                this.onClearAll();
        });
    }
    setupDialog() {
        document.getElementById('dialog-cancel')?.addEventListener('click', () => this.closeValueDialog());
        document.getElementById('dialog-submit')?.addEventListener('click', () => {
            const input = document.getElementById('dialog-input');
            if (input && this.dialogCallback) {
                const val = parseFloat(input.value);
                if (!isNaN(val)) {
                    this.dialogCallback(val);
                }
            }
            this.closeValueDialog();
        });
    }
}
