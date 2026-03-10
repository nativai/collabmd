import {
  isExcalidrawFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';
import { jsonResponse } from './http-response.js';

function selectReadOperation(vaultFileStore, filePath) {
  if (isExcalidrawFilePath(filePath)) {
    return vaultFileStore.readExcalidrawFile(filePath);
  }

  if (isMermaidFilePath(filePath)) {
    return vaultFileStore.readMermaidFile(filePath);
  }

  if (isPlantUmlFilePath(filePath)) {
    return vaultFileStore.readPlantUmlFile(filePath);
  }

  return vaultFileStore.readMarkdownFile(filePath);
}

export function createVaultApiQueryHandler({
  backlinkIndex,
  vaultFileStore,
}) {
  return async function handleVaultApiQuery(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/files' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, { tree: await vaultFileStore.tree() });
      } catch (error) {
        console.error('[api] Failed to read file tree:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to read file tree' });
      }
      return true;
    }

    if (requestUrl.pathname === '/api/file' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing path parameter' });
        return true;
      }

      try {
        const content = await selectReadOperation(vaultFileStore, filePath);
        if (content === null) {
          jsonResponse(req, res, 404, { error: 'File not found' });
          return true;
        }

        jsonResponse(req, res, 200, { path: filePath, content });
      } catch (error) {
        console.error('[api] Failed to read file:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to read file' });
      }
      return true;
    }

    if (requestUrl.pathname === '/api/backlinks' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('file');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing file parameter' });
        return true;
      }

      try {
        jsonResponse(req, res, 200, {
          backlinks: backlinkIndex ? await backlinkIndex.getBacklinks(filePath) : [],
          file: filePath,
        });
      } catch (error) {
        console.error('[api] Failed to get backlinks:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to get backlinks' });
      }
      return true;
    }

    return false;
  };
}
