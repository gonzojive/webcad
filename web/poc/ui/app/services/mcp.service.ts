import { Injectable, NgZone } from '@angular/core';
import { WorkspaceService } from './workspace.service.js';
import { ToolService } from './tool.service.js';
import { McpHubClient } from './vendor/mcp/index.js';

@Injectable({
  providedIn: 'root'
})
export class McpService {
    private client: McpHubClient | null = null;

    constructor(
        private readonly workspace: WorkspaceService,
        private readonly toolService: ToolService,
        private readonly zone: NgZone
    ) {
        this.init();
    }

    private async init() {
        const token = "23860d7fdc832ec08977e6fa1bc595f625377dbf46709053d724e25dd7541f4c";
        
        try {
            this.client = new McpHubClient({
                appName: "WebCAD",
                token: token,
                daemonUrl: "https://localhost:8043/webtransport"
            });

            this.registerTools();

            console.log('Connecting to MCP Hub daemon...');
            await this.client.connect({ requireConsent: true });
            console.log('Successfully connected to MCP Hub daemon!');
        } catch (e) {
            console.error('Failed to initialize or connect McpHubClient:', e);
        }
    }

    private registerTools() {
        if (!this.client) return;

        // 1. Get Sketch
        this.client.tool("WebCad.getSketch", {
            description: "Get the current sketch state including points, lines, circles, and constraints",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
                return JSON.stringify({
                    points: this.workspace.getPoints(),
                    lines: this.workspace.getLines(),
                    circles: this.workspace.getCircles(),
                    constraints: this.workspace.getConstraints()
                }, null, 2);
            }
        });

        // 2. Add Point
        this.client.tool<{ x: number; y: number }>("WebCad.addPoint", {
            description: "Add a point to the sketch at coordinates (x, y)",
            inputSchema: {
                type: "object",
                properties: {
                    x: { type: "number", description: "X coordinate value" },
                    y: { type: "number", description: "Y coordinate value" }
                },
                required: ["x", "y"]
            },
            handler: async ({ x, y }) => {
                return this.zone.run(() => {
                    const id = this.workspace.addPoint({ x, y });
                    this.workspace.commitHistory();
                    return `Successfully added point "${id}" at (${x}, ${y})`;
                });
            }
        });

        // 3. Add Line
        this.client.tool<{ p1Id: string; p2Id: string }>("WebCad.addLine", {
            description: "Add a line segment connecting two points by their IDs",
            inputSchema: {
                type: "object",
                properties: {
                    p1Id: { type: "string", description: "ID of the starting point" },
                    p2Id: { type: "string", description: "ID of the ending point" }
                },
                required: ["p1Id", "p2Id"]
            },
            handler: async ({ p1Id, p2Id }) => {
                return this.zone.run(() => {
                    const p1 = this.workspace.getPoint(p1Id);
                    const p2 = this.workspace.getPoint(p2Id);
                    if (!p1 || !p2) {
                        throw new Error(`Failed to find point: p1=${p1Id}, p2=${p2Id}`);
                    }
                    const id = this.workspace.addLine(p1Id, p2Id);
                    this.workspace.commitHistory();
                    return `Successfully added line "${id}" connecting "${p1Id}" and "${p2Id}"`;
                });
            }
        });

        // 4. Add Circle
        this.client.tool<{ centerId: string; radius: number }>("WebCad.addCircle", {
            description: "Add a circle with center point and radius",
            inputSchema: {
                type: "object",
                properties: {
                    centerId: { type: "string", description: "ID of the center point" },
                    radius: { type: "number", description: "Radius of the circle" }
                },
                required: ["centerId", "radius"]
            },
            handler: async ({ centerId, radius }) => {
                return this.zone.run(() => {
                    const center = this.workspace.getPoint(centerId);
                    if (!center) {
                        throw new Error(`Failed to find point: centerId=${centerId}`);
                    }
                    const id = this.workspace.addCircle(centerId, radius);
                    this.workspace.commitHistory();
                    return `Successfully added circle "${id}" with center "${centerId}" and radius ${radius}`;
                });
            }
        });

        // 5. Add Constraint
        this.client.tool<{
            type: string;
            p1Id?: string;
            p2Id?: string;
            line1Id?: string;
            line2Id?: string;
            pointId?: string;
            lineId?: string;
            value?: number;
        }>("WebCad.addConstraint", {
            description: "Add a geometric constraint to the sketch",
            inputSchema: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: [
                            "coincident", "distance", "horizontal_distance",
                            "vertical_distance", "point_line_distance",
                            "vertical", "horizontal", "parallel", "perpendicular"
                        ],
                        description: "The type of constraint to add"
                    },
                    p1Id: { type: "string", description: "Point 1 ID (for coincident, distance, horizontal_distance, vertical_distance)" },
                    p2Id: { type: "string", description: "Point 2 ID (for coincident, distance, horizontal_distance, vertical_distance)" },
                    line1Id: { type: "string", description: "Line 1 ID (for parallel, perpendicular)" },
                    line2Id: { type: "string", description: "Line 2 ID (for parallel, perpendicular)" },
                    pointId: { type: "string", description: "Point ID (for point_line_distance)" },
                    lineId: { type: "string", description: "Line ID (for vertical, horizontal, point_line_distance)" },
                    value: { type: "number", description: "Numeric value for distance/offset constraints" }
                },
                required: ["type"]
            },
            handler: async (args) => {
                return this.zone.run(() => {
                    const constraint: any = {
                        id: this.workspace.generateNextId('C'),
                        type: args.type
                    };

                    switch (args.type) {
                        case 'coincident':
                            if (!args.p1Id || !args.p2Id) throw new Error("coincident constraint requires p1Id and p2Id");
                            constraint.p1Id = args.p1Id;
                            constraint.p2Id = args.p2Id;
                            break;
                        case 'distance':
                        case 'horizontal_distance':
                        case 'vertical_distance':
                            if (!args.p1Id || !args.p2Id || args.value === undefined) {
                                throw new Error(`${args.type} constraint requires p1Id, p2Id, and value`);
                            }
                            constraint.p1Id = args.p1Id;
                            constraint.p2Id = args.p2Id;
                            constraint.value = args.value;
                            break;
                        case 'point_line_distance':
                            if (!args.pointId || !args.lineId || args.value === undefined) {
                                throw new Error("point_line_distance constraint requires pointId, lineId, and value");
                            }
                            constraint.pointId = args.pointId;
                            constraint.lineId = args.lineId;
                            constraint.value = args.value;
                            break;
                        case 'vertical':
                        case 'horizontal':
                            if (!args.lineId) throw new Error(`${args.type} constraint requires lineId`);
                            constraint.lineId = args.lineId;
                            break;
                        case 'parallel':
                        case 'perpendicular':
                            if (!args.line1Id || !args.line2Id) throw new Error(`${args.type} constraint requires line1Id and line2Id`);
                            constraint.line1Id = args.line1Id;
                            constraint.line2Id = args.line2Id;
                            break;
                        default:
                            throw new Error(`Unsupported constraint type: ${args.type}`);
                    }

                    const id = this.workspace.addConstraint(constraint);
                    this.workspace.commitHistory();
                    return `Successfully added constraint "${id}" of type "${args.type}"`;
                });
            }
        });

        // 6. Clear Sketch
        this.client.tool("WebCad.clearSketch", {
            description: "Clear all entities and constraints from the sketch workspace",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
                return this.zone.run(() => {
                    this.workspace.clearWorkspace();
                    return "Successfully cleared the workspace";
                });
            }
        });

        // 7. Solve
        this.client.tool("WebCad.solve", {
            description: "Solve the geometric constraints in the sketch to update entity positions",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
                return this.zone.run(() => {
                    const success = this.workspace.solve();
                    this.workspace.commitHistory();
                    return success ? "Solver resolved successfully!" : "Solver failed (Over-constrained/Stalled)";
                });
            }
        });

        // 8. Get Viewport Status
        this.client.tool("WebCad.getViewportStatus", {
            description: "Get the current viewport boundary in sketch coordinates and the visibility status of all sketch points",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
                const renderer = this.toolService.activeRenderer;
                if (!renderer) {
                    throw new Error("Active renderer/viewport not registered");
                }

                const bounds = renderer.getViewportSketchBounds();
                const points = this.workspace.getPoints();
                const pointVisibility = points.map(p => ({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    visible: renderer.isSketchPointInViewport(p)
                }));

                return JSON.stringify({
                    viewportSketchBounds: bounds,
                    points: pointVisibility
                }, null, 2);
            }
        });

        // 9. Take Screenshot
        this.client.tool("WebCad.takeScreenshot", {
            description: "Capture a screenshot of the current CAD canvas as a base64-encoded PNG data URL",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
                const renderer = this.toolService.activeRenderer;
                if (!renderer) {
                    throw new Error("Active renderer/viewport not registered");
                }
                return renderer.toDataURL();
            }
        });
    }
}
