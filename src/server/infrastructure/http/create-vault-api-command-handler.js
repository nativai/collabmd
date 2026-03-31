import {
  isBaseFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';
import { createWorkspaceChange } from '../../../domain/workspace-change.js';
import { basename } from 'node:path';
import { createRequestError, getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse, sendResponse } from './http-response.js';
import { parseJsonBody, readBinaryRequestBody } from './request-body.js';

const DOCX_EXPORT_REQUEST_LIMIT_BYTES = 33_554_432;
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function encodeContentDispositionFilename(fileName) {
  return encodeURIComponent(String(fileName ?? ''))
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createSafeAsciiFilename(fileName) {
  const fallback = String(fileName ?? '')
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\]/g, '_')
    .trim();
  return fallback || 'document';
}

function createDocxDownloadHeaders(filePath) {
  const fileName = basename(String(filePath ?? 'document')).replace(/\.[^.]+$/u, '') || 'document';
  const exportFileName = `${fileName}.docx`;
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${createSafeAsciiFilename(exportFileName)}"; filename*=UTF-8''${encodeContentDispositionFilename(exportFileName)}`,
    'Content-Type': DOCX_MIME_TYPE,
    'X-Content-Type-Options': 'nosniff',
  };
}

function decodeHeaderMetadata(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    throw createRequestError(400, 'Invalid attachment metadata header encoding');
  }
}

function selectWriteOperation(vaultFileStore, filePath, content) {
  if (isExcalidrawFilePath(filePath)) {
    return vaultFileStore.writeExcalidrawFile(filePath, content);
  }

  if (isBaseFilePath(filePath)) {
    return vaultFileStore.writeBaseFile(filePath, content);
  }

  if (isDrawioFilePath(filePath)) {
    return vaultFileStore.writeDrawioFile(filePath, content);
  }

  if (isMermaidFilePath(filePath)) {
    return vaultFileStore.writeMermaidFile(filePath, content);
  }

  if (isPlantUmlFilePath(filePath)) {
    return vaultFileStore.writePlantUmlFile(filePath, content);
  }

  return vaultFileStore.writeMarkdownFile(filePath, content);
}

function readRequestId(req) {
  const value = String(req.headers['x-collabmd-request-id'] || '').trim();
  return value ? value.slice(0, 120) : null;
}

function handleVaultError(req, res, error, logMessage, fallbackMessage) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    jsonResponse(req, res, statusCode, { error: error.message });
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, 500, { error: fallbackMessage });
  return true;
}

function getDirectoryDeleteStatusCode(message = '') {
  return String(message).includes('Directory is not empty') ? 409 : 400;
}

async function handleExportDocx({ docxExporter }, req, res) {
  try {
    const body = await parseJsonBody(req, DOCX_EXPORT_REQUEST_LIMIT_BYTES);
    if (!body?.filePath || typeof body?.html !== 'string') {
      jsonResponse(req, res, 400, { error: 'Missing filePath or html' });
      return true;
    }

    if (!docxExporter?.render) {
      jsonResponse(req, res, 503, { error: 'DOCX export is unavailable' });
      return true;
    }

    const docxBuffer = await docxExporter.render({
      html: body.html,
      title: body.title || '',
    });

    sendResponse(req, res, {
      body: docxBuffer,
      headers: createDocxDownloadHeaders(body.filePath),
      statusCode: 200,
    });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to export DOCX:', 'Failed to export DOCX');
  }
  return true;
}

async function handleWriteFile({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path || typeof body.content !== 'string') {
      jsonResponse(req, res, 400, { error: 'Missing path or content' });
      return true;
    }

    const result = await selectWriteOperation(vaultFileStore, body.path, body.content);
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }

    await workspaceMutationCoordinator?.apply?.({
      action: 'write-file',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        changedPaths: [body.path],
      }),
    });

    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to write file:', 'Failed to write file');
  }
  return true;
}

async function handleUploadAttachment({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const sourceDocumentPath = decodeHeaderMetadata(req.headers['x-collabmd-source-path']);
    const originalFileName = decodeHeaderMetadata(req.headers['x-collabmd-file-name']);
    const mimeType = String(req.headers['content-type'] || '').trim();

    if (!sourceDocumentPath) {
      jsonResponse(req, res, 400, { error: 'Missing source document path' });
      return true;
    }

    const content = await readBinaryRequestBody(req);
    const result = await vaultFileStore.writeImageAttachmentForDocument(sourceDocumentPath, {
      content,
      mimeType,
      originalFileName,
    });
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }

    await workspaceMutationCoordinator?.apply?.({
      action: 'upload-attachment',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        changedPaths: [result.path],
      }),
    });

    jsonResponse(req, res, 201, {
      markdown: result.markdownSnippet,
      ok: true,
      path: result.path,
    });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to upload attachment:', 'Failed to upload attachment');
  }
  return true;
}

async function handleCreateFile({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path) {
      jsonResponse(req, res, 400, { error: 'Missing path' });
      return true;
    }

    const result = await vaultFileStore.createFile(body.path, body.content || '');
    if (!result.ok) {
      jsonResponse(req, res, 409, { error: result.error });
      return true;
    }
    await workspaceMutationCoordinator?.apply?.({
      action: 'create-file',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        changedPaths: [body.path],
      }),
    });
    jsonResponse(req, res, 201, { ok: true, path: body.path });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to create file:', 'Failed to create file');
  }
  return true;
}

async function handleDeleteFile({ vaultFileStore, workspaceMutationCoordinator }, req, res, requestUrl) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }

  try {
    const result = await vaultFileStore.deleteFile(filePath);
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }
    await workspaceMutationCoordinator?.apply?.({
      action: 'delete-file',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        deletedPaths: [filePath],
      }),
    });
    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    console.error('[api] Failed to delete file:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to delete file' });
  }
  return true;
}

async function handleRenameFile({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.oldPath || !body.newPath) {
      jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
      return true;
    }

    const result = await vaultFileStore.renameFile(body.oldPath, body.newPath);
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }
    await workspaceMutationCoordinator?.apply?.({
      action: 'rename-file',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        renamedPaths: [{ oldPath: body.oldPath, newPath: body.newPath }],
      }),
    });
    jsonResponse(req, res, 200, { ok: true, path: body.newPath });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to rename file:', 'Failed to rename file');
  }
  return true;
}

async function handleCreateDirectory({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path) {
      jsonResponse(req, res, 400, { error: 'Missing path' });
      return true;
    }

    const result = await vaultFileStore.createDirectory(body.path);
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }

    await workspaceMutationCoordinator?.apply?.({
      action: 'create-directory',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: createWorkspaceChange({
        changedPaths: [body.path],
      }),
    });

    jsonResponse(req, res, 201, { ok: true });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to create directory:', 'Failed to create directory');
  }
  return true;
}

async function handleRenameDirectory({ vaultFileStore, workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.oldPath || !body.newPath) {
      jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
      return true;
    }

    const workspaceChange = await workspaceMutationCoordinator?.createDirectoryRenameWorkspaceChange?.(body.oldPath, body.newPath);
    const result = await vaultFileStore.renameDirectory(body.oldPath, body.newPath);
    if (!result.ok) {
      jsonResponse(req, res, 400, { error: result.error });
      return true;
    }

    await workspaceMutationCoordinator?.apply?.({
      action: 'rename-directory',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: workspaceChange ?? {
        renamedPaths: [{ oldPath: body.oldPath, newPath: body.newPath }],
      },
    });

    jsonResponse(req, res, 200, { ok: true, path: body.newPath });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to rename directory:', 'Failed to rename directory');
  }
  return true;
}

async function handleDeleteDirectory({ vaultFileStore, workspaceMutationCoordinator }, req, res, requestUrl) {
  const dirPath = requestUrl.searchParams.get('path');
  const recursive = requestUrl.searchParams.get('recursive') === '1';
  if (!dirPath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }

  try {
    const workspaceChange = await workspaceMutationCoordinator?.createDirectoryDeleteWorkspaceChange?.(dirPath);
    const result = await vaultFileStore.deleteDirectory(dirPath, { recursive });
    if (!result.ok) {
      jsonResponse(req, res, getDirectoryDeleteStatusCode(result.error), { error: result.error });
      return true;
    }

    await workspaceMutationCoordinator?.apply?.({
      action: 'delete-directory',
      origin: 'api',
      requestId: readRequestId(req),
      workspaceChange: workspaceChange ?? {
        deletedPaths: [dirPath],
      },
    });

    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    handleVaultError(req, res, error, '[api] Failed to delete directory:', 'Failed to delete directory');
  }
  return true;
}

const ROUTE_TABLE = [
  { method: 'POST', path: '/api/export/docx', handler: handleExportDocx },
  { method: 'PUT', path: '/api/file', handler: handleWriteFile },
  { method: 'POST', path: '/api/attachments', handler: handleUploadAttachment },
  { method: 'POST', path: '/api/file', handler: handleCreateFile },
  { method: 'DELETE', path: '/api/file', handler: handleDeleteFile },
  { method: 'PATCH', path: '/api/file', handler: handleRenameFile },
  { method: 'POST', path: '/api/directory', handler: handleCreateDirectory },
  { method: 'PATCH', path: '/api/directory', handler: handleRenameDirectory },
  { method: 'DELETE', path: '/api/directory', handler: handleDeleteDirectory },
];

export function createVaultApiCommandHandler({
  docxExporter = null,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const context = { docxExporter, vaultFileStore, workspaceMutationCoordinator };

  return async function handleVaultApiCommand(req, res, requestUrl) {
    for (const route of ROUTE_TABLE) {
      if (requestUrl.pathname === route.path && req.method === route.method) {
        return route.handler(context, req, res, requestUrl);
      }
    }
    return false;
  };
}
