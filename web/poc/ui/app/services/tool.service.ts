import { Injectable, signal, inject } from '@angular/core';
import { Tool } from '../../../tools/tool.js';
import { SelectTool } from '../../../tools/select_tool.js';
import { PointTool } from '../../../tools/point_tool.js';
import { LineTool } from '../../../tools/line_tool.js';
import { CircleTool } from '../../../tools/circle_tool.js';
import { DimensionTool } from '../../../tools/dimension_tool.js';
import { WorkspaceService } from './workspace.service.js';
import { IRenderer, IInteractionProvider } from '../../interfaces/viewport_interfaces.js';
import { Vector2D } from '../../../geometry/vector.js';

export type ToolMode = 'select' | 'point' | 'line' | 'circle' | 'dimension';

@Injectable({
  providedIn: 'root'
})
export class ToolService {
    private readonly workspace = inject(WorkspaceService);
    
    private readonly tools: Record<ToolMode, Tool> = {
        select: new SelectTool(),
        point: new PointTool(),
        line: new LineTool(),
        circle: new CircleTool(),
        dimension: new DimensionTool()
    };
    
    readonly activeToolMode = signal<ToolMode>('select');
    activeRenderer?: IRenderer;
    private activeInteractionProvider?: IInteractionProvider;
    
    get activeTool(): Tool {

        return this.tools[this.activeToolMode()];
    }

    registerViewport(renderer: IRenderer, interactionProvider: IInteractionProvider) {
        this.activeRenderer = renderer;
        this.activeInteractionProvider = interactionProvider;
    }

    setTool(mode: ToolMode) {
        if (!this.activeRenderer) return;

        const oldTool = this.activeTool;
        if (oldTool.onDeactivate) {
            oldTool.onDeactivate(this.workspace, this.activeRenderer);
        }
        
        this.activeToolMode.set(mode);
        
        const newTool = this.activeTool;
        if (newTool.onActivate) {
            newTool.onActivate(this.workspace, this.activeRenderer);
        }
    }

    onMouseDown(pos: Vector2D, event: MouseEvent, renderer: IRenderer, interaction: IInteractionProvider) {
        this.activeTool.onMouseDown(pos, event, this.workspace, renderer, interaction);
    }

    onMouseMove(pos: Vector2D, event: MouseEvent, renderer: IRenderer, interaction: IInteractionProvider) {
        this.activeTool.onMouseMove(pos, event, this.workspace, renderer, interaction);
    }

    onMouseUp(pos: Vector2D, event: MouseEvent, renderer: IRenderer, interaction: IInteractionProvider) {
        this.activeTool.onMouseUp(pos, event, this.workspace, renderer, interaction);
    }

    onKeyDown(event: KeyboardEvent) {
        if (this.activeTool.onKeyDown && this.activeRenderer && this.activeInteractionProvider) {
            this.activeTool.onKeyDown(event, this.workspace, this.activeRenderer, this.activeInteractionProvider);
        }
    }

    cancelActiveOperation() {
        if (!this.activeRenderer) return;
        if (this.activeTool.onCancel) {
            this.activeTool.onCancel(this.workspace, this.activeRenderer);
        }
        this.setTool('select');
    }
}
