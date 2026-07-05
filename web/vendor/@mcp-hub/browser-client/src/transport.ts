/**
 * @file transport.ts
 * Low-level WebTransport connection wrapper with automatic reconnection.
 *
 * Responsibilities:
 *   - Open a WebTransport bidirectional stream to the mcp-daemon
 *   - Frame outgoing JSON messages as newline-delimited strings
 *   - Parse incoming newline-delimited JSON messages
 *   - Reconnect automatically with exponential backoff on disconnect
 *   - Notify callers of connect/disconnect events
 */

import type { BridgeEnvelope } from "./types.js";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface TransportOptions {
  /** WebTransport URL of the daemon, e.g. "https://localhost:8043/webtransport" */
  url: string;
  /**
   * SHA-256 fingerprint (hex) of the server certificate.
   * Required by Chrome for self-signed certs on localhost.
   * If omitted, certificate verification is skipped.
   */
  certHash?: string;
  /**
   * Callback to dynamically fetch the latest cert hash before connecting.
   */
  getCertHash?: () => Promise<string>;
  /** Called each time a parsed envelope arrives from the daemon. */
  onMessage: (envelope: BridgeEnvelope) => void;
  /** Called when the WebTransport stream is established (or re-established). */
  onConnect: () => void;
  /** Called when the WebTransport stream drops. Reconnection starts automatically. */
  onDisconnect: () => void;
  /** Called whenever the connection status changes. */
  onStatusChange?: (status: ConnectionStatus) => void;
}

/**
 * Manages a persistent, auto-reconnecting WebTransport connection to the mcp-daemon.
 */
export class WebTransportBridge {
  private opts: TransportOptions;
  private transport: WebTransport | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private abortController = new AbortController();
  private reconnectDelay = 1_000; // ms, doubles on each failure up to maxReconnectDelay
  private readonly maxReconnectDelay = 16_000;
  private _status: ConnectionStatus = "disconnected";
  private encoder = new TextEncoder();

  constructor(opts: TransportOptions) {
    this.opts = opts;
  }

  /** Start the connection loop. Resolves when close() is called. */
  async connect(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      this.setStatus("connecting");
      try {
        await this.attemptConnect();
        // Returned normally means the stream ended cleanly — reset backoff.
        this.reconnectDelay = 1_000;
      } catch (err) {
        if (this.abortController.signal.aborted) break;
        console.warn(
          `[McpHub] Connection failed, retrying in ${this.reconnectDelay}ms:`,
          err
        );
      }
      if (!this.abortController.signal.aborted) {
        this.setStatus("disconnected");
        this.opts.onDisconnect();
        await this.sleep(this.reconnectDelay);
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay
        );
      }
    }
  }

  /** Send an envelope to the daemon. Throws if not connected. */
  async send(envelope: BridgeEnvelope): Promise<void> {
    if (!this.writer) {
      throw new Error("[McpHub] Cannot send: WebTransport stream not connected");
    }
    const line = JSON.stringify(envelope) + "\n";
    await this.writer.write(this.encoder.encode(line));
  }

  /** Close the connection permanently (no reconnect). */
  close(): void {
    this.abortController.abort();
    try {
      this.transport?.close();
    } catch {
      // ignore errors during close
    }
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async attemptConnect(): Promise<void> {
    const transportOpts: WebTransportOptions = {};

    let activeHash = this.opts.certHash;
    if (this.opts.getCertHash) {
      try {
        activeHash = await this.opts.getCertHash();
      } catch (err) {
        console.warn("[McpHub] Failed to fetch certificate hash dynamically:", err);
      }
    }

    if (activeHash) {
      transportOpts.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: hexToBytes(activeHash).buffer as ArrayBuffer,
        },
      ];
    } else {
      // Dev mode: skip cert verification.
      // Note: only works in Chrome with certain flags; fine for localhost.
      (transportOpts as Record<string, unknown>).serverCertificateHashes = [];
    }

    const transport = new WebTransport(this.opts.url, transportOpts);
    this.transport = transport;

    await transport.ready;

    // Open a single bidirectional stream for all hub communication.
    const stream = await transport.createBidirectionalStream();
    this.writer = stream.writable.getWriter();

    this.setStatus("connected");
    this.reconnectDelay = 1_000;
    this.opts.onConnect();

    // Read loop — parses newline-delimited JSON
    await this.readLoop(stream.readable);

    // If we get here the stream closed cleanly.
    this.writer = null;
  }

  private async readLoop(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process all complete lines
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const env = JSON.parse(line) as BridgeEnvelope;
            this.opts.onMessage(env);
          } catch {
            console.warn("[McpHub] Failed to parse envelope:", line);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (this._status !== s) {
      this._status = s;
      this.opts.onStatusChange?.(s);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Convert a hex string (e.g. "2c5d09...") to a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
