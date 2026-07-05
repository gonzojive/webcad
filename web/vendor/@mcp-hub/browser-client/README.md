# `@mcp-hub/browser-client`

Browser-side TypeScript SDK for connecting web applications (such as WebCAD) to the Model Context Protocol (MCP) Hub daemon.

## Overview

This package enables web applications to securely register browser-side tools, prompts, and resources with a local MCP Hub daemon over [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API). Once connected, external AI agents running on the user's machine can discover and execute these browser-side tools (e.g., executing sketch actions in a CAD canvas, taking screenshots, or reading viewport state).

```
   ┌──────────────┐                  ┌────────────────┐
   │  Web App     │  WebTransport    │  MCP Hub       │
   │  (Browser)   │ ◄──────────────► │  Daemon (Host) │
   └──────────────┘                  └────────────────┘
```

## Key Features

*   **WebTransport Connectivity**: Establishes lightweight, low-latency, bi-directional communication channels with the host daemon.
*   **Dynamic Tool Registration**: Register TypeScript functions as MCP tools, exposing them with JSON schemas to connected agents.
*   **User Consent Framework**: Built-in support for authorization flows, requiring users to explicitly approve connections or specific actions before exposing capabilities.
*   **Zero-Dependency Core**: Lightweight client codebase designed to compile cleanly inside modern bundlers (e.g., Angular compiler, Vite, Webpack).

## Monorepo Integration

This package is integrated into the WebCAD monorepo as a local workspace package under `web/vendor/@mcp-hub/browser-client`. It is referenced in the pnpm workspace:

```yaml
# pnpm-workspace.yaml
packages:
  - 'vendor/@mcp-hub/browser-client'
```

And declared as a dependency in web projects:

```json
"dependencies": {
  "@mcp-hub/browser-client": "workspace:*"
}
```
