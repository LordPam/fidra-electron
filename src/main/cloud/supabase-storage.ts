/**
 * Supabase Storage client for attachment file upload/download.
 *
 * Uses the Supabase Storage REST API directly (no SDK dependency).
 * Port of Python's cloud_attachments.py SupabaseStorageProvider.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CloudServerConfig } from '../../shared/ipc-types';

export class SupabaseStorage {
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private readonly bucket: string;

  constructor(config: CloudServerConfig) {
    if (!config.storageUrl || !config.storageKey) {
      throw new Error('Supabase storage URL and key are required');
    }
    // Ensure no trailing slash
    this.baseUrl = config.storageUrl.replace(/\/+$/, '');
    this.anonKey = config.storageKey;
    this.bucket = config.storageBucket || 'attachments';
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.anonKey}`,
      apikey: this.anonKey,
    };
  }

  /**
   * Upload a file to Supabase Storage.
   * Uses x-upsert to allow overwriting existing files.
   */
  async upload(storedName: string, filePath: string, mimeType?: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);

    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${this.bucket}/${storedName}`,
      {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': mimeType || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: fileBuffer,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Storage upload failed (${response.status}): ${text}`);
    }
  }

  /**
   * Download a file from Supabase Storage to a local path.
   */
  async download(storedName: string, destPath: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/authenticated/${this.bucket}/${storedName}`,
      {
        method: 'GET',
        headers: this.headers,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Storage download failed (${response.status}): ${text}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, buffer);
  }

  /**
   * Delete a file from Supabase Storage.
   * Tolerates 404 (already gone) and 400 errors gracefully.
   */
  async remove(storedName: string): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${this.bucket}`,
      {
        method: 'DELETE',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: [storedName] }),
      },
    );

    if (response.status === 404 || response.status === 400) {
      return true; // Already gone or bad request — not a failure
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Storage delete failed (${response.status}): ${text}`);
    }

    return true;
  }

  /**
   * Check if storage is configured and accessible.
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/storage/v1/bucket/${this.bucket}`,
        {
          method: 'GET',
          headers: this.headers,
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────

let _storage: SupabaseStorage | null = null;

export function getSupabaseStorage(): SupabaseStorage | null {
  return _storage;
}

export function setSupabaseStorage(storage: SupabaseStorage | null): void {
  _storage = storage;
}

export function isStorageConfigured(config: CloudServerConfig): boolean {
  return !!(config.storageUrl && config.storageKey);
}
