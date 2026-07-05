import { Component, inject, computed } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ToolService, ToolMode } from '../services/tool.service.js';
import { ICONS } from './icons.js';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  template: `
    <div class="toolbar">
        <button class="tool-btn" [class.active]="activeTool() === 'select'" (click)="setTool('select')" title="Select (S)" [innerHTML]="safeIcons.select">
        </button>

        <div class="separator"></div>

        <button class="tool-btn" [class.active]="activeTool() === 'point'" (click)="setTool('point')" title="Point (P)" [innerHTML]="safeIcons.point">
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'line'" (click)="setTool('line')" title="Line (L)" [innerHTML]="safeIcons.line">
        </button>
        <button class="tool-btn" [class.active]="activeTool() === 'circle'" (click)="setTool('circle')" title="Center Point Circle (C)" [innerHTML]="safeIcons.circle">
        </button>

        <div class="separator"></div>

        <button class="tool-btn" [class.active]="activeTool() === 'dimension'" (click)="setTool('dimension')" title="Dimension (D)" [innerHTML]="safeIcons.dimension">
        </button>
    </div>
  `,
  styles: [`
    .toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .separator {
        width: 1px;
        height: 20px;
        background-color: var(--border-color);
        margin: 0 4px;
    }

    .tool-btn {
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        transition: all 0.15s ease;
    }

    .tool-btn:hover {
        background-color: rgba(15, 23, 42, 0.06);
    }

    .tool-btn.active {
        background-color: rgba(26, 115, 232, 0.12);
        border-color: rgba(26, 115, 232, 0.3);
        box-shadow: 0 2px 8px rgba(26, 115, 232, 0.1);
    }

    .tool-btn ::ng-deep svg {
        width: 20px;
        height: 20px;
        display: block;
    }
  `]
})
export class ToolbarComponent {
    private readonly sanitizer = inject(DomSanitizer);
    private readonly toolService = inject(ToolService);

    readonly safeIcons = {
        select: this.sanitizer.bypassSecurityTrustHtml(ICONS.select),
        point: this.sanitizer.bypassSecurityTrustHtml(ICONS.point),
        line: this.sanitizer.bypassSecurityTrustHtml(ICONS.line),
        circle: this.sanitizer.bypassSecurityTrustHtml(ICONS.circle),
        dimension: this.sanitizer.bypassSecurityTrustHtml(ICONS.dimension),
    };
    
    readonly activeTool = this.toolService.activeToolMode;

    setTool(mode: ToolMode) {
        this.toolService.setTool(mode);
    }
}
