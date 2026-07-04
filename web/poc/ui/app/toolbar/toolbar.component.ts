import { Component, inject, computed } from '@angular/core';
import { ToolService, ToolMode } from '../services/tool.service.js';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  template: `
    <div class="toolbar">
        <button class="tool-btn" [class.active]="activeTool() === 'select'" (click)="setTool('select')">
            Select
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'point'" (click)="setTool('point')">
            Point
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'line'" (click)="setTool('line')">
            Line
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'circle'" (click)="setTool('circle')">
            Circle
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'dimension'" (click)="setTool('dimension')">
            Dimension
        </button>
    </div>

    <div class="help-overlay">
        Mode: <span style="font-weight: 600; color: var(--accent-color);">{{ activeToolLabel() }}</span>. {{ activeToolHelp() }}
    </div>
  `,
  styles: [`
    .toolbar {
        background-color: var(--glass-bg);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        display: flex;
        gap: 0.35rem;
        left: 50%;
        padding: 0.4rem;
        position: absolute;
        top: 1.25rem;
        transform: translateX(-50%);
        z-index: 100;
    }

    .tool-btn {
        background: none;
        border: none;
        border-radius: 8px;
        color: var(--text-color);
        cursor: pointer;
        font-family: var(--font-family);
        font-size: 0.9rem;
        font-weight: 500;
        padding: 0.55rem 0.9rem;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .tool-btn:hover {
        background-color: rgba(226, 232, 240, 0.7);
    }

    .tool-btn.active {
        background-color: var(--accent-color);
        color: white;
        box-shadow: 0 4px 12px rgba(26, 115, 232, 0.25);
    }

    .help-overlay {
        position: absolute;
        bottom: 1.25rem;
        left: 1.25rem;
        background-color: var(--glass-bg);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 0.55rem 0.95rem;
        font-family: var(--font-family);
        font-size: 0.85rem;
        color: var(--text-muted);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
        z-index: 90;
        pointer-events: none;
    }
  `]
})
export class ToolbarComponent {
    private readonly toolService = inject(ToolService);
    
    readonly activeTool = this.toolService.activeToolMode;
    
    readonly activeToolLabel = computed(() => {
        const t = this.activeTool();
        return t.charAt(0).toUpperCase() + t.slice(1);
    });

    readonly activeToolHelp = computed(() => {
        const t = this.activeTool();
        switch (t) {
            case 'select': return 'Click canvas to select or drag entities.';
            case 'point': return 'Click canvas to place points.';
            case 'line': return 'Click canvas or snap to points to draw lines. Esc to finish chain.';
            case 'circle': return 'Click center point then click/drag radius.';
            case 'dimension': return 'Select 1 or 2 entities, then click canvas to place constraints.';
            default: return '';
        }
    });

    setTool(mode: ToolMode) {
        this.toolService.setTool(mode);
    }
}
