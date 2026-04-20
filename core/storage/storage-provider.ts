/**
 * Storage Provider Abstraction
 * =============================
 * Decouples persistence from Google Drive, supporting local filesystem
 * and S3-compatible object storage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export interface StorageProvider {
  save(key: string, data: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

class LocalFileProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir = join(process.cwd(), ".ouroboros", "storage")) {
    this.baseDir = baseDir;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async save(key: string, data: string): Promise<void> {
    const path = join(this.baseDir, key);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, data, "utf-8");
  }

  async get(key: string): Promise<string | null> {
    const path = join(this.baseDir, key);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }

  async delete(key: string): Promise<void> {
    const path = join(this.baseDir, key);
    if (existsSync(path)) {
      // Use dynamic import to avoid fs/promises circular issues in ESM
      const { unlink } = await import("fs/promises");
      await unlink(path);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const { readdir } = await import("fs/promises");
    const dir = join(this.baseDir, prefix);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { recursive: true, withFileTypes: false }) as string[];
    return entries;
  }
}

class S3Provider implements StorageProvider {
  private endpoint: string;
  private bucket: string;
  private accessKey: string;
  private secretKey: string;

  constructor() {
    this.endpoint = process.env.S3_ENDPOINT || "";
    this.bucket = process.env.S3_BUCKET || "ouroboros";
    this.accessKey = process.env.S3_ACCESS_KEY || "";
    this.secretKey = process.env.S3_SECRET_KEY || "";
  }

  private async fetchS3(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.endpoint}/${this.bucket}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `AWS ${this.accessKey}:${this.secretKey}`,
        ...init?.headers,
      },
    });
  }

  async save(key: string, data: string): Promise<void> {
    const res = await this.fetchS3(`/${key}`, {
      method: "PUT",
      body: data,
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`S3 save failed: ${res.status} ${res.statusText}`);
  }

  async get(key: string): Promise<string | null> {
    const res = await this.fetchS3(`/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get failed: ${res.status} ${res.statusText}`);
    return res.text();
  }

  async delete(key: string): Promise<void> {
    const res = await this.fetchS3(`/${key}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status} ${res.statusText}`);
  }

  async list(prefix: string): Promise<string[]> {
    // Simplified list using query params; real implementation would use ListObjectsV2
    const res = await this.fetchS3(`?prefix=${encodeURIComponent(prefix)}&list-type=2`);
    if (!res.ok) throw new Error(`S3 list failed: ${res.status} ${res.statusText}`);
    const xml = await res.text();
    const keys = xml.match(/<Key>([^<]+)<\/Key>/g) || [];
    return keys.map((k) => k.replace(/<\/?Key>/g, ""));
  }
}

export function getStorageProvider(type?: string): StorageProvider {
  const t = type || process.env.STORAGE_TYPE || "local";
  switch (t) {
    case "s3":
      return new S3Provider();
    case "local":
    default:
      return new LocalFileProvider();
  }
}
