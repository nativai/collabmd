import { createServer } from 'http';

import { loadConfig } from './config/env.js';
import { createAuthService } from './auth/create-auth-service.js';
import { logPerfEvent } from './config/perf-logging.js';
import { BacklinkIndex } from './domain/backlink-index.js';
import { BaseQueryService } from './domain/bases/base-query-service.js';
import { CollaborationDocumentStore } from './domain/collaboration/collaboration-document-store.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
import { DocxExporter } from './domain/docx-exporter.js';
import { GitService } from './infrastructure/git/git-service.js';
import { PlantUmlRenderer } from './infrastructure/plantuml/plantuml-renderer.js';
import { RoomRegistry } from './domain/collaboration/room-registry.js';
import { createRequestHandler } from './infrastructure/http/create-request-handler.js';
import { VaultFileStore } from './infrastructure/persistence/vault-file-store.js';
import { attachCollaborationGateway } from './infrastructure/websocket/attach-collaboration-gateway.js';
import { isDrawioLeaseRoom } from '../domain/drawio-room.js';
import { WORKSPACE_ROOM_NAME } from '../domain/workspace-room.js';
import { FileSystemSyncService } from './infrastructure/workspace/file-system-sync-service.js';
import { WorkspaceMutationCoordinator } from './infrastructure/workspace/workspace-mutation-coordinator.js';

function getDisplayHost(host) {
  return host === '127.0.0.1' ? 'localhost' : host;
}

function closeHttpServer(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections();
    }
  });
}

function workspaceStateMetadataEqual(left = null, right = null) {
  const leftMetadata = left?.metadata;
  const rightMetadata = right?.metadata;
  if (!(leftMetadata instanceof Map) || !(rightMetadata instanceof Map)) {
    return false;
  }

  if (leftMetadata.size !== rightMetadata.size) {
    return false;
  }

  for (const [pathValue, leftEntry] of leftMetadata.entries()) {
    const rightEntry = rightMetadata.get(pathValue);
    if (!rightEntry) {
      return false;
    }

    if (
      leftEntry.type !== rightEntry.type
      || leftEntry.size !== rightEntry.size
      || leftEntry.inode !== rightEntry.inode
      || leftEntry.mtimeMs !== rightEntry.mtimeMs
    ) {
      return false;
    }
  }

  return true;
}

export function createAppServer(config = loadConfig()) {
  const authService = createAuthService(config);
  const vaultFileStore = new VaultFileStore({ vaultDir: config.vaultDir });
  const backlinkIndex = new BacklinkIndex({ vaultFileStore });
  let fileSystemSyncService = null;
  let workspaceMutationCoordinator = null;
  const baseQueryService = new BaseQueryService({
    maxResultRows: config.maxBaseQueryRows,
    vaultFileStore,
    workspaceStateProvider: () => workspaceMutationCoordinator?.workspaceState ?? null,
    workspaceStateSynchronizer: () => fileSystemSyncService?.flushPendingChanges?.(),
  });
  const docxExporter = new DocxExporter();
  const plantUmlRenderer = new PlantUmlRenderer({
    serverUrl: config.plantumlServerUrl,
  });
  const gitService = new GitService({
    commandEnv: config.git?.commandEnv,
    enabled: config.gitEnabled,
    vaultDir: config.vaultDir,
  });
  const testControls = {
    wsRoomHydrateDelayMs: Math.max(0, Number(config.testWsRoomHydrateDelayMs || 0)),
  };
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => {
      const isTransientRoom = name === '__lobby__' || name === WORKSPACE_ROOM_NAME || isDrawioLeaseRoom(name);
      const room = new CollaborationRoom({
        documentStore: new CollaborationDocumentStore({
          backlinkIndex: isTransientRoom ? null : backlinkIndex,
          name,
          vaultFileStore: isTransientRoom ? null : vaultFileStore,
        }),
        getHydrateDelayMs: () => testControls.wsRoomHydrateDelayMs,
        idleGraceMs: config.wsRoomIdleGraceMs,
        maxInitialSyncBytes: config.maxInitialSyncBytes,
        maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
        name,
        onEmpty,
        perfLoggingEnabled: config.perfLoggingEnabled,
      });

      if (name === WORKSPACE_ROOM_NAME && workspaceMutationCoordinator?.workspaceState) {
        room.replaceWorkspaceEntries(workspaceMutationCoordinator.workspaceState.entries, {
          generatedAt: workspaceMutationCoordinator.workspaceState.scannedAt,
        });
      }

      return room;
    },
  });
  workspaceMutationCoordinator = new WorkspaceMutationCoordinator({
    backlinkIndex,
    baseQueryService,
    roomRegistry,
    vaultFileStore,
  });
  vaultFileStore.setManagedWriteTracker(workspaceMutationCoordinator);
  fileSystemSyncService = new FileSystemSyncService({
    mutationCoordinator: workspaceMutationCoordinator,
    perfLoggingEnabled: config.perfLoggingEnabled,
    vaultFileStore,
  });
  const requestHandler = createRequestHandler(
    config,
    authService,
    vaultFileStore,
    backlinkIndex,
    baseQueryService,
    docxExporter,
    roomRegistry,
    plantUmlRenderer,
    gitService,
    testControls,
    workspaceMutationCoordinator,
    fileSystemSyncService,
  );
  const httpServer = createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[http] Unhandled request error:', error.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
  });
  httpServer.headersTimeout = config.httpHeadersTimeoutMs;
  httpServer.keepAliveTimeout = config.httpKeepAliveTimeoutMs;
  httpServer.requestTimeout = config.httpRequestTimeoutMs;
  const collaborationGateway = attachCollaborationGateway({
    authService,
    basePath: config.basePath,
    heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
    maxPayload: config.wsMaxPayloadBytes,
    httpServer,
    roomRegistry,
    wsBasePath: config.wsBasePath,
  });

  let shutdownPromise = null;
  let vaultFileCount = 0;

  async function listen() {
    const startupStartedAt = Date.now();

    const initialWorkspaceScanStartedAt = Date.now();
    const initialWorkspaceSnapshot = await vaultFileStore.scanWorkspaceState();
    vaultFileCount = initialWorkspaceSnapshot.vaultFileCount ?? 0;
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - initialWorkspaceScanStartedAt,
      phase: 'workspace-scan',
      vaultFileCount,
    });

    const backlinkBuildStartedAt = Date.now();
    await backlinkIndex.build({ workspaceState: initialWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - backlinkBuildStartedAt,
      markdownFileCount: initialWorkspaceSnapshot.markdownPaths?.length ?? 0,
      phase: 'backlink-build',
    });

    const liveWorkspaceScanStartedAt = Date.now();
    const liveWorkspaceSnapshot = await vaultFileStore.scanWorkspaceState();
    const workspaceChangedDuringStartup = !workspaceStateMetadataEqual(initialWorkspaceSnapshot, liveWorkspaceSnapshot);
    vaultFileCount = liveWorkspaceSnapshot.vaultFileCount ?? vaultFileCount;
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      changedDuringStartup: workspaceChangedDuringStartup,
      durationMs: Date.now() - liveWorkspaceScanStartedAt,
      phase: 'workspace-rescan',
      vaultFileCount,
    });

    if (workspaceChangedDuringStartup) {
      const backlinkRebuildStartedAt = Date.now();
      await backlinkIndex.build({ workspaceState: liveWorkspaceSnapshot });
      logPerfEvent(config.perfLoggingEnabled, 'startup', {
        durationMs: Date.now() - backlinkRebuildStartedAt,
        markdownFileCount: liveWorkspaceSnapshot.markdownPaths?.length ?? 0,
        phase: 'backlink-rebuild',
      });
    }

    const workspaceInitStartedAt = Date.now();
    await workspaceMutationCoordinator.initialize({ snapshot: liveWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - workspaceInitStartedAt,
      phase: 'workspace-init',
    });

    const watcherStartStartedAt = Date.now();
    await fileSystemSyncService.start({ snapshot: liveWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - watcherStartStartedAt,
      phase: 'watcher-start',
    });

    return new Promise((resolve, reject) => {
      const listenStartedAt = Date.now();
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        const result = {
          address,
          host: getDisplayHost(config.host),
          port: typeof address === 'object' && address ? address.port : config.port,
          wsPath: `${config.basePath || ''}${config.wsBasePath}/:file`,
        };
        logPerfEvent(config.perfLoggingEnabled, 'startup', {
          durationMs: Date.now() - listenStartedAt,
          phase: 'listen',
          port: result.port,
        });
        logPerfEvent(config.perfLoggingEnabled, 'startup-total', {
          durationMs: Date.now() - startupStartedAt,
          markdownFileCount: liveWorkspaceSnapshot.markdownPaths?.length ?? 0,
          vaultFileCount,
        });
        resolve({
          ...result,
        });
      });
    });
  }

  async function close() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      await collaborationGateway.close();
      await fileSystemSyncService.close();
      await roomRegistry.reset();
      await Promise.all([
        closeHttpServer(httpServer),
        config.git?.cleanup?.(),
      ]);
    })().then(() => undefined);

    return shutdownPromise;
  }

  return {
    close,
    collaborationGateway,
    config,
    httpServer,
    listen,
    roomRegistry,
    workspaceMutationCoordinator,
    authService,
    backlinkIndex,
    fileSystemSyncService,
    gitService,
    setTestHydrateDelayMs(delayMs = 0) {
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(delayMs) || 0);
    },
    vaultFileStore,
    get vaultFileCount() { return vaultFileCount; },
  };
}
