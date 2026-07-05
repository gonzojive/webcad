import { Component, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from './services/workspace.service.js';
import { ToolService } from './services/tool.service.js';
import { ViewportComponent } from './viewport/viewport.component.js';
import { ToolbarComponent } from './toolbar/toolbar.component.js';
import { SidebarComponent } from './sidebar/sidebar.component.js';
import { DimensionInputComponent } from './dimension-input/dimension-input.component.js';
import { Unit } from '../../units/units.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    ViewportComponent,
    ToolbarComponent,
    SidebarComponent,
    DimensionInputComponent
  ],
  template: `
    <!-- Top Header -->
    <header class="app-header">
        <div class="logo-section">
            <span class="logo-icon">📐</span>
            <h1 class="logo-title">WebCAD 2D Sketcher</h1>
        </div>

        <div class="solver-status-hud" [class]="workspace.solverStatusType()">
            {{ workspace.solverStatus() }}
        </div>

        <div class="header-controls">
            <!-- Unit Selector -->
            <div class="unit-selector-container">
                <label for="unit-select">Unit:</label>
                <select id="unit-select" [value]="workspace.preferredUnit()" (change)="changeUnit($event)">
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="in">inch</option>
                    <option value="ft">feet</option>
                </select>
            </div>

            <!-- Undo/Redo Buttons -->
            <div class="history-btns">
                <button class="header-btn" [disabled]="!workspace.canUndo()" (click)="workspace.undo()">
                    Undo
                </button>
                <button class="header-btn" [disabled]="!workspace.canRedo()" (click)="workspace.redo()">
                    Redo
                </button>
            </div>
        </div>
    </header>

    <!-- Main Workspace Area -->
    <div class="workspace-main">
        <div class="viewport-area">
            <app-viewport></app-viewport>
            <app-toolbar></app-toolbar>
            <app-dimension-input></app-dimension-input>
        </div>
        
        <div class="sidebar-area">
            <app-sidebar></app-sidebar>
        </div>
    </div>
  `,
  styles: [`
    .app-header {
        background-color: #e2e8f0;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 1.25rem;
        height: 52px;
        box-sizing: border-box;
    }

    .logo-section {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .logo-icon {
        font-size: 1.25rem;
    }

    .logo-title {
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--text-color);
    }

    .solver-status-hud {
        font-family: var(--font-family);
        font-size: 0.85rem;
        font-weight: 600;
        padding: 0.25rem 0.65rem;
        border-radius: 6px;
        border: 1px solid transparent;
        transition: all 0.2s ease;
    }

    .solver-status-hud.success {
        color: var(--success-color);
        border-color: rgba(22, 163, 74, 0.25);
        background-color: rgba(22, 163, 74, 0.08);
    }

    .solver-status-hud.danger {
        color: var(--danger-color);
        border-color: rgba(220, 38, 38, 0.25);
        background-color: rgba(220, 38, 38, 0.08);
    }

    .header-controls {
        display: flex;
        align-items: center;
        gap: 1.25rem;
    }

    .unit-selector-container {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-family: var(--font-family);
        font-size: 0.85rem;
        color: var(--text-color);
    }

    #unit-select {
        background-color: white;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 0.25rem 0.5rem;
        font-family: var(--font-family);
        font-size: 0.85rem;
        outline: none;
    }

    .history-btns {
        display: flex;
        gap: 0.35rem;
    }

    .header-btn {
        background-color: white;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-color);
        cursor: pointer;
        font-family: var(--font-family);
        font-size: 0.85rem;
        font-weight: 500;
        padding: 0.3rem 0.75rem;
        transition: all 0.15s ease;
    }

    .header-btn:hover:not(:disabled) {
        background-color: #f1f5f9;
        border-color: #94a3b8;
    }

    .header-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .workspace-main {
        flex: 1;
        display: flex;
        overflow: hidden;
        height: calc(100vh - 52px);
    }

    .viewport-area {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    .sidebar-area {
        width: 320px;
        height: 100%;
        flex-shrink: 0;
    }
  `]
})
export class AppComponent {
    readonly workspace = inject(WorkspaceService);
    private readonly toolService = inject(ToolService);

    changeUnit(event: Event) {
        const select = event.target as HTMLSelectElement;
        this.workspace.setPreferredUnit(select.value as Unit);
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return;
        }

        this.toolService.onKeyDown(event);
        if (event.defaultPrevented) {
            return;
        }

        const key = event.key.toLowerCase();
        switch (key) {
            case 'd':
                this.toolService.setTool('dimension');
                break;
            case 'l':
                this.toolService.setTool('line');
                break;
            case 'c':
                this.toolService.setTool('circle');
                break;
            case 'p':
                this.toolService.setTool('point');
                break;
            case 's':
                this.toolService.setTool('select');
                break;
            case 'escape':
                this.toolService.cancelActiveOperation();
                break;
        }
    }
}
