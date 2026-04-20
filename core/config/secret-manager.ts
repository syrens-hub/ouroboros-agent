/**
 * Secret Manager
 * ==============
 * Abstracts secret retrieval from environment variables and external vaults.
 * Supports HashiCorp Vault and local env fallback.
 */

export interface SecretManager {
  get(key: string): Promise<string | undefined>;
}

class EnvSecretManager implements SecretManager {
  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }
}

class VaultSecretManager implements SecretManager {
  private endpoint: string;
  private token: string;
  private mountPath: string;

  constructor() {
    this.endpoint = process.env.VAULT_ADDR || "http://localhost:8200";
    this.token = process.env.VAULT_TOKEN || "";
    this.mountPath = process.env.VAULT_MOUNT_PATH || "secret";
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.token) return undefined;
    try {
      const res = await fetch(`${this.endpoint}/v1/${this.mountPath}/data/ouroboros/${key}`, {
        headers: { "X-Vault-Token": this.token },
      });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { data?: { data?: Record<string, string> } };
      return data.data?.data?.value;
    } catch {
      return undefined;
    }
  }
}

let secretManager: SecretManager | undefined;

export function getSecretManager(): SecretManager {
  if (!secretManager) {
    const backend = process.env.SECRET_BACKEND || "env";
    secretManager = backend === "vault" ? new VaultSecretManager() : new EnvSecretManager();
  }
  return secretManager;
}

export async function getSecret(key: string): Promise<string | undefined> {
  return getSecretManager().get(key);
}

export function resetSecretManager(): void {
  secretManager = undefined;
}
