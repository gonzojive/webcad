/**
 * @file index.ts
 * Public API surface of @mcp-hub/browser-client.
 *
 * Everything a web app developer needs is exported from here.
 * Import like:
 *
 *   import { McpHubClient } from "@mcp-hub/browser-client";
 */

// Main class
export { McpHubClient } from "./client.js";

// Types — re-export all public-facing types so users don't need to
// dig into sub-modules.
export type {
  // Client configuration
  McpHubOptions,
  ConnectOptions,
  PermissionLevel,

  // MCP primitives
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  PromptMessage,

  // Callback contexts
  ToolContext,
  ResourceContext,

  // Schema types
  JsonSchema,
  JsonSchemaProperty,
} from "./types.js";
