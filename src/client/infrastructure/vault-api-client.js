import { resolveApiUrl } from '../domain/runtime-paths.js';

function encodeHeaderMetadata(value) {
  return encodeURIComponent(String(value ?? ''));
}

async function parseApiResponse(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || fallbackError);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

export class VaultApiClient {
  async readTree() {
    const response = await fetch(resolveApiUrl('/files'));
    return parseApiResponse(response, 'Failed to load file tree');
  }

  async readFile(path) {
    const response = await fetch(resolveApiUrl(`/file?path=${encodeURIComponent(path)}`));
    return parseApiResponse(response, 'Failed to read file');
  }

  async createFile({ content, path }) {
    const response = await fetch(resolveApiUrl('/file'), {
      body: JSON.stringify({ content, path }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to create file');
  }

  async renameFile({ oldPath, newPath }) {
    const response = await fetch(resolveApiUrl('/file'), {
      body: JSON.stringify({ newPath, oldPath }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    });
    return parseApiResponse(response, 'Failed to rename file');
  }

  async deleteFile(path) {
    const response = await fetch(resolveApiUrl(`/file?path=${encodeURIComponent(path)}`), {
      method: 'DELETE',
    });
    return parseApiResponse(response, 'Failed to delete file');
  }

  async createDirectory(path) {
    const response = await fetch(resolveApiUrl('/directory'), {
      body: JSON.stringify({ path }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to create folder');
  }

  async uploadImageAttachment({ file, fileName = '', sourcePath }) {
    const response = await fetch(resolveApiUrl('/attachments'), {
      body: file,
      headers: {
        'Content-Type': file?.type || 'application/octet-stream',
        'X-CollabMD-File-Name': encodeHeaderMetadata(fileName),
        'X-CollabMD-Source-Path': encodeHeaderMetadata(sourcePath),
      },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to upload image');
  }
}

export const vaultApiClient = new VaultApiClient();
