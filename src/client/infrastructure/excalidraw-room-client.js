import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  EXCALIDRAW_APP_STATE_KEY,
  EXCALIDRAW_ELEMENTS_KEY,
  EXCALIDRAW_FILES_KEY,
  EXCALIDRAW_META_KEY,
  applySceneDiffToExcalidrawRoom,
  buildExcalidrawRoomScene,
  ensureExcalidrawRoomSchema,
  isExcalidrawRoomDocStructured,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
} from '../../domain/excalidraw-room-codec.js';

import {
  buildCollaboratorsMap,
  mergeAwarenessUserPatch,
} from '../domain/excalidraw-collaboration.js';
import {
  buildLiveCollaborationScene,
  createEmptyScene,
  parseSceneJson,
  tryParseSceneJson,
} from '../domain/excalidraw-scene.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';

const DEFAULT_HISTORY_ARRAY_KEY = 'excalidraw-history';
const DEFAULT_HISTORY_CAPTURE_WINDOW_MS = 500;
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_STATE_KEY = 'excalidraw-history-state';
const DEFAULT_EMPTY_SCENE_GUARD_MS = 250;
const DEFAULT_SAVE_THROTTLE_MS = 48;
const DEFAULT_SYNC_TIMEOUT_MS = 4000;
const HISTORY_HEAD_KEY = 'head';

export class ExcalidrawRoomClient {
  constructor({
    cancelAnimationFrameFn = (frameId) => cancelAnimationFrame(frameId),
    clearTimeoutFn = (timeoutId) => clearTimeout(timeoutId),
    emptySceneGuardMs = DEFAULT_EMPTY_SCENE_GUARD_MS,
    filePath = '',
    historyArrayKey = DEFAULT_HISTORY_ARRAY_KEY,
    historyCaptureWindowMs = DEFAULT_HISTORY_CAPTURE_WINDOW_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    historyStateKey = DEFAULT_HISTORY_STATE_KEY,
    now = () => Date.now(),
    onCollaboratorsChange = () => {},
    onHistoryStateChange = () => {},
    onRemoteSceneJson = () => {},
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    resolveWsBaseUrlFn = resolveWsBaseUrl,
    saveThrottleMs = DEFAULT_SAVE_THROTTLE_MS,
    setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    vaultClient,
    websocketProviderFactory = (wsUrl, path, ydoc, options) => new WebsocketProvider(wsUrl, path, ydoc, options),
    ydocFactory = () => new Doc(),
  }) {
    this.cancelAnimationFrameFn = cancelAnimationFrameFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.emptySceneGuardMs = emptySceneGuardMs;
    this.filePath = filePath;
    this.historyArrayKey = historyArrayKey;
    this.historyCaptureWindowMs = historyCaptureWindowMs;
    this.historyLimit = historyLimit;
    this.historyStateKey = historyStateKey;
    this.now = now;
    this.onCollaboratorsChange = onCollaboratorsChange;
    this.onHistoryStateChange = onHistoryStateChange;
    this.onRemoteSceneJson = onRemoteSceneJson;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.resolveWsBaseUrlFn = resolveWsBaseUrlFn;
    this.saveThrottleMs = saveThrottleMs;
    this.setTimeoutFn = setTimeoutFn;
    this.syncTimeoutMs = syncTimeoutMs;
    this.vaultClient = vaultClient;
    this.websocketProviderFactory = websocketProviderFactory;
    this.ydocFactory = ydocFactory;
    this.ydoc = null;
    this.historySnapshots = null;
    this.historyState = null;
    this.roomMeta = null;
    this.roomElements = null;
    this.roomFiles = null;
    this.roomAppState = null;
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.handleProviderSync = null;
    this.lastSceneJson = '';
    this.sceneSyncTimer = null;
    this.lastSceneSyncAt = 0;
    this.pendingSceneSyncPayload = null;
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    this.viewportAwarenessFrame = 0;
    this.pendingViewportPayload = null;
    this.lastViewportSignature = '';
    this.lastSelectedIdsSignature = '';
    this.pendingEmptySceneCandidate = null;
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
    this.applyingSharedSnapshotDepth = 0;
    this.historySubscribers = new Set();
    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;

    this.handleAwarenessChange = () => {
      this.onCollaboratorsChange(buildCollaboratorsMap(this.awareness));
    };

    this.handleSharedHistoryUpdate = () => {
      this.handleRoomHistoryUpdate();
    };

    this.handleStructuredSceneUpdate = () => {
      if (!this.ydoc) {
        return;
      }

      const remoteJson = this.getStructuredSceneJson();
      if (!remoteJson || remoteJson === this.lastSceneJson) {
        return;
      }

      this.unlockRoomWrites();
      this.pendingEmptySceneCandidate = null;
      this.lastSceneJson = JSON.stringify(parseSceneJson(remoteJson));
      this.onRemoteSceneJson(this.lastSceneJson);
    };
  }

  getLastSceneJson() {
    return this.lastSceneJson;
  }

  getLocalUser() {
    return this.localUser;
  }

  getHistoryState() {
    const length = this.getSharedHistoryLength();
    const head = this.getResolvedHistoryHead();
    return {
      canRedo: head >= 0 && head < length - 1,
      canUndo: head > 0,
      head,
      length,
    };
  }

  canRedo() {
    return this.getHistoryState().canRedo;
  }

  canUndo() {
    return this.getHistoryState().canUndo;
  }

  isApplyingSharedSnapshot() {
    return this.applyingSharedSnapshotDepth > 0;
  }

  beginApplyingSharedSnapshot() {
    this.applyingSharedSnapshotDepth += 1;
  }

  endApplyingSharedSnapshot() {
    this.applyingSharedSnapshotDepth = Math.max(0, this.applyingSharedSnapshotDepth - 1);
  }

  subscribeHistoryState(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.historySubscribers.add(listener);
    listener(this.getHistoryState());
    return () => {
      this.historySubscribers.delete(listener);
    };
  }

  setLocalUser(nextUser = {}) {
    this.localUser = mergeAwarenessUserPatch({
      currentUser: this.localUser,
      nextUser,
    });

    if (this.awareness) {
      this.awareness.setLocalStateField('user', this.localUser);
    }

    this.handleAwarenessChange();
    return this.localUser;
  }

  async connect({ initialUser = null } = {}) {
    this.localUser = initialUser;

    if (!this.filePath) {
      const scene = createEmptyScene();
      this.lastSceneJson = JSON.stringify(scene);
      return scene;
    }

    this.ydoc = this.ydocFactory();
    this.historySnapshots = this.ydoc.getArray(this.historyArrayKey);
    this.historyState = this.ydoc.getMap(this.historyStateKey);
    this.roomMeta = this.ydoc.getMap(EXCALIDRAW_META_KEY);
    this.roomElements = this.ydoc.getMap(EXCALIDRAW_ELEMENTS_KEY);
    this.roomFiles = this.ydoc.getMap(EXCALIDRAW_FILES_KEY);
    this.roomAppState = this.ydoc.getMap(EXCALIDRAW_APP_STATE_KEY);
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), this.filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });

    this.awareness = this.provider.awareness;
    if (this.localUser) {
      this.awareness.setLocalStateField('user', this.localUser);
    }
    this.awareness.setLocalStateField('pointerButton', 'up');
    this.awareness.setLocalStateField('selectedElementIds', {});
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleProviderSync = (isSynced) => {
      if (!isSynced) {
        return;
      }

      this.unlockRoomWrites();
      this.handleStructuredSceneUpdate();
    };
    this.provider.on('sync', this.handleProviderSync);

    const didInitialSyncFinish = await this.waitForSync(this.provider, this.syncTimeoutMs);

    let initialJson = this.getStructuredSceneJson();
    let usedApiFallback = false;
    if (!initialJson) {
      const sceneFromApi = await this.loadSceneFromApi();
      const syncedJson = this.getStructuredSceneJson();
      if (syncedJson) {
        initialJson = syncedJson;
      } else {
        initialJson = JSON.stringify(sceneFromApi);
        usedApiFallback = true;
      }
    }

    if (!initialJson) {
      initialJson = JSON.stringify(createEmptyScene());
    }

    this.waitingForAuthoritativeSync = usedApiFallback && !didInitialSyncFinish;
    this.canWriteToRoom = !this.waitingForAuthoritativeSync;
    this.lastSceneJson = JSON.stringify(parseSceneJson(initialJson));
    if (!usedApiFallback && this.canWriteToRoom && !isExcalidrawRoomDocStructured(this.ydoc)) {
      this.ydoc.transact(() => {
        this.replaceStructuredSceneWithinTransaction(this.lastSceneJson);
      }, 'excalidraw-legacy-migrate');
    }
    this.historySnapshots.observe(this.handleSharedHistoryUpdate);
    this.historyState.observe(this.handleSharedHistoryUpdate);
    this.roomMeta.observe(this.handleStructuredSceneUpdate);
    this.roomElements.observeDeep(this.handleStructuredSceneUpdate);
    this.roomFiles.observeDeep(this.handleStructuredSceneUpdate);
    this.roomAppState.observe(this.handleStructuredSceneUpdate);
    if (usedApiFallback && this.canWriteToRoom) {
      this.commitSceneJson(this.lastSceneJson, {
        allowCoalesce: false,
        origin: 'excalidraw-api-fallback',
      });
    } else {
      this.ensureSharedHistoryInitialized(this.lastSceneJson);
    }
    this.handleRoomHistoryUpdate();
    this.handleStructuredSceneUpdate();
    this.handleAwarenessChange();

    return parseSceneJson(this.lastSceneJson);
  }

  async loadSceneFromApi({ createIfMissing = true } = {}) {
    if (!this.filePath) {
      return createEmptyScene();
    }

    try {
      const data = await this.vaultClient.readFile(this.filePath);
      return parseSceneJson(data.content);
    } catch (readError) {
      if (readError?.status !== 404 || !createIfMissing) {
        if (readError?.status === 404) {
          throw new Error(readError.message || 'Excalidraw file not found');
        }

        throw new Error(readError?.message || 'Failed to load Excalidraw file');
      }
    }

    const emptyScene = createEmptyScene();
    try {
      await this.vaultClient.createFile({
        content: JSON.stringify(emptyScene),
        path: this.filePath,
      });
      return emptyScene;
    } catch (createError) {
      if (createError?.status === 409) {
        try {
          const existingData = await this.vaultClient.readFile(this.filePath);
          return parseSceneJson(existingData.content);
        } catch (conflictReadError) {
          throw new Error(conflictReadError?.message || 'Failed to load existing Excalidraw file after create conflict');
        }
      }

      throw new Error(createError?.message || 'Failed to create Excalidraw file');
    }
  }

  waitForSync(providerInstance, timeoutMs = DEFAULT_SYNC_TIMEOUT_MS) {
    if (providerInstance.synced) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;

      const handleSync = (isSynced) => {
        if (!isSynced || settled) {
          return;
        }

        settled = true;
        this.clearTimeoutFn(timer);
        providerInstance.off('sync', handleSync);
        resolve(true);
      };

      const timer = this.setTimeoutFn(() => {
        if (settled) {
          return;
        }

        settled = true;
        providerInstance.off('sync', handleSync);
        resolve(false);
      }, timeoutMs);

      providerInstance.on('sync', handleSync);
    });
  }

  unlockRoomWrites() {
    this.waitingForAuthoritativeSync = false;
    this.canWriteToRoom = true;
    if (!this.getStructuredSceneJson() && this.lastSceneJson) {
      this.commitSceneJson(this.lastSceneJson, {
        allowCoalesce: false,
        origin: 'excalidraw-authoritative-seed',
      });
      return;
    }

    this.ensureSharedHistoryInitialized(this.lastSceneJson);

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  getStructuredSceneJson() {
    if (!this.ydoc) {
      return '';
    }

    if (isExcalidrawRoomDocStructured(this.ydoc)) {
      return JSON.stringify(buildExcalidrawRoomScene(this.ydoc));
    }

    const legacyScene = readLegacyExcalidrawRoomScene(this.ydoc);
    return legacyScene ? JSON.stringify(legacyScene) : '';
  }

  replaceStructuredSceneWithinTransaction(nextJson) {
    if (!this.ydoc) {
      return;
    }

    const nextScene = tryParseSceneJson(nextJson);
    if (!nextScene) {
      return;
    }

    ensureExcalidrawRoomSchema(this.ydoc);
    replaceExcalidrawRoomScene(this.ydoc, nextScene);
  }

  scheduleSceneSync(elements, appState, files) {
    this.pendingSceneSyncPayload = { appState, elements, files };
    if (!this.canWriteToRoom) {
      return;
    }

    this.scheduleSceneSyncFlush();
  }

  scheduleSceneSyncFlush() {
    if (this.sceneSyncTimer !== null) {
      return;
    }

    const elapsed = this.now() - this.lastSceneSyncAt;
    const delay = Math.max(0, this.saveThrottleMs - elapsed);
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.flushSceneSync();
    }, delay);
  }

  flushSceneSync() {
    if (!this.ydoc || !this.pendingSceneSyncPayload) {
      return;
    }

    const { elements, appState, files } = this.pendingSceneSyncPayload;
    this.pendingSceneSyncPayload = null;

    const sceneData = buildLiveCollaborationScene(elements, appState, files);
    const json = JSON.stringify(sceneData);
    if (this.shouldDelayEmptySceneCommit(json)) {
      this.pendingSceneSyncPayload = { appState, elements, files };
      this.scheduleDelayedEmptySceneCommit();
      return;
    }

    if (json !== this.lastSceneJson || this.getSharedHistoryLength() === 0) {
      this.lastSceneSyncAt = this.now();
      this.commitSceneJson(json, {
        allowCoalesce: true,
        captureTime: this.lastSceneSyncAt,
        origin: 'excalidraw-local-change',
      });
    }

    this.pendingEmptySceneCandidate = null;

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  hasRemoteCollaborators() {
    if (!this.awareness) {
      return false;
    }

    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId !== this.awareness.clientID && state?.user) {
        return true;
      }
    }

    return false;
  }

  shouldDelayEmptySceneCommit(nextJson) {
    if (!this.emptySceneGuardMs || !this.hasRemoteCollaborators()) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const nextScene = parseSceneJson(nextJson);
    if (nextScene.elements.length > 0) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const previousScene = parseSceneJson(this.lastSceneJson || this.getStructuredSceneJson());
    if (previousScene.elements.length === 0) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const now = this.now();
    if (!this.pendingEmptySceneCandidate || this.pendingEmptySceneCandidate.previousSceneJson !== this.lastSceneJson) {
      this.pendingEmptySceneCandidate = {
        firstSeenAt: now,
        previousSceneJson: this.lastSceneJson,
      };
      console.warn(`[excalidraw:${this.filePath}] Delaying suspicious empty scene commit during active collaboration`);
      return true;
    }

    return (now - this.pendingEmptySceneCandidate.firstSeenAt) < this.emptySceneGuardMs;
  }

  scheduleDelayedEmptySceneCommit() {
    if (this.sceneSyncTimer !== null) {
      return;
    }

    const firstSeenAt = this.pendingEmptySceneCandidate?.firstSeenAt ?? this.now();
    const elapsed = this.now() - firstSeenAt;
    const delay = Math.max(0, this.emptySceneGuardMs - elapsed);
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.flushSceneSync();
    }, delay);
  }

  flushPointerAwarenessPayload() {
    this.pointerAwarenessFrame = 0;

    if (!this.awareness || !this.pendingPointerPayload) {
      return;
    }

    this.awareness.setLocalStateField('pointer', this.pendingPointerPayload.pointer);
    this.awareness.setLocalStateField('pointerButton', this.pendingPointerPayload.button);
    this.pendingPointerPayload = null;
  }

  normalizeViewportAwareness(viewport) {
    if (!viewport || typeof viewport !== 'object') {
      return null;
    }

    const scrollX = Number(viewport.scrollX);
    const scrollY = Number(viewport.scrollY);
    const zoom = Number(viewport.zoom);
    if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY) || !Number.isFinite(zoom) || zoom <= 0) {
      return null;
    }

    return {
      scrollX,
      scrollY,
      zoom,
    };
  }

  scheduleLocalPointerAwareness(payload) {
    if (!this.awareness || !payload?.pointer) {
      return;
    }

    this.pendingPointerPayload = {
      button: payload.button === 'down' ? 'down' : 'up',
      pointer: {
        x: payload.pointer.x,
        y: payload.pointer.y,
        tool: payload.pointer.tool === 'laser' ? 'laser' : 'pointer',
      },
    };

    if (this.pointerAwarenessFrame) {
      return;
    }

    this.pointerAwarenessFrame = this.requestAnimationFrameFn(() => this.flushPointerAwarenessPayload());
  }

  flushViewportAwarenessPayload() {
    this.viewportAwarenessFrame = 0;

    if (!this.awareness || !this.pendingViewportPayload) {
      return;
    }

    this.awareness.setLocalStateField('viewport', this.pendingViewportPayload);
    this.pendingViewportPayload = null;
  }

  scheduleLocalViewportAwareness(viewport) {
    if (!this.awareness) {
      return;
    }

    const normalizedViewport = this.normalizeViewportAwareness(viewport);
    if (!normalizedViewport) {
      return;
    }

    const signature = `${normalizedViewport.scrollX}:${normalizedViewport.scrollY}:${normalizedViewport.zoom}`;
    if (signature === this.lastViewportSignature) {
      return;
    }

    this.lastViewportSignature = signature;
    this.pendingViewportPayload = normalizedViewport;

    if (this.viewportAwarenessFrame) {
      return;
    }

    this.viewportAwarenessFrame = this.requestAnimationFrameFn(() => this.flushViewportAwarenessPayload());
  }

  syncLocalSelectionAwareness(appState) {
    if (!this.awareness) {
      return;
    }

    const selected = appState?.selectedElementIds || {};
    const signature = Object.keys(selected).sort().join(',');
    if (signature === this.lastSelectedIdsSignature) {
      return;
    }

    this.lastSelectedIdsSignature = signature;
    this.awareness.setLocalStateField('selectedElementIds', selected);
  }

  commitSceneJson(nextJson, {
    allowCoalesce = false,
    captureTime = this.now(),
    origin = 'excalidraw-room-write',
  } = {}) {
    if (!this.ydoc || !this.historySnapshots || !this.historyState) {
      this.lastSceneJson = JSON.stringify(parseSceneJson(nextJson));
      return false;
    }

    const normalizedJson = JSON.stringify(parseSceneJson(nextJson));
    const roomSceneJson = this.getStructuredSceneJson();
    const previousSceneJson = this.lastSceneJson || roomSceneJson || normalizedJson;
    this.lastSceneJson = normalizedJson;

    this.ydoc.transact(() => {
      let head = this.getResolvedHistoryHead();
      let seededWithCurrentScene = false;
      if (this.historySnapshots.length === 0) {
        const seedJson = roomSceneJson || previousSceneJson;
        if (!roomSceneJson) {
          this.historySnapshots.insert(0, [normalizedJson]);
          head = 0;
          this.historyState.set(HISTORY_HEAD_KEY, head);
          seededWithCurrentScene = true;
        } else {
          this.historySnapshots.insert(0, [seedJson]);
          head = 0;
          this.historyState.set(HISTORY_HEAD_KEY, head);
        }
      }

      const shouldCoalesce = allowCoalesce && this.canCoalesceWithLocalHistory(head, captureTime);
      if (seededWithCurrentScene) {
        this.historyState.set(HISTORY_HEAD_KEY, head);
      } else if (shouldCoalesce) {
        this.replaceSharedHistorySnapshot(head, normalizedJson);
      } else {
        if (head < this.historySnapshots.length - 1) {
          this.historySnapshots.delete(head + 1, this.historySnapshots.length - head - 1);
        }

        this.historySnapshots.insert(head + 1, [normalizedJson]);
        head += 1;

        if (this.historySnapshots.length > this.historyLimit) {
          const overflow = this.historySnapshots.length - this.historyLimit;
          this.historySnapshots.delete(0, overflow);
          head -= overflow;
        }

        this.historyState.set(HISTORY_HEAD_KEY, head);
      }

      applySceneDiffToExcalidrawRoom(this.ydoc, parseSceneJson(normalizedJson));
      if (seededWithCurrentScene) {
        this.lastLocallyUpdatedHistoryHead = -1;
        this.lastLocallyUpdatedHistoryAt = 0;
      } else {
        this.lastLocallyUpdatedHistoryHead = head;
        this.lastLocallyUpdatedHistoryAt = captureTime;
      }
    }, origin);

    this.emitHistoryStateChange();
    return true;
  }

  undoShared() {
    return this.navigateSharedHistory(-1, 'excalidraw-shared-undo');
  }

  redoShared() {
    return this.navigateSharedHistory(1, 'excalidraw-shared-redo');
  }

  navigateSharedHistory(step, origin) {
    if (!this.canWriteToRoom || !this.ydoc || !this.historySnapshots || !this.historyState) {
      return false;
    }

    const currentHead = this.getResolvedHistoryHead();
    const nextHead = currentHead + step;
    if (nextHead < 0 || nextHead >= this.historySnapshots.length) {
      return false;
    }

    const nextJson = this.getSharedHistorySnapshot(nextHead);
    if (!nextJson) {
      return false;
    }

    this.ydoc.transact(() => {
      this.historyState.set(HISTORY_HEAD_KEY, nextHead);
      this.replaceStructuredSceneWithinTransaction(nextJson);
    }, origin);

    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;
    return true;
  }

  getSharedHistoryLength() {
    return this.historySnapshots?.length ?? 0;
  }

  getResolvedHistoryHead() {
    const length = this.getSharedHistoryLength();
    if (length === 0) {
      return -1;
    }

    const rawHead = Number(this.historyState?.get(HISTORY_HEAD_KEY));
    if (Number.isInteger(rawHead) && rawHead >= 0 && rawHead < length) {
      return rawHead;
    }

    return length - 1;
  }

  getSharedHistorySnapshot(index) {
    if (!this.historySnapshots || index < 0 || index >= this.historySnapshots.length) {
      return '';
    }

    const snapshot = this.historySnapshots.get(index);
    if (typeof snapshot !== 'string') {
      return '';
    }

    return JSON.stringify(parseSceneJson(snapshot));
  }

  getActiveSharedHistorySnapshot() {
    return this.getSharedHistorySnapshot(this.getResolvedHistoryHead());
  }

  replaceSharedHistorySnapshot(index, nextJson) {
    if (!this.historySnapshots || index < 0 || index >= this.historySnapshots.length) {
      return;
    }

    this.historySnapshots.delete(index, 1);
    this.historySnapshots.insert(index, [nextJson]);
  }

  canCoalesceWithLocalHistory(head, captureTime) {
    return (
      head >= 0
      && head === this.lastLocallyUpdatedHistoryHead
      && captureTime - this.lastLocallyUpdatedHistoryAt <= this.historyCaptureWindowMs
    );
  }

  ensureSharedHistoryInitialized(sceneJson) {
    if (!this.canWriteToRoom || !this.ydoc || !this.historySnapshots || !this.historyState) {
      return false;
    }

    if (this.historySnapshots.length > 0) {
      this.emitHistoryStateChange();
      return false;
    }

    const normalizedJson = JSON.stringify(parseSceneJson(sceneJson || this.lastSceneJson || this.getStructuredSceneJson()));
    this.ydoc.transact(() => {
      if (this.historySnapshots.length > 0) {
        return;
      }

      this.historySnapshots.insert(0, [normalizedJson]);
      this.historyState.set(HISTORY_HEAD_KEY, 0);
    }, 'excalidraw-history-seed');
    this.emitHistoryStateChange();
    return true;
  }

  handleRoomHistoryUpdate() {
    this.emitHistoryStateChange();
  }

  emitHistoryStateChange() {
    const nextState = this.getHistoryState();
    this.onHistoryStateChange(nextState);
    this.historySubscribers.forEach((listener) => listener(nextState));
  }

  disconnect() {
    this.flushSceneSync();
    this.clearTimeoutFn(this.sceneSyncTimer);
    this.sceneSyncTimer = null;
    this.pendingSceneSyncPayload = null;

    if (this.pointerAwarenessFrame) {
      this.cancelAnimationFrameFn(this.pointerAwarenessFrame);
    }
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    if (this.viewportAwarenessFrame) {
      this.cancelAnimationFrameFn(this.viewportAwarenessFrame);
    }
    this.viewportAwarenessFrame = 0;
    this.pendingViewportPayload = null;
    this.lastViewportSignature = '';
    this.lastSelectedIdsSignature = '';
    this.pendingEmptySceneCandidate = null;

    this.historySnapshots?.unobserve(this.handleSharedHistoryUpdate);
    this.historyState?.unobserve(this.handleSharedHistoryUpdate);
    this.roomMeta?.unobserve(this.handleStructuredSceneUpdate);
    this.roomElements?.unobserveDeep(this.handleStructuredSceneUpdate);
    this.roomFiles?.unobserveDeep(this.handleStructuredSceneUpdate);
    this.roomAppState?.unobserve(this.handleStructuredSceneUpdate);

    if (this.awareness) {
      this.awareness.off('change', this.handleAwarenessChange);
      this.awareness.setLocalState(null);
    }
    this.awareness = null;

    if (this.provider && this.handleProviderSync) {
      this.provider.off('sync', this.handleProviderSync);
    }
    this.handleProviderSync = null;
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.historySnapshots = null;
    this.historyState = null;
    this.roomMeta = null;
    this.roomElements = null;
    this.roomFiles = null;
    this.roomAppState = null;
    this.localUser = null;
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
    this.applyingSharedSnapshotDepth = 0;
    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;
    this.emitHistoryStateChange();
  }
}
