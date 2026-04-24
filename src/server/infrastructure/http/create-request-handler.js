import { createAuthApiHandler } from './create-auth-api-handler.js';
import { createGitApiHandler } from './create-git-api-handler.js';
import { createEsmProxyHandler } from './create-esm-proxy-handler.js';
import { createStaticHandler } from './create-static-handler.js';
import { createVaultApiHandler } from './create-vault-api-handler.js';
import { parseJsonBody } from './request-body.js';
import {
  applyCorsHeaders,
  jsonResponse,
  SECURITY_HEADERS,
  setHeaders,
  isSameOriginWriteRequest,
  WRITE_METHODS,
} from './http-response.js';

function stripBasePath(pathname, basePath) {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath) {
    return '/';
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }

  return pathname;
}

function createRequestUrlWithPathname(requestUrl, pathname) {
  const nextUrl = new URL(requestUrl.toString());
  nextUrl.pathname = pathname || '/';
  return nextUrl;
}

export function createRequestHandler(
  config,
  authService,
  vaultFileStore,
  backlinkIndex,
  baseQueryService = null,
  docxExporter = null,
  roomRegistry = null,
  plantUmlRenderer = null,
  gitService = null,
  testControls = { wsRoomHydrateDelayMs: 0 },
  workspaceMutationCoordinator = null,
  fileSystemSyncService = null,
) {
  const handleEsmProxy = createEsmProxyHandler();
  const handleStaticRequest = createStaticHandler(config, authService);
  const handleAuthApi = createAuthApiHandler({ authService });
  const handleGitApi = createGitApiHandler({
    authService,
    backlinkIndex,
    gitService,
    roomRegistry,
    vaultFileStore,
    workspaceMutationCoordinator,
  });
  const handleVaultApi = createVaultApiHandler({
    baseQueryService,
    backlinkIndex,
    config,
    docxExporter,
    plantUmlRenderer,
    roomRegistry,
    vaultFileStore,
    workspaceMutationCoordinator,
  });

  function handleBasePathRedirect(req, res, originalRequestUrl) {
    if (
      config.basePath
      && (req.method === 'GET' || req.method === 'HEAD')
      && originalRequestUrl.pathname === config.basePath
    ) {
      const location = `${config.basePath}/${originalRequestUrl.search}`;
      res.writeHead(308, { Location: location });
      res.end();
      return true;
    }
    return false;
  }

  function handleCorsPreflight(req, res, isSameOriginWrite) {
    if (req.method !== 'OPTIONS') {
      return false;
    }

    const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
    const preflightTargetsWrite = WRITE_METHODS.has(requestedMethod);
    if (preflightTargetsWrite && !isSameOriginWrite) {
      jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
      return true;
    }

    if (isSameOriginWrite) {
      applyCorsHeaders(res, req.headers.origin);
    }

    res.writeHead(204);
    res.end();
    return true;
  }

  function handleCorsWriteGuard(req, res, isSameOriginWrite) {
    if (WRITE_METHODS.has(req.method) && !isSameOriginWrite) {
      jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
      return true;
    }
    return false;
  }

  async function handleTestEndpoints(req, res, requestUrl) {
    if (config.nodeEnv !== 'test') {
      return false;
    }

    if (requestUrl.pathname === '/api/test/reset-state' && req.method === 'POST') {
      await fileSystemSyncService?.resetForExternalStateChange?.();
      await roomRegistry?.reset?.();
      await backlinkIndex?.build?.();
      await workspaceMutationCoordinator?.initialize?.();
      await fileSystemSyncService?.resetForExternalStateChange?.();
      jsonResponse(req, res, 200, { ok: true });
      return true;
    }

    if (requestUrl.pathname === '/api/test/hydrate-delay' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(body?.delayMs) || 0);
      await fileSystemSyncService?.resetForExternalStateChange?.();
      await roomRegistry?.reset?.();
      await backlinkIndex?.build?.();
      await workspaceMutationCoordinator?.initialize?.();
      await fileSystemSyncService?.resetForExternalStateChange?.();
      jsonResponse(req, res, 200, { delayMs: testControls.wsRoomHydrateDelayMs, ok: true });
      return true;
    }

    return false;
  }

  return async function handleRequest(req, res) {
    const originalRequestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (handleBasePathRedirect(req, res, originalRequestUrl)) {
      return;
    }

    const requestUrl = createRequestUrlWithPathname(
      originalRequestUrl,
      stripBasePath(originalRequestUrl.pathname, config.basePath),
    );
    const isSameOriginWrite = isSameOriginWriteRequest(req, requestUrl);

    setHeaders(res, SECURITY_HEADERS);

    if (handleCorsPreflight(req, res, isSameOriginWrite)) {
      return;
    }

    if (handleCorsWriteGuard(req, res, isSameOriginWrite)) {
      return;
    }

    if (await handleTestEndpoints(req, res, requestUrl)) {
      return;
    }

    if (await handleAuthApi(req, res, requestUrl)) {
      return;
    }

    if (await handleEsmProxy(req, res, requestUrl)) {
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      const authorization = authService.authorizeApiRequest(req);
      if (!authorization.ok) {
        jsonResponse(req, res, authorization.statusCode, authorization.body);
        return;
      }
    }

    if (await handleVaultApi(req, res, requestUrl)) {
      return;
    }

    if (await handleGitApi(req, res, requestUrl)) {
      return;
    }

    await handleStaticRequest(req, res, requestUrl);
  };
}
