/**
 * @file types.ts
 * Core TypeScript types for the MCP Hub browser client.
 *
 * These types map to the three MCP server-side primitives:
 *   - Tools     (actions the agent can invoke)
 *   - Resources (data the agent can read, with optional change subscriptions)
 *   - Prompts   (reusable message templates the agent can inject into conversation)
 */

// ---------------------------------------------------------------------------
// JSON Schema subset used for tool/prompt parameter schemas
// ---------------------------------------------------------------------------

export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Context objects injected into handler callbacks
// ---------------------------------------------------------------------------

/**
 * Context passed to tool handlers. Includes progress reporting and
 * a cancellation signal tied to the agent connection lifetime.
 */
export interface ToolContext {
  /** Unique ID for this browser session, assigned by the daemon. */
  sessionId: string;
  /** Display name of the agent if provided. */
  agentName?: string;
  /** Aborted when the agent disconnects mid-call. Use to cancel async work. */
  signal: AbortSignal;
  /**
   * Report progress for long-running operations.
   * The daemon forwards these to the agent so it can show "45% complete..." status.
   * @param fraction - 0.0 to 1.0
   * @param message  - Optional human-readable status string
   */
  progress: (fraction: number, message?: string) => void;
}

/**
 * Context passed to resource fetch and subscribe callbacks.
 */
export interface ResourceContext {
  /** Unique ID for this browser session. */
  sessionId: string;
  /** Aborted when the agent disconnects. */
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Tool primitive
// ---------------------------------------------------------------------------

/**
 * Definition of a single callable tool exposed to the AI agent.
 *
 * @template TArgs - The typed shape of this tool's input arguments.
 *
 * @example
 * hub.tool<{ name: string; x: number; y: number }>("move_component", {
 *   description: "Move a component to an absolute position",
 *   inputSchema: {
 *     type: "object",
 *     properties: {
 *       name: { type: "string", description: "Component name" },
 *       x:    { type: "number", description: "X coordinate" },
 *       y:    { type: "number", description: "Y coordinate" },
 *     },
 *     required: ["name", "x", "y"],
 *   },
 *   async handler({ name, x, y }, ctx) {
 *     canvas.findByName(name).moveTo(x, y);
 *     return { success: true };
 *   },
 * });
 */
export interface ToolDefinition<TArgs = Record<string, unknown>> {
  /** One-line description shown to the agent during tool discovery. */
  description: string;
  /**
   * JSON Schema describing the tool's input arguments.
   * Use `inputSchema: { type: "object", properties: {} }` for tools with no arguments.
   */
  inputSchema: JsonSchema;
  /**
   * If true, the browser will show the user a confirmation dialog before
   * executing this tool. Recommended for irreversible operations (delete, overwrite).
   */
  confirm?: boolean;
  /**
   * Custom confirmation message to show to the user. Only used when confirm=true.
   * Defaults to "Allow the AI agent to run <toolName>?"
   */
  confirmMessage?: string;
  /** Async function that executes the tool and returns a JSON-serializable result. */
  handler: (args: TArgs, ctx: ToolContext) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Resource primitive
// ---------------------------------------------------------------------------

/**
 * Definition of a readable data resource exposed to the AI agent.
 *
 * Resources are read-only data snapshots (analogous to HTTP GET). The agent
 * can read these to gain context about the current application state.
 *
 * Optionally, a resource can subscribe to changes and push notifications
 * to the agent when the underlying data changes.
 *
 * @example
 * hub.resource("cad://active-document", {
 *   name: "Active Drawing",
 *   description: "The current CAD drawing as an SVG snapshot",
 *   mimeType: "image/svg+xml",
 *   async fetch(ctx) {
 *     return canvas.exportSVG();
 *   },
 *   subscribe: true,
 *   changeEmitter: (notify) => {
 *     canvas.on("change", notify);
 *     return () => canvas.off("change", notify);  // cleanup
 *   },
 * });
 */
export interface ResourceDefinition {
  /** Human-readable name for this resource (e.g. "Active Drawing"). */
  name: string;
  /** Description shown to the agent during resource discovery. */
  description: string;
  /** MIME type of the content returned by fetch(). Defaults to "text/plain". */
  mimeType?: string;
  /** Fetches the current content of this resource. */
  fetch: (ctx: ResourceContext) => Promise<string | ArrayBuffer>;
  /**
   * If true, the hub will notify the agent when this resource changes.
   * Requires changeEmitter to be set.
   */
  subscribe?: boolean;
  /**
   * A function that registers a change listener and returns a cleanup function.
   * Called when the agent subscribes to this resource.
   *
   * @param notify - Call this whenever the resource data changes.
   * @returns A cleanup function that unregisters the listener.
   */
  changeEmitter?: (notify: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// Prompt primitive
// ---------------------------------------------------------------------------

/**
 * A message in a prompt template.
 */
export interface PromptMessage {
  role: "user" | "assistant";
  content:
    | string
    | { type: "text"; text: string }
    | { type: "image_url"; url: string }
    | { type: "resource"; uri: string };
}

/**
 * Definition of a reusable prompt template exposed to the AI agent.
 *
 * Prompts are pre-written conversational recipes. They appear in the agent's
 * UI as suggestions the user can trigger (e.g. "Analyze this drawing for
 * structural weaknesses"). When invoked, they inject a fully-formed message
 * into the agent's context.
 *
 * @template TArgs - The typed shape of this prompt's input arguments.
 *
 * @example
 * hub.prompt<{ focus_area?: string }>("analyze-drawing", {
 *   description: "Ask the agent to analyze the drawing for structural issues",
 *   inputSchema: {
 *     type: "object",
 *     properties: {
 *       focus_area: { type: "string", description: "Sub-system to focus on" },
 *     },
 *   },
 *   async build({ focus_area }) {
 *     const svg = await canvas.exportSVG();
 *     return [
 *       {
 *         role: "user",
 *         content: `Analyze this CAD drawing${focus_area ? ` focusing on ${focus_area}` : ""}:\n${svg}`,
 *       },
 *     ];
 *   },
 * });
 */
export interface PromptDefinition<TArgs = Record<string, unknown>> {
  /** Description shown to the agent and user during prompt discovery. */
  description: string;
  /**
   * Optional JSON Schema for prompt arguments.
   * Leave undefined for prompts that take no parameters.
   */
  inputSchema?: JsonSchema;
  /** Builds the list of messages to inject into the agent's context. */
  build: (args: TArgs) => Promise<PromptMessage[]>;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/** Level of access granted to the agent when the user approves consent. */
export type PermissionLevel = "read-only" | "full";

/**
 * Options passed to the McpHubClient constructor.
 */
export interface McpHubOptions {
  /**
   * WebTransport URL of the mcp-daemon.
   * Defaults to "https://localhost:8043/webtransport".
   */
  daemonUrl?: string;
  /** Your application's name (e.g. "WebCAD"). Shown in the consent dialog. */
  appName: string;
  /**
   * A dynamic label for this specific browser session. Shown in the agent's
   * hub_list_sessions() output. Can be a static string or a function that
   * returns the current label (useful when the open document changes).
   *
   * @example sessionLabel: () => `WebCAD – ${canvas.activeDocument.name}`
   */
  sessionLabel?: string | (() => string);
  /**
   * The name of the document currently open, if applicable.
   * Shown in the consent dialog to help the user understand what they're granting access to.
   */
  documentName?: string | (() => string);
  /**
   * SHA-256 fingerprint (hex) of the daemon's TLS certificate.
   * If omitted, certificate verification is skipped (fine for localhost dev).
   */
  certHash?: string;
  /**
   * A callback function that dynamically retrieves the latest certificate hash.
   * Called before every connection attempt (and reconnection). Takes precedence
   * over the static certHash option.
   */
  getCertHash?: () => Promise<string>;
  /**
   * A single opaque 64-character hex token proving local machine authorization.
   * Paste the value printed by the mcp-daemon on startup (found in ~/.mcp-hub/token).
   *
   * Internally the library treats it as a compound of two independent 32-char sub-tokens:
   *   - **certToken** (chars 0–31): sent in the POST /cert-hash request body (HTTP).
   *     If sniffed, an attacker learns only the TLS certificate fingerprint — not enough
   *     to join the session.
   *   - **wtToken**   (chars 32–63): sent during the WebTransport registration handshake
   *     (encrypted QUIC). This is the actual proof of local machine access.
   *
   * As a user of this library you never need to split this token yourself.
   */
  token?: string;
  /**
   * If true, intercepts console.log/warn/error and unhandled exceptions,
   * exposing them via a get_browser_logs tool. Defaults to false.
   */
  enableConsoleLog?: boolean;
}

/**
 * Options passed to hub.connect().
 */
export interface ConnectOptions {
  /**
   * If true, shows a browser consent dialog before connecting.
   * The user must explicitly click "Allow" before any tools are exposed.
   * Strongly recommended for production use. Defaults to false.
   */
  requireConsent?: boolean;
  /**
   * Custom body text for the consent dialog.
   * Defaults to a generated description of the tools being exposed.
   */
  consentMessage?: string;
  /**
   * The level of access to grant. If set, the consent dialog will show
   * "Allow Read-Only" and "Allow Full Access" buttons.
   * Defaults to "full".
   */
  permissionLevel?: PermissionLevel;
}

// ---------------------------------------------------------------------------
// Session info (sent to daemon on register)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: string;
  label: string;
  appName: string;
  documentName?: string;
  permissionLevel: PermissionLevel;
}

// ---------------------------------------------------------------------------
// Wire protocol envelope types (browser ↔ daemon)
// ---------------------------------------------------------------------------

export interface BridgeEnvelope {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export interface RegisterEnvelope extends BridgeEnvelope {
  type: "register_client";
  client_type: "browser";
  session: SessionInfo;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: JsonSchema;
    requiresConfirmation?: boolean;
  }>;
  resources: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType?: string;
    subscribable: boolean;
  }>;
  prompts: Array<{
    name: string;
    description: string;
    inputSchema?: JsonSchema;
  }>;
}

export interface ToolRequestEnvelope extends BridgeEnvelope {
  type: "tool_request";
  id: string;
  tool: string;
  payload: Record<string, unknown>;
}

export interface ToolResponseEnvelope extends BridgeEnvelope {
  type: "tool_response";
  id: string;
  payload: {
    success: boolean;
    result?: unknown;
    error?: string;
  };
}

export interface ToolProgressEnvelope extends BridgeEnvelope {
  type: "tool_progress";
  id: string;
  payload: {
    fraction: number;
    message?: string;
  };
}

export interface ResourceRequestEnvelope extends BridgeEnvelope {
  type: "resource_request";
  id: string;
  uri: string;
}

export interface ResourceResponseEnvelope extends BridgeEnvelope {
  type: "resource_response";
  id: string;
  payload: {
    success: boolean;
    mimeType?: string;
    content?: string;
    error?: string;
  };
}

export interface ResourceChangedEnvelope extends BridgeEnvelope {
  type: "resource_changed";
  uri: string;
}

export interface PromptRequestEnvelope extends BridgeEnvelope {
  type: "prompt_request";
  id: string;
  name: string;
  payload: Record<string, unknown>;
}

export interface PromptResponseEnvelope extends BridgeEnvelope {
  type: "prompt_response";
  id: string;
  payload: {
    success: boolean;
    messages?: PromptMessage[];
    error?: string;
  };
}
