/**
 * @file client.ts
 * McpHubClient — the main class for the MCP Hub browser client library.
 *
 * Usage:
 *
 *   const hub = new McpHubClient({ appName: "WebCAD" });
 *
 *   hub.tool<{ x: number; y: number }>("draw_point", {
 *     description: "Draw a point at coordinates",
 *     inputSchema: {
 *       type: "object",
 *       properties: {
 *         x: { type: "number" },
 *         y: { type: "number" },
 *       },
 *       required: ["x", "y"],
 *     },
 *     handler: async ({ x, y }) => {
 *       canvas.drawPoint(x, y);
 *       return { success: true };
 *     },
 *   });
 *
 *   await hub.connect({ requireConsent: true });
 */

import { WebTransportBridge } from "./transport.js";
import { showConsentDialog, showToolConfirmation } from "./consent.js";
import type {
  McpHubOptions,
  ConnectOptions,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  PermissionLevel,
  ToolContext,
  ResourceContext,
  BridgeEnvelope,
  RegisterEnvelope,
  ToolRequestEnvelope,
  ToolResponseEnvelope,
  ToolProgressEnvelope,
  ResourceRequestEnvelope,
  ResourceResponseEnvelope,
  ResourceChangedEnvelope,
  PromptRequestEnvelope,
  PromptResponseEnvelope,
  SessionInfo,
} from "./types.js";

const DEFAULT_DAEMON_URL = "https://localhost:8043/webtransport";

/**
 * Splits a 64-char compound token into its two sub-tokens.
 *
 * The daemon generates one opaque 64-char hex blob stored in ~/.mcp-hub/token:
 *   certToken = blob[0..32]   — sent in the POST /cert-hash JSON body (HTTP)
 *   wtToken   = blob[32..64]  — sent during WebTransport registration (QUIC/TLS)
 *
 * Leaking certToken (e.g. via HTTP log sniffing) only lets an attacker learn
 * the TLS cert fingerprint. They still cannot register as a browser session
 * without wtToken, which never travels over plaintext.
 *
 * If a legacy 32-char single-part token is supplied, it is used for both.
 */
function parseCompoundToken(token: string): { certToken: string; wtToken: string } {
  if (token.length === 64) {
    return { certToken: token.slice(0, 32), wtToken: token.slice(32, 64) };
  }
  // Legacy or short token — use as-is for both (graceful degradation)
  return { certToken: token, wtToken: token };
}

type EventMap = {
  "agent:connected": [];
  "agent:disconnected": [];
  "status:change": [status: "disconnected" | "connecting" | "connected"];
};

/**
 * McpHubClient exposes your web application's widgets and data to AI agents
 * via the MCP Hub daemon running locally.
 *
 * It implements all three MCP server-side primitives:
 *   - Tools     (.tool())     — actions the agent can invoke
 *   - Resources (.resource()) — read-only data, with optional change notifications
 *   - Prompts   (.prompt())   — reusable conversation templates
 */
export class McpHubClient {
  private opts: McpHubOptions & { daemonUrl: string };

  // Registries
  private tools = new Map<string, ToolDefinition<unknown>>();
  private resources = new Map<string, ResourceDefinition>();
  private prompts = new Map<string, PromptDefinition<unknown>>();

  // Active resource subscriptions: uri → cleanup fn
  private resourceCleanups = new Map<string, () => void>();

  // Event listeners
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  private bridge: WebTransportBridge | null = null;
  private sessionId: string | null = null;
  private permissionLevel: PermissionLevel = "full";
  private browserLogs: string[] = [];
  // Derived from the compound token; set during connect().
  private _certToken: string | undefined = undefined;
  private _wtToken: string | undefined = undefined;

  constructor(opts: McpHubOptions) {
    this.opts = { ...opts, daemonUrl: opts.daemonUrl ?? DEFAULT_DAEMON_URL };
    if (this.opts.enableConsoleLog) {
      this.setupConsoleLogging();
    }
  }

  private setupConsoleLogging() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const captureLog = (type: string, message: string) => {
      this.browserLogs.push(`[${type.toUpperCase()}] ${message}`);
      if (this.browserLogs.length > 100) this.browserLogs.shift();
    };

    console.log = (...args: unknown[]) => {
      const msg = args.join(" ");
      originalLog.apply(console, args);
      captureLog("info", msg);
    };
    console.error = (...args: unknown[]) => {
      const msg = args.join(" ");
      originalError.apply(console, args);
      captureLog("error", msg);
    };
    console.warn = (...args: unknown[]) => {
      const msg = args.join(" ");
      originalWarn.apply(console, args);
      captureLog("warn", msg);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("error", (e) => {
        captureLog("error", `Unhandled exception: ${e.message} at ${e.filename}:${e.lineno}`);
      });
    }

    // Register get_browser_logs tool automatically
    this.tool("get_browser_logs", {
      description: "Retrieve recent browser console logs and runtime errors for debugging",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        return this.browserLogs.length > 0 ? this.browserLogs.join("\n") : "No logs recorded.";
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Registration API — call these before connect()
  // ---------------------------------------------------------------------------

  /**
   * Register a tool. Chainable.
   *
   * @template TArgs - Shape of the tool's input arguments.
   */
  tool<TArgs = Record<string, unknown>>(
    name: string,
    definition: ToolDefinition<TArgs>
  ): this {
    this.tools.set(name, definition as ToolDefinition<unknown>);
    return this;
  }

  /**
   * Register a resource. Chainable.
   *
   * @param uri - A stable identifier for this resource (e.g. "cad://active-document").
   *              Must be unique within this session.
   */
  resource(uri: string, definition: ResourceDefinition): this {
    this.resources.set(uri, definition);
    return this;
  }

  /**
   * Register a prompt template. Chainable.
   *
   * @template TArgs - Shape of the prompt's optional input arguments.
   */
  prompt<TArgs = Record<string, unknown>>(
    name: string,
    definition: PromptDefinition<TArgs>
  ): this {
    this.prompts.set(name, definition as PromptDefinition<unknown>);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connect to the mcp-daemon.
   *
   * If requireConsent is true (recommended for production), shows the user
   * a permission dialog before opening any connection to the daemon.
   */
  async connect(opts: ConnectOptions = {}): Promise<void> {
    const { requireConsent = false } = opts;

    // Consent gate — nothing leaves the browser until the user approves.
    if (requireConsent) {
      const docName = this.resolveString(this.opts.documentName);
      const result = await showConsentDialog({
        appName: this.opts.appName,
        ...(docName !== undefined ? { documentName: docName } : {}),
        ...(opts.consentMessage !== undefined ? { message: opts.consentMessage } : {}),
        tools: Array.from(this.tools.entries()).map(([name, definition]) => ({
          name,
          definition,
        })),
        resources: Array.from(this.resources.entries()).map(([uri, definition]) => ({
          uri,
          definition,
        })),
      });

      if (!result.approved) {
        console.info("[McpHub] User denied agent access.");
        return;
      }

      this.permissionLevel = result.permissionLevel;
    }

    this.sessionId = crypto.randomUUID();

    // Split compound token internally — user sees one opaque blob.
    const { certToken, wtToken } = this.opts.token
      ? parseCompoundToken(this.opts.token)
      : { certToken: undefined, wtToken: undefined };
    // Store wtToken for use in onConnected()'s registration message.
    this._wtToken = wtToken;

    // If a static certHash was provided but a token-gated dynamic fetch is also
    // available, the getCertHash callback takes precedence (already set by user).
    let resolvedGetCertHash = this.opts.getCertHash;
    if (resolvedGetCertHash === undefined && this.opts.certHash === undefined && certToken !== undefined) {
      // Auto-wire dynamic token-gated fetch from daemon HTTP control server
      resolvedGetCertHash = async () => {
        let httpUrl = "http://localhost:8080/cert-hash";
        try {
          const u = new URL(this.opts.daemonUrl || DEFAULT_DAEMON_URL);
          const wtPort = parseInt(u.port);
          if (!isNaN(wtPort)) {
            const httpPort = wtPort === 8043 ? 8080 : wtPort + 37;
            httpUrl = `${u.protocol === "https:" ? "http:" : u.protocol}//${u.hostname}:${httpPort}/cert-hash`;
          }
        } catch {
          // fallback
        }

        const resp = await fetch(httpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: certToken })
        });
        if (!resp.ok) {
          throw new Error(`Failed to fetch cert hash from daemon HTTP server (Status: ${resp.status})`);
        }
        const data = await resp.json() as { hash?: string; error?: string };
        if (data.error) {
          throw new Error(`Daemon returned error fetching cert hash: ${data.error}`);
        }
        if (!data.hash) {
          throw new Error("Daemon returned empty cert hash");
        }
        return data.hash;
      };
    }

    this.bridge = new WebTransportBridge({
      url: this.opts.daemonUrl || DEFAULT_DAEMON_URL,
      ...(this.opts.certHash !== undefined ? { certHash: this.opts.certHash } : {}),
      ...(resolvedGetCertHash !== undefined ? { getCertHash: resolvedGetCertHash } : {}),
      onMessage: (env) => this.handleMessage(env),
      onConnect: () => this.onConnected(),
      onDisconnect: () => this.onDisconnected(),
      onStatusChange: (s) => this.emit("status:change", s),
    });

    // Store certToken for external callers who might build their own getCertHash.
    this._certToken = certToken;

    // Start connection loop (reconnects automatically on drop).
    // We do NOT await this — it runs indefinitely in the background.
    this.bridge.connect().catch((err) => {
      console.error("[McpHub] Fatal transport error:", err);
    });
  }

  /**
   * Disconnect from the daemon and clean up all subscriptions.
   * Safe to call multiple times.
   */
  disconnect(): void {
    this.bridge?.close();
    this.bridge = null;
    for (const cleanup of this.resourceCleanups.values()) cleanup();
    this.resourceCleanups.clear();
  }

  /**
   * Send a custom notification envelope to the daemon.
   * Notifications do not expect a response and are broadcast to all connected agents.
   */
  async sendNotification(type: string, payload?: unknown): Promise<void> {
    if (!this.bridge) {
      throw new Error("[McpHub] Client is not connected");
    }
    const env = {
      type,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    };
    await this.bridge.send(env as any);
  }

  // ---------------------------------------------------------------------------
  // Event emitter (minimal, no external deps)
  // ---------------------------------------------------------------------------

  on<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void
  ): this {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler as (...args: unknown[]) => void);
    this.listeners.set(event, handlers);
    return this;
  }

  off<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void
  ): this {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((h) => h !== handler)
    );
    return this;
  }

  // ---------------------------------------------------------------------------
  // Private: connection lifecycle
  // ---------------------------------------------------------------------------

  private onConnected(): void {
    // Send our full manifest (tools, resources, prompts) to the daemon.
    const docName = this.resolveString(this.opts.documentName);
    const session: SessionInfo = {
      id: this.sessionId!,
      label: this.resolveString(this.opts.sessionLabel) ?? this.opts.appName,
      appName: this.opts.appName,
      ...(docName !== undefined ? { documentName: docName } : {}),
      permissionLevel: this.permissionLevel,
    };

    const registerEnvelope: RegisterEnvelope = {
      type: "register_client",
      client_type: "browser",
      session,
      ...(this._wtToken !== undefined ? { token: this._wtToken } : {}),
      tools: Array.from(this.tools.entries())
        .filter(([, def]) => this.permissionLevel === "full" || !def.confirm)
        .map(([name, def]) => ({
          name,
          description: def.description,
          inputSchema: def.inputSchema,
          requiresConfirmation: def.confirm ?? false,
        })),
      resources: Array.from(this.resources.entries()).map(([uri, def]) => ({
        uri,
        name: def.name,
        description: def.description,
        ...(def.mimeType !== undefined ? { mimeType: def.mimeType } : {}),
        subscribable: def.subscribe ?? false,
      })),
      prompts: Array.from(this.prompts.entries()).map(([name, def]) => ({
        name,
        description: def.description,
        ...(def.inputSchema !== undefined ? { inputSchema: def.inputSchema } : {}),
      })),
    };

    this.bridge!.send(registerEnvelope).catch((err) => {
      console.error("[McpHub] Failed to send register envelope:", err);
    });

    this.emit("agent:connected");
  }

  private onDisconnected(): void {
    // Clean up resource subscriptions
    for (const cleanup of this.resourceCleanups.values()) cleanup();
    this.resourceCleanups.clear();
    this.emit("agent:disconnected");
  }

  // ---------------------------------------------------------------------------
  // Private: message routing
  // ---------------------------------------------------------------------------

  private handleMessage(env: BridgeEnvelope): void {
    switch (env.type) {
      case "tool_request":
        this.handleToolRequest(env as ToolRequestEnvelope);
        break;
      case "resource_request":
        this.handleResourceRequest(env as ResourceRequestEnvelope);
        break;
      case "resource_subscribe":
        this.handleResourceSubscribe(env as ResourceRequestEnvelope);
        break;
      case "resource_unsubscribe":
        this.handleResourceUnsubscribe(env as ResourceRequestEnvelope);
        break;
      case "prompt_request":
        this.handlePromptRequest(env as PromptRequestEnvelope);
        break;
      default:
        // ignore unknown message types
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Tool execution
  // ---------------------------------------------------------------------------

  private async handleToolRequest(req: ToolRequestEnvelope): Promise<void> {
    const def = this.tools.get(req.tool);
    if (!def) {
      await this.sendToolResponse(req.id, false, undefined, `Tool "${req.tool}" not found`);
      return;
    }

    // Read-only session: block all tools with side effects
    if (this.permissionLevel === "read-only") {
      await this.sendToolResponse(req.id, false, undefined, "This session is read-only. The user has not granted write access.");
      return;
    }

    // Destructive tools require in-browser user confirmation
    if (def.confirm) {
      const approved = await showToolConfirmation(req.tool, def.confirmMessage);
      if (!approved) {
        await this.sendToolResponse(req.id, false, undefined, "User denied the action.");
        return;
      }
    }

    // Build context with progress reporting and abort signal
    const abortController = new AbortController();
    const ctx: ToolContext = {
      sessionId: this.sessionId!,
      signal: abortController.signal,
      progress: (fraction, message) => {
        const progressEnv: ToolProgressEnvelope = {
          type: "tool_progress",
          id: req.id,
          payload: { fraction, ...(message !== undefined ? { message } : {}) },
        };
        this.bridge?.send(progressEnv).catch(() => {});
      },
    };

    try {
      const result = await def.handler(req.payload, ctx);
      await this.sendToolResponse(req.id, true, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.sendToolResponse(req.id, false, undefined, message);
    } finally {
      abortController.abort();
    }
  }

  private async sendToolResponse(
    id: string,
    success: boolean,
    result?: unknown,
    error?: string
  ): Promise<void> {
    const env: ToolResponseEnvelope = {
      type: "tool_response",
      id,
      payload: {
        success,
        ...(result !== undefined ? { result } : {}),
        ...(error !== undefined ? { error } : {}),
      },
    };
    await this.bridge?.send(env);
  }

  // ---------------------------------------------------------------------------
  // Private: Resource reads & subscriptions
  // ---------------------------------------------------------------------------

  private async handleResourceRequest(req: ResourceRequestEnvelope): Promise<void> {
    const def = this.resources.get(req.uri);
    if (!def) {
      const env: ResourceResponseEnvelope = {
        type: "resource_response",
        id: req.id,
        payload: { success: false, error: `Resource "${req.uri}" not found` },
      };
      await this.bridge?.send(env);
      return;
    }

    const ctx: ResourceContext = {
      sessionId: this.sessionId!,
      signal: new AbortController().signal,
    };

    try {
      const content = await def.fetch(ctx);
      const text =
        content instanceof ArrayBuffer
          ? btoa(String.fromCharCode(...new Uint8Array(content)))
          : content;
      const env: ResourceResponseEnvelope = {
        type: "resource_response",
        id: req.id,
        payload: { success: true, mimeType: def.mimeType ?? "text/plain", content: text },
      };
      await this.bridge?.send(env);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const env: ResourceResponseEnvelope = {
        type: "resource_response",
        id: req.id,
        payload: { success: false, error: message },
      };
      await this.bridge?.send(env);
    }
  }

  private handleResourceSubscribe(req: ResourceRequestEnvelope): void {
    const def = this.resources.get(req.uri);
    if (!def?.subscribe || !def.changeEmitter) return;
    if (this.resourceCleanups.has(req.uri)) return; // already subscribed

    const cleanup = def.changeEmitter(() => {
      const notif: ResourceChangedEnvelope = {
        type: "resource_changed",
        uri: req.uri,
      };
      this.bridge?.send(notif).catch(() => {});
    });

    this.resourceCleanups.set(req.uri, cleanup);
  }

  private handleResourceUnsubscribe(req: ResourceRequestEnvelope): void {
    const cleanup = this.resourceCleanups.get(req.uri);
    if (cleanup) {
      cleanup();
      this.resourceCleanups.delete(req.uri);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Prompt execution
  // ---------------------------------------------------------------------------

  private async handlePromptRequest(req: PromptRequestEnvelope): Promise<void> {
    const def = this.prompts.get(req.name);
    if (!def) {
      const env: PromptResponseEnvelope = {
        type: "prompt_response",
        id: req.id,
        payload: { success: false, error: `Prompt "${req.name}" not found` },
      };
      await this.bridge?.send(env);
      return;
    }

    try {
      const messages = await def.build(req.payload);
      const env: PromptResponseEnvelope = {
        type: "prompt_response",
        id: req.id,
        payload: { success: true, messages },
      };
      await this.bridge?.send(env);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const env: PromptResponseEnvelope = {
        type: "prompt_response",
        id: req.id,
        payload: { success: false, error: message },
      };
      await this.bridge?.send(env);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private resolveString(v?: string | (() => string)): string | undefined {
    if (v === undefined) return undefined;
    return typeof v === "function" ? v() : v;
  }

  private emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) h(...(args as unknown[]));
  }
}
