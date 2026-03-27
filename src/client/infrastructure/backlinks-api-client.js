import { resolveApiUrl } from '../domain/runtime-paths.js';

export class BacklinksApiClient {
  async readBacklinks(filePath, { signal } = {}) {
    const response = await fetch(
      resolveApiUrl(`/backlinks?file=${encodeURIComponent(filePath)}`),
      { signal },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load backlinks');
    }

    return Array.isArray(data.backlinks) ? data.backlinks : [];
  }
}

export const backlinksApiClient = new BacklinksApiClient();
