/**
 * Minimal type declarations for @modelcontextprotocol/sdk
 * Keeps tsc --noEmit happy when the optional dependency is absent.
 */

declare module "@modelcontextprotocol/sdk" {
  export class ClientSession {
    constructor(transport: unknown);
    initialize(): Promise<void>;
    tools: {
      list(): Promise<{ tools: unknown[] }>;
      call(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
    };
  }

  export class StdioClientTransport {
    constructor(params: unknown);
    close(): Promise<void>;
  }

  export class StdioServerParameters {
    constructor(params: { command: string; args?: string[]; env?: Record<string, string> });
  }

  export class SSEClientTransport {
    constructor(url: URL, opts?: { headers?: Record<string, string> });
    close(): Promise<void>;
  }

  export class StreamableHTTPClientTransport {
    constructor(url: URL, opts?: { headers?: Record<string, string> });
    close(): Promise<void>;
  }
}
