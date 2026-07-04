import { Tool, ToolContext } from './tool.js';
import { Vector2D } from '../geometry/vector.js';
import { IRenderer, IInteractionProvider } from '../ui/interfaces/viewport_interfaces.js';

export class PointTool implements Tool {
    readonly name = 'point';

    onActivate(context: ToolContext, renderer: IRenderer) {
        renderer.clearPointPreview();
    }

    onDeactivate(context: ToolContext, renderer: IRenderer) {
        renderer.clearPointPreview();
    }

    onMouseDown(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        context.addPoint(pos);
        context.solve();
        context.commitHistory();
        renderer.requestRedraw();
    }

    onMouseMove(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {
        renderer.setPointPreview(pos);
        renderer.requestRedraw();
    }

    onMouseUp(
        pos: Vector2D,
        event: MouseEvent,
        context: ToolContext,
        renderer: IRenderer,
        interaction: IInteractionProvider
    ) {}
}
