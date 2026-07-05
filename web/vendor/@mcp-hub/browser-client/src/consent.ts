/**
 * @file consent.ts
 * Browser-side user consent dialog.
 *
 * Before any tools are exposed to the agent, the user must explicitly
 * approve access. This module injects a modal into the current page
 * (no framework dependencies) and resolves with the user's choice.
 *
 * Security principle: The tab is the gatekeeper. Nothing is sent to the
 * daemon until the user clicks "Allow".
 */

import type { PermissionLevel, ToolDefinition, ResourceDefinition } from "./types.js";

export interface ConsentResult {
  approved: boolean;
  permissionLevel: PermissionLevel;
}

export interface ConsentOptions {
  appName: string;
  documentName?: string;
  /** Override body copy in the dialog. */
  message?: string;
  tools: Array<{ name: string; definition: ToolDefinition<unknown> }>;
  resources: Array<{ uri: string; definition: ResourceDefinition }>;
}

const STYLES = `
  .mcp-consent-backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    z-index: 2147483646;
    display: flex; align-items: center; justify-content: center;
    animation: mcp-fade-in 0.15s ease;
  }
  @keyframes mcp-fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes mcp-slide-up {
    from { transform: translateY(16px); opacity: 0 }
    to   { transform: translateY(0);    opacity: 1 }
  }
  .mcp-consent-dialog {
    background: #ffffff;
    border: 1px solid #d0d7de;
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.18);
    max-width: 460px; width: 90%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    animation: mcp-slide-up 0.2s ease;
    overflow: hidden;
  }
  .mcp-consent-header {
    padding: 20px 24px 16px;
    border-bottom: 1px solid #d0d7de;
  }
  .mcp-consent-header h2 {
    font-size: 16px; font-weight: 600; color: #24292f;
    margin: 0 0 4px;
    display: flex; align-items: center; gap: 8px;
  }
  .mcp-consent-header h2 .mcp-robot { font-size: 20px; }
  .mcp-consent-header p {
    font-size: 13px; color: #57606a; margin: 0;
  }
  .mcp-consent-body { padding: 16px 24px; }
  .mcp-consent-body p {
    font-size: 13px; color: #24292f; margin: 0 0 12px;
  }
  .mcp-permission-list {
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 10px 14px;
    list-style: none;
    margin: 0 0 14px;
  }
  .mcp-permission-list li {
    font-size: 13px; color: #24292f;
    padding: 4px 0;
    display: flex; align-items: flex-start; gap: 8px;
  }
  .mcp-permission-list li .mcp-icon { flex-shrink: 0; margin-top: 1px; }
  .mcp-permission-list li.mcp-write { color: #cf222e; }
  .mcp-notice {
    font-size: 12px; color: #57606a;
    border-left: 3px solid #d0d7de;
    padding: 6px 10px;
    margin: 0;
  }
  .mcp-consent-footer {
    padding: 14px 24px;
    border-top: 1px solid #d0d7de;
    display: flex; gap: 8px; justify-content: flex-end;
    background: #f6f8fa;
  }
  .mcp-btn {
    font-size: 14px; font-weight: 500;
    padding: 7px 16px;
    border-radius: 6px; border: 1px solid;
    cursor: pointer; transition: opacity 0.15s;
  }
  .mcp-btn:hover { opacity: 0.85; }
  .mcp-btn-deny {
    background: transparent; border-color: #d0d7de; color: #24292f;
  }
  .mcp-btn-readonly {
    background: #f6f8fa; border-color: #d0d7de; color: #24292f;
  }
  .mcp-btn-allow {
    background: #2da44e; border-color: rgba(27,31,36,.15); color: #ffffff;
  }
`;

/**
 * Show a consent modal to the user.
 *
 * Resolves once the user clicks a button. If they deny, approved=false.
 * The dialog is fully self-contained (no external dependencies).
 */
export function showConsentDialog(opts: ConsentOptions): Promise<ConsentResult> {
  return new Promise((resolve) => {
    // Inject styles once
    if (!document.getElementById("mcp-hub-consent-styles")) {
      const style = document.createElement("style");
      style.id = "mcp-hub-consent-styles";
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    const hasWriteTools = opts.tools.some((t) => !t.definition.confirm === false);
    const toolNames = opts.tools.map((t) => t.name);
    const resourceNames = opts.resources.map((r) => r.definition.name);

    const docLabel = opts.documentName ? ` on <strong>${escapeHtml(opts.documentName)}</strong>` : "";

    const permissionItems: string[] = [];
    if (opts.tools.length > 0) {
      const confirmRequired = opts.tools.filter((t) => t.definition.confirm);
      const writeTools = opts.tools.filter((t) => !t.definition.confirm);
      if (confirmRequired.length > 0) {
        permissionItems.push(
          `<li><span class="mcp-icon">⚠️</span> Perform actions (will ask for confirmation): ${confirmRequired.map((t) => `<code>${escapeHtml(t.name)}</code>`).join(", ")}</li>`
        );
      }
      if (writeTools.length > 0) {
        permissionItems.push(
          `<li class="mcp-write"><span class="mcp-icon">✏️</span> Modify your work directly: ${writeTools.map((t) => `<code>${escapeHtml(t.name)}</code>`).join(", ")}</li>`
        );
      }
    }
    if (opts.resources.length > 0) {
      permissionItems.push(
        `<li><span class="mcp-icon">📄</span> Read data: ${resourceNames.map((r) => `<code>${escapeHtml(r)}</code>`).join(", ")}</li>`
      );
    }

    const bodyMsg = opts.message ??
      `<strong>${escapeHtml(opts.appName)}</strong> wants to let your AI agent access this tab${docLabel}.`;

    const backdrop = document.createElement("div");
    backdrop.className = "mcp-consent-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "AI Agent Access Request");
    backdrop.innerHTML = `
      <div class="mcp-consent-dialog">
        <div class="mcp-consent-header">
          <h2><span class="mcp-robot">🤖</span> Allow AI Agent Access?</h2>
          <p>${escapeHtml(opts.appName)}${opts.documentName ? ` — ${escapeHtml(opts.documentName)}` : ""}</p>
        </div>
        <div class="mcp-consent-body">
          <p>${bodyMsg}</p>
          ${permissionItems.length > 0 ? `<ul class="mcp-permission-list">${permissionItems.join("")}</ul>` : ""}
          <p class="mcp-notice">
            You can revoke access at any time by closing this tab or refreshing the page.
          </p>
        </div>
        <div class="mcp-consent-footer">
          <button class="mcp-btn mcp-btn-deny" id="mcp-deny">Deny</button>
          <button class="mcp-btn mcp-btn-readonly" id="mcp-readonly">Allow Read-Only</button>
          <button class="mcp-btn mcp-btn-allow" id="mcp-allow">Allow Full Access</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const cleanup = (result: ConsentResult) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.querySelector("#mcp-deny")!.addEventListener("click", () =>
      cleanup({ approved: false, permissionLevel: "full" })
    );
    backdrop.querySelector("#mcp-readonly")!.addEventListener("click", () =>
      cleanup({ approved: true, permissionLevel: "read-only" })
    );
    backdrop.querySelector("#mcp-allow")!.addEventListener("click", () =>
      cleanup({ approved: true, permissionLevel: "full" })
    );

    // Deny on backdrop click
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup({ approved: false, permissionLevel: "full" });
    });

    // Deny on Escape key
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        cleanup({ approved: false, permissionLevel: "full" });
      }
    };
    document.addEventListener("keydown", onKey);
  });
}

/** Show a small in-page confirmation dialog for destructive tool calls. */
export function showToolConfirmation(
  toolName: string,
  message?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!document.getElementById("mcp-hub-consent-styles")) {
      const style = document.createElement("style");
      style.id = "mcp-hub-consent-styles";
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "mcp-consent-backdrop";
    backdrop.innerHTML = `
      <div class="mcp-consent-dialog">
        <div class="mcp-consent-header">
          <h2><span class="mcp-robot">⚠️</span> Confirm AI Action</h2>
          <p>Tool: <code>${escapeHtml(toolName)}</code></p>
        </div>
        <div class="mcp-consent-body">
          <p>${escapeHtml(message ?? `Allow the AI agent to run "${toolName}"?`)}</p>
        </div>
        <div class="mcp-consent-footer">
          <button class="mcp-btn mcp-btn-deny" id="mcp-deny">Cancel</button>
          <button class="mcp-btn mcp-btn-allow" id="mcp-allow">Run</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const cleanup = (ok: boolean) => {
      backdrop.remove();
      resolve(ok);
    };

    backdrop.querySelector("#mcp-deny")!.addEventListener("click", () => cleanup(false));
    backdrop.querySelector("#mcp-allow")!.addEventListener("click", () => cleanup(true));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cleanup(false); });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
