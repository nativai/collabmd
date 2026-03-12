import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import {
  mergeAwarenessUserPatch,
  resolveLocalAwarenessUser,
} from './domain/excalidraw-collaboration.js';
import {
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from './domain/excalidraw-scene.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import { ExcalidrawRoomClient } from './infrastructure/excalidraw-room-client.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const params = new URLSearchParams(window.location.search);
const filePath = params.get('file');
const isTestMode = params.get('test') === '1';
const parentOrigin = window.location.origin;
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);

let excalidrawAPI = null;
let currentTheme = params.get('theme') || 'dark';
let localAwarenessUser = resolveLocalAwarenessUser({
  params,
  storedUserName: localStorage.getItem('collabmd-user-name'),
});
let appliedSceneJson = '';

let collabReady = false;
let suppressOnChange = false;
let pendingRemoteSceneJson = '';
let pendingCollaborators = null;
let pendingSuppressionReleases = 0;
const roomClient = new ExcalidrawRoomClient({
  filePath,
  onCollaboratorsChange: (collaborators) => {
    if (!collabReady) {
      pendingCollaborators = collaborators;
      return;
    }

    applyCollaborators(collaborators);
  },
  onRemoteSceneJson: (sceneJson) => {
    applySceneFromJson(sceneJson);
  },
  syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
  vaultClient: vaultApiClient,
});

function SharedHistoryControls({ roomClient: connectedRoomClient, isMobile = false }) {
  const [historyState, setHistoryState] = React.useState(() => connectedRoomClient.getHistoryState());

  React.useEffect(() => connectedRoomClient.subscribeHistoryState(setHistoryState), [connectedRoomClient]);

  return React.createElement(
    'div',
    {
      className: `collabmd-excalidraw-history-controls${isMobile ? ' is-mobile' : ''}`,
    },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'collabmd-excalidraw-history-btn',
        disabled: !historyState.canUndo,
        onClick: () => {
          connectedRoomClient.undoShared();
        },
      },
      'Undo',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'collabmd-excalidraw-history-btn',
        disabled: !historyState.canRedo,
        onClick: () => {
          connectedRoomClient.redoShared();
        },
      },
      'Redo',
    ),
  );
}

function ensureSharedHistoryStyles() {
  if (document.getElementById('collabmd-excalidraw-history-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'collabmd-excalidraw-history-styles';
  style.textContent = `
    .excalidraw .undo-redo-buttons {
      display: none !important;
    }

    .collabmd-excalidraw-history-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .collabmd-excalidraw-history-controls.is-mobile {
      margin-left: 8px;
    }

    .collabmd-excalidraw-history-btn {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.74);
      color: #f8fafc;
      border-radius: 10px;
      padding: 0 12px;
      min-height: 36px;
      font: 600 13px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
      cursor: pointer;
    }

    .collabmd-excalidraw-history-btn:hover:not(:disabled) {
      background: rgba(30, 41, 59, 0.92);
    }

    .collabmd-excalidraw-history-btn:disabled {
      cursor: default;
      opacity: 0.4;
    }

    .excalidraw.theme--light .collabmd-excalidraw-history-btn {
      background: rgba(255, 255, 255, 0.92);
      color: #0f172a;
    }

    .excalidraw.theme--light .collabmd-excalidraw-history-btn:hover:not(:disabled) {
      background: rgba(248, 250, 252, 1);
    }
  `;
  document.head.append(style);
}

function applyLocalUserPatch(nextUser = {}) {
  localAwarenessUser = mergeAwarenessUserPatch({
    currentUser: localAwarenessUser,
    nextUser,
  });
  roomClient.setLocalUser(localAwarenessUser);
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    getHistoryState: () => roomClient.getHistoryState(),
    getLocalUserName: () => localAwarenessUser?.name || '',
    getSceneJson: () => roomClient.getLastSceneJson(),
    isReady: () => collabReady && Boolean(excalidrawAPI),
    redoShared: () => roomClient.redoShared(),
    setScene: (scene) => {
      const json = JSON.stringify(normalizeScene(scene));
      applySceneFromJson(json);
      roomClient.commitSceneJson(json, {
        allowCoalesce: false,
        origin: 'excalidraw-test',
      });
    },
    undoShared: () => roomClient.undoShared(),
  };
}

function applyCollaborators(collaborators) {
  if (!excalidrawAPI) {
    pendingCollaborators = collaborators;
    return;
  }

  excalidrawAPI.updateScene({
    collaborators,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

function applySceneFromJson(rawJson) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  appliedSceneJson = normalizedJson;

  if (!excalidrawAPI) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  updateApiScene(scene);
}

function releaseOnChangeSuppressionAfterPaint({ trackedSharedSnapshot = false } = {}) {
  pendingSuppressionReleases += 1;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingSuppressionReleases = Math.max(0, pendingSuppressionReleases - 1);
      if (trackedSharedSnapshot) {
        roomClient.endApplyingSharedSnapshot();
      }
      if (pendingSuppressionReleases === 0) {
        suppressOnChange = false;
      }
    });
  });
}

function updateApiScene(scene, {
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = true,
} = {}) {
  suppressOnChange = true;
  if (trackedSharedSnapshot) {
    roomClient.beginApplyingSharedSnapshot();
  }
  try {
    excalidrawAPI.updateScene({
      elements: scene.elements,
      appState: {
        theme: currentTheme,
        viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
        gridSize: scene.appState.gridSize ?? null,
      },
      files: scene.files || {},
      captureUpdate,
    });
  } finally {
    releaseOnChangeSuppressionAfterPaint({ trackedSharedSnapshot });
  }
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient.getLastSceneJson());
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function disconnectRealtimeRoom() {
  collabReady = false;
  pendingCollaborators = null;
  roomClient.disconnect();
}

function handleSharedHistoryKeydown(event) {
  if (!collabReady || !excalidrawAPI || event.altKey) {
    return;
  }

  const key = String(event.key || '').toLowerCase();
  const isPrimaryModifier = event.metaKey || event.ctrlKey;
  const isUndo = isPrimaryModifier && key === 'z' && !event.shiftKey;
  const isRedo = (
    isPrimaryModifier
    && ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey))
  );

  if (!isUndo && !isRedo) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  if (isUndo) {
    roomClient.undoShared();
    return;
  }

  roomClient.redoShared();
}

window.addEventListener('pagehide', () => {
  disconnectRealtimeRoom();
});
document.addEventListener('keydown', handleSharedHistoryKeydown, true);

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== 'collabmd-host') {
    return;
  }

  if (message.type === 'set-theme') {
    currentTheme = message.theme || 'dark';
    if (excalidrawAPI) {
      suppressOnChange = true;
      excalidrawAPI.updateScene({
        appState: { theme: currentTheme },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      releaseOnChangeSuppressionAfterPaint();
    }
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || suppressOnChange || roomClient.isApplyingSharedSnapshot()) {
    return;
  }

  roomClient.scheduleSceneSync(elements, appState, files);
}

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    await ensureClientAuthenticated();
    const initialScene = await roomClient.connect({ initialUser: localAwarenessUser });
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });
    ensureSharedHistoryStyles();

    loadingElement?.remove();

    const excalidrawProps = {
      excalidrawAPI: (api) => {
        excalidrawAPI = api;

        const sceneJson = pendingRemoteSceneJson || roomClient.getLastSceneJson();
        pendingRemoteSceneJson = '';
        updateApiScene(parseSceneJson(sceneJson));

        if (pendingCollaborators) {
          excalidrawAPI.updateScene({
            collaborators: pendingCollaborators,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          pendingCollaborators = null;
        }
        collabReady = true;
        onRoomTextUpdate();

        postToParent('ready');
      },
      initialData,
      aiEnabled: false,
      isCollaborating: true,
      onChange: (elements, appState, files) => {
        scheduleSyncToRoom(elements, appState, files);
        roomClient.syncLocalSelectionAwareness(appState);
      },
      onPointerUpdate: (payload) => {
        roomClient.scheduleLocalPointerAwareness(payload);
      },
      renderTopRightUI: (isMobile) => React.createElement(SharedHistoryControls, {
        isMobile,
        roomClient,
      }),
      theme: currentTheme,
      UIOptions: {
        canvasActions: {
          export: false,
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
        },
      },
    };

    const App = () => React.createElement(
      'div',
      { style: { height: '100vh', width: '100%' } },
      React.createElement(Excalidraw, excalidrawProps),
    );

    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  } catch (error) {
    console.error('[excalidraw] Failed to initialize:', error);
    postToParent('error', {
      message: error instanceof Error ? error.message : 'Failed to load Excalidraw',
    });

    if (loadingElement) {
      loadingElement.className = 'loading-state error';
      loadingElement.textContent = `Failed to load Excalidraw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

void init();
