// ============================================================================
// MCP Types
// ============================================================================

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ============================================================================
// StateGraph Types
// ============================================================================

export interface Checkpoint<TState> {
  nodeId: string;
  state: TState;
  visited: string[];
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookRegistration {
  id: string;
  path: string;
  secret: string;
  eventType: string;
  targetSessionId?: string;
  enabled: boolean;
}
