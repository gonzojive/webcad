import { Component, inject, computed, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../services/workspace.service.js';
import { ToolService } from '../services/tool.service.js';
import { parseLength, formatLength } from '../../../units/units.js';

@Component({
  selector: 'app-dimension-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="request()" 
         [style.left.px]="x()" 
         [style.top.px]="y()" 
         class="inline-input-container">
        <input #inputField
               type="text" 
               [value]="defaultValueStr()" 
               (keydown.enter)="submit()" 
               (keydown.escape)="cancel()"
               class="inline-input"
               placeholder="0.0">
        <div class="actions">
            <button class="action-btn" (click)="submit()">✔</button>
            <button class="action-btn cancel" (click)="cancel()">✘</button>
        </div>
    </div>
  `,
  styles: [`
    .inline-input-container {
        position: absolute;
        z-index: 1000;
        transform: translate(-50%, -100%) translateY(-10px);
        background-color: white;
        border: 1.5px solid var(--accent-color);
        border-radius: 6px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        padding: 2px;
        gap: 2px;
    }

    .inline-input {
        width: 80px;
        padding: 4px 6px;
        border: none;
        outline: none;
        font-family: var(--font-family);
        font-size: 0.85rem;
        color: var(--text-color);
    }

    .actions {
        display: flex;
        gap: 1px;
    }

    .action-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 6px;
        font-size: 0.8rem;
        color: var(--success-color);
        border-radius: 4px;
        transition: background-color 0.1s;
    }

    .action-btn:hover {
        background-color: #f1f5f9;
    }

    .action-btn.cancel {
        color: var(--danger-color);
    }
  `]
})
export class DimensionInputComponent implements AfterViewChecked {
    readonly workspace = inject(WorkspaceService);
    readonly toolService = inject(ToolService);
    
    @ViewChild('inputField') inputField?: ElementRef<HTMLInputElement>;

    readonly request = this.workspace.activeDimensionInputRequest;
    private focused = false;

    readonly x = computed(() => {
        const req = this.request();
        if (!req || !this.toolService.activeRenderer) return 0;
        return this.toolService.activeRenderer.sketchToScreen(req.pos).x;
    });

    readonly y = computed(() => {
        const req = this.request();
        if (!req || !this.toolService.activeRenderer) return 0;
        return this.toolService.activeRenderer.sketchToScreen(req.pos).y;
    });

    readonly defaultValueStr = computed(() => {
        const req = this.request();
        if (!req) return '';
        const prefUnit = this.workspace.preferredUnit();
        return formatLength(req.defaultValue, prefUnit);
    });

    ngAfterViewChecked() {
        // Auto focus input when spawned (preventing infinite focus loops)
        const req = this.request();
        if (req && this.inputField && !this.focused) {
            this.focused = true;
            const el = this.inputField.nativeElement;
            setTimeout(() => {
                el.focus();
                el.select();
            }, 0);
        } else if (!req) {
            this.focused = false;
        }
    }

    submit() {
        const req = this.request();
        if (req && this.inputField) {
            const rawValue = this.inputField.nativeElement.value;
            try {
                // Parse length using current workspace preferred unit
                const parsedValue = parseLength(rawValue, this.workspace.preferredUnit());
                req.callback(parsedValue);
            } catch (err: any) {
                alert(err.message || 'Invalid unit entry.');
            }
        }
        this.workspace.activeDimensionInputRequest.set(null);
    }

    cancel() {
        const req = this.request();
        if (req && req.onCancel) {
            req.onCancel();
        }
        this.workspace.activeDimensionInputRequest.set(null);
    }
}
