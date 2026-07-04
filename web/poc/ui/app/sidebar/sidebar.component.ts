import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../services/workspace.service.js';
import { GCSPoint, GCSLine, GCSCircle, GCSConstraint } from '../../../../../ts/gcsapi/dist/index.js';
import { dist } from '../../../geometry/vector.js';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sidebar">
        <!-- Sidebar Tabs -->
        <div class="tabs-header">
            <button class="tab-btn" [class.active]="activeTab() === 'entities'" (click)="activeTab.set('entities')">Entities</button>
            <button class="tab-btn" [class.active]="activeTab() === 'constraints'" (click)="activeTab.set('constraints')">Constraints</button>
        </div>

        <!-- Entities Content -->
        <div class="tab-content" [class.active]="activeTab() === 'entities'">
            <div class="list-section-title">Points ({{ points().length }})</div>
            <div class="list-container">
                <div *ngFor="let p of points()" 
                     class="list-item" 
                     [class.selected]="isSelected(p.id)"
                     [class.hovered]="hoveredEntityId() === p.id"
                     (click)="toggleSelect(p.id)">
                    <span class="item-id">
                        <span *ngIf="p.fixed" class="lock-icon">🔒</span>
                        {{ p.id }}
                    </span>
                    <span class="item-details">({{ p.x.toFixed(1) }}, {{ p.y.toFixed(1) }})</span>
                </div>
            </div>

            <div class="list-section-title">Lines ({{ lines().length }})</div>
            <div class="list-container">
                <div *ngFor="let l of lines()" 
                     class="list-item" 
                     [class.selected]="isSelected(l.id)"
                     [class.hovered]="hoveredEntityId() === l.id"
                     (click)="toggleSelect(l.id)">
                    <span class="item-id">{{ l.id }}</span>
                    <span class="item-details">{{ l.p1Id }} → {{ l.p2Id }}</span>
                </div>
            </div>

            <div class="list-section-title">Circles ({{ circles().length }})</div>
            <div class="list-container">
                <div *ngFor="let c of circles()" 
                     class="list-item" 
                     [class.selected]="isSelected(c.id)"
                     [class.hovered]="hoveredEntityId() === c.id"
                     (click)="toggleSelect(c.id)">
                    <span class="item-id">{{ c.id }}</span>
                    <span class="item-details">C: {{ c.centerId }} | R: {{ c.radius.toFixed(1) }}</span>
                </div>
            </div>
        </div>

        <!-- Constraints Content -->
        <div class="tab-content" [class.active]="activeTab() === 'constraints'">
            <div class="list-section-title">Active Constraints ({{ constraints().length }})</div>
            <div class="list-container">
                <div *ngFor="let con of constraints()" 
                     class="list-item constraint-item"
                     [class.hovered]="hoveredConstraintId() === con.id"
                     (mouseenter)="workspace.setHoveredConstraintId(con.id)"
                     (mouseleave)="workspace.setHoveredConstraintId(null)">
                    <div class="constraint-text">
                        <span class="constraint-type">{{ con.type }}</span>
                        <span class="constraint-desc">{{ getConstraintDescription(con) }}</span>
                    </div>
                    <button class="delete-btn" (click)="deleteConstraint(con.id, $event)" title="Delete constraint">×</button>
                </div>
            </div>
        </div>

        <!-- Bottom Control Panel -->
        <div class="controls-panel">
            <div class="panel-title">Apply Constraints</div>
            <div class="btn-grid">
                <button class="action-btn-secondary" 
                        [disabled]="!coincidentAllowed()" 
                        (click)="applyCoincident()"
                        title="Constrain two points to share the same position">Coincident</button>
                <button class="action-btn-secondary" 
                        [disabled]="!distanceAllowed()" 
                        (click)="applyDistance()"
                        title="Constrain distance between two points">Distance</button>
                <button class="action-btn-secondary" 
                        [disabled]="!horizVertAllowed()" 
                        (click)="applyHorizontal()"
                        title="Constrain a line to be horizontal">Horizontal</button>
                <button class="action-btn-secondary" 
                        [disabled]="!horizVertAllowed()" 
                        (click)="applyVertical()"
                        title="Constrain a line to be vertical">Vertical</button>
                <button class="action-btn-secondary" 
                        [disabled]="!parallelPerpAllowed()" 
                        (click)="applyParallel()"
                        title="Constrain two lines to be parallel">Parallel</button>
                <button class="action-btn-secondary" 
                        [disabled]="!parallelPerpAllowed()" 
                        (click)="applyPerpendicular()"
                        title="Constrain two lines to be perpendicular">Perpendicular</button>
            </div>
            <button class="action-btn-primary" 
                    [disabled]="!lockAllowed()" 
                    (click)="toggleLock()"
                    style="margin-top: 0.25rem;">Toggle Lock Position</button>
            <button class="action-btn-secondary" 
                    (click)="workspace.clearWorkspace()"
                    style="color: var(--danger-color); border-color: rgba(239,68,68,0.3); margin-top: 0.25rem;">Clear Workspace</button>
        </div>
    </div>
  `,
  styles: [`
    .sidebar {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--sidebar-bg);
        border-left: 1px solid var(--border-color);
        box-sizing: border-box;
    }

    .tabs-header {
        display: flex;
        border-bottom: 1px solid var(--border-color);
        background-color: #e2e8f0;
    }

    .tab-btn {
        flex: 1;
        padding: 0.75rem;
        background: none;
        border: none;
        font-family: var(--font-family);
        font-weight: 500;
        font-size: 0.85rem;
        color: var(--text-muted);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .tab-btn.active {
        background-color: var(--sidebar-bg);
        color: var(--text-color);
        border-bottom: 2px solid var(--accent-color);
    }

    .tab-content {
        display: none;
        flex: 1;
        overflow-y: auto;
        padding: 0.75rem;
    }

    .tab-content.active {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .list-section-title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
        letter-spacing: 0.05em;
        margin-bottom: 0.25rem;
    }

    .list-container {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background-color: white;
        padding: 0.2rem;
    }

    .list-item {
        display: flex;
        justify-content: space-between;
        padding: 0.4rem 0.6rem;
        border-radius: 4px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .list-item:hover {
        background-color: #f1f5f9;
    }

    .list-item.selected {
        background-color: rgba(59, 130, 246, 0.1);
        color: var(--accent-color);
        font-weight: 500;
    }

    .list-item.hovered {
        background-color: rgba(26, 115, 232, 0.05);
        border: 1px dashed var(--accent-color);
    }

    .item-id {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .lock-icon {
        font-size: 0.75rem;
    }

    .item-details {
        color: var(--text-muted);
    }

    .constraint-item {
        justify-content: space-between;
        align-items: center;
    }

    .constraint-text {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }

    .constraint-type {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
    }

    .constraint-desc {
        font-size: 0.8rem;
    }

    .delete-btn {
        background: none;
        border: none;
        font-size: 1.1rem;
        color: var(--text-muted);
        cursor: pointer;
        padding: 0 0.3rem;
        line-height: 1;
    }

    .delete-btn:hover {
        color: var(--danger-color);
    }

    .controls-panel {
        padding: 0.75rem;
        border-top: 1px solid var(--border-color);
        background-color: #f8fafc;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .panel-title {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-color);
    }

    .btn-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.3rem;
    }

    .action-btn-secondary {
        background-color: white;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-color);
        font-family: var(--font-family);
        font-size: 0.8rem;
        font-weight: 500;
        padding: 0.45rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .action-btn-secondary:hover:not(:disabled) {
        background-color: #f1f5f9;
        border-color: #94a3b8;
    }

    .action-btn-secondary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background-color: #f1f5f9;
    }

    .action-btn-primary {
        background-color: var(--accent-color);
        border: 1px solid var(--accent-color);
        border-radius: 6px;
        color: white;
        font-family: var(--font-family);
        font-size: 0.85rem;
        font-weight: 500;
        padding: 0.5rem;
        cursor: pointer;
        width: 100%;
        transition: all 0.2s ease;
    }

    .action-btn-primary:hover:not(:disabled) {
        background-color: var(--accent-hover);
        border-color: var(--accent-hover);
    }

    .action-btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
  `]
})
export class SidebarComponent {
    readonly workspace = inject(WorkspaceService);
    
    readonly activeTab = signal<'entities' | 'constraints'>('entities');

    readonly points = this.workspace.points;
    readonly lines = this.workspace.lines;
    readonly circles = this.workspace.circles;
    readonly constraints = this.workspace.constraints;

    readonly hoveredEntityId = this.workspace.hoveredEntityId;
    readonly hoveredConstraintId = this.workspace.hoveredConstraintId;

    // Selection rules for constraints
    readonly coincidentAllowed = computed(() => {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length !== 2) return false;
        return selected.every(id => !!this.workspace.getPoint(id));
    });

    readonly distanceAllowed = computed(() => {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length !== 2) return false;
        return selected.every(id => !!this.workspace.getPoint(id));
    });

    readonly horizVertAllowed = computed(() => {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length !== 1) return false;
        return !!this.workspace.getLine(selected[0]);
    });

    readonly parallelPerpAllowed = computed(() => {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length !== 2) return false;
        return selected.every(id => !!this.workspace.getLine(id));
    });

    readonly lockAllowed = computed(() => {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length !== 1) return false;
        return !!this.workspace.getPoint(selected[0]);
    });

    isSelected(id: string): boolean {
        return this.workspace.selectedEntityIds().includes(id);
    }

    toggleSelect(id: string) {
        const current = this.workspace.selectedEntityIds();
        if (current.includes(id)) {
            this.workspace.setSelectedEntityIds(current.filter(x => x !== id));
        } else {
            this.workspace.setSelectedEntityIds([...current, id]);
        }
    }

    deleteConstraint(id: string, event: MouseEvent) {
        event.stopPropagation();
        this.workspace.deleteConstraint(id);
    }

    getConstraintDescription(con: GCSConstraint): string {
        switch (con.type) {
            case 'coincident': return `${con.p1Id} coincident with ${con.p2Id}`;
            case 'distance': return `${con.p1Id} ↔ ${con.p2Id}: ${con.value.toFixed(2)} mm`;
            case 'horizontalDistance': return `${con.p1Id} ↔ ${con.p2Id} (H): ${con.value.toFixed(2)} mm`;
            case 'verticalDistance': return `${con.p1Id} ↔ ${con.p2Id} (V): ${con.value.toFixed(2)} mm`;
            case 'pointLineDistance': return `${con.pointId} to line ${con.lineId}: ${con.value.toFixed(2)} mm`;
            case 'vertical': return `line ${con.lineId} vertical`;
            case 'horizontal': return `line ${con.lineId} horizontal`;
            case 'parallel': return `line ${con.line1Id} parallel to ${con.line2Id}`;
            case 'perpendicular': return `line ${con.line1Id} perpendicular to ${con.line2Id}`;
            default: return '';
        }
    }

    // --- Action Button Dispatchers ---

    applyCoincident() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 2) {
            this.workspace.addConstraint({
                id: `Coincident_${selected[0]}_${selected[1]}`,
                type: 'coincident',
                p1Id: selected[0],
                p2Id: selected[1]
            });
            this.workspace.setSelectedEntityIds([]);
            this.workspace.solve();
            this.workspace.commitHistory();
        }
    }

    applyDistance() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 2) {
            const p1 = this.workspace.getPoint(selected[0]);
            const p2 = this.workspace.getPoint(selected[1]);
            if (p1 && p2) {
                const currentVal = dist(p1, p2);
                
                // Prompt using our inline request box (or modal fallback)
                this.workspace.requestDimensionInput(
                    { x: (p1.x + p2.x)/2, y: (p1.y + p2.y)/2 },
                    currentVal,
                    (val) => {
                        this.workspace.addConstraint({
                            id: `Distance_${selected[0]}_${selected[1]}`,
                            type: 'distance',
                            p1Id: selected[0],
                            p2Id: selected[1],
                            value: val
                        });
                        this.workspace.setSelectedEntityIds([]);
                        this.workspace.solve();
                        this.workspace.commitHistory();
                    }
                );
            }
        }
    }

    applyHorizontal() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 1) {
            this.workspace.addConstraint({
                id: `Horiz_${selected[0]}`,
                type: 'horizontal',
                lineId: selected[0]
            });
            this.workspace.setSelectedEntityIds([]);
            this.workspace.solve();
            this.workspace.commitHistory();
        }
    }

    applyVertical() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 1) {
            this.workspace.addConstraint({
                id: `Vert_${selected[0]}`,
                type: 'vertical',
                lineId: selected[0]
            });
            this.workspace.setSelectedEntityIds([]);
            this.workspace.solve();
            this.workspace.commitHistory();
        }
    }

    applyParallel() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 2) {
            this.workspace.addConstraint({
                id: `Parallel_${selected[0]}_${selected[1]}`,
                type: 'parallel',
                line1Id: selected[0],
                line2Id: selected[1]
            });
            this.workspace.setSelectedEntityIds([]);
            this.workspace.solve();
            this.workspace.commitHistory();
        }
    }

    applyPerpendicular() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 2) {
            this.workspace.addConstraint({
                id: `Perp_${selected[0]}_${selected[1]}`,
                type: 'perpendicular',
                line1Id: selected[0],
                line2Id: selected[1]
            });
            this.workspace.setSelectedEntityIds([]);
            this.workspace.solve();
            this.workspace.commitHistory();
        }
    }

    toggleLock() {
        const selected = this.workspace.selectedEntityIds();
        if (selected.length === 1) {
            this.workspace.togglePointFixed(selected[0]);
        }
    }
}
