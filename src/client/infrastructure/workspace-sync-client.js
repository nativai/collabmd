import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { normalizeWorkspaceEvent } from '../../domain/workspace-change.js';
import { WORKSPACE_ROOM_NAME } from '../../domain/workspace-room.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

function normalizeWorkspacePath(pathValue = '') {
  return String(pathValue ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function getParentDirectoryPath(pathValue = '') {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return '';
  }

  const separatorIndex = normalizedPath.lastIndexOf('/');
  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '';
}

function getEntryParentPath(entry = {}) {
  return getParentDirectoryPath(entry?.path ?? '');
}

function createNode(entry) {
  if (!entry?.path || !entry?.type) {
    return null;
  }

  if (entry.nodeType === 'directory' || entry.type === 'directory') {
    return {
      children: [],
      name: entry.name,
      path: entry.path,
      type: 'directory',
    };
  }

  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
  };
}

function sortNodes(nodes = []) {
  nodes.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1;
    if (left.type !== 'directory' && right.type === 'directory') return 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  nodes.forEach((node) => {
    if (Array.isArray(node.children)) {
      sortNodes(node.children);
    }
  });

  return nodes;
}

function toEntryMap(value) {
  if (value instanceof Map) {
    return value;
  }

  return new Map(Object.entries(value ?? {}));
}

function sortPathsByDepth(values = [], direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...values].sort((left, right) => {
    const depthDelta = left.split('/').length - right.split('/').length;
    if (depthDelta !== 0) {
      return depthDelta * factor;
    }

    return left.localeCompare(right, undefined, { sensitivity: 'base' }) * factor;
  });
}

class WorkspaceTreeModel {
  constructor() {
    this.entriesByPath = new Map();
    this.nodesByPath = new Map();
    this.nodeParentPathByPath = new Map();
    this.roots = [];
  }

  reset(rawEntries) {
    this.entriesByPath = toEntryMap(rawEntries);
    this.nodesByPath = new Map();
    this.nodeParentPathByPath = new Map();
    this.roots = [];

    this.entriesByPath.forEach((entry) => {
      const node = createNode(entry);
      if (node) {
        this.nodesByPath.set(entry.path, node);
      }
    });

    sortPathsByDepth(Array.from(this.nodesByPath.keys())).forEach((pathValue) => {
      const node = this.nodesByPath.get(pathValue);
      if (node) {
        this.attachNode(pathValue, node, getEntryParentPath(this.entriesByPath.get(pathValue)));
      }
    });

    sortNodes(this.roots);
    return this.roots;
  }

  getTree() {
    return this.roots;
  }

  applyMapChanges(changes, entriesMap) {
    const deletePaths = [];
    const upsertPaths = [];

    changes.forEach((change, pathValue) => {
      if (change.action === 'delete') {
        deletePaths.push(pathValue);
      } else {
        upsertPaths.push(pathValue);
      }
    });

    sortPathsByDepth(deletePaths, 'desc').forEach((pathValue) => {
      this.removeEntry(pathValue);
    });

    sortPathsByDepth(upsertPaths).forEach((pathValue) => {
      this.upsertEntry(pathValue, entriesMap.get(pathValue));
    });

    sortNodes(this.roots);
    return this.roots;
  }

  removeEntry(pathValue) {
    const node = this.nodesByPath.get(pathValue);
    if (!node) {
      this.entriesByPath.delete(pathValue);
      this.nodeParentPathByPath.delete(pathValue);
      return;
    }

    this.detachNode(pathValue, node);
    this.nodesByPath.delete(pathValue);
    this.entriesByPath.delete(pathValue);
    this.nodeParentPathByPath.delete(pathValue);
  }

  upsertEntry(pathValue, entry) {
    if (!entry?.path || !entry?.type) {
      this.removeEntry(pathValue);
      return;
    }

    const nextNode = createNode(entry);
    if (!nextNode) {
      this.removeEntry(pathValue);
      return;
    }

    const existingNode = this.nodesByPath.get(pathValue);
    let node = existingNode;
    if (!node || (node.type === 'directory') !== (nextNode.type === 'directory')) {
      if (node) {
        this.detachNode(pathValue, node);
      }
      node = nextNode;
      this.nodesByPath.set(pathValue, node);
    } else {
      node.name = nextNode.name;
      node.path = nextNode.path;
      node.type = nextNode.type;
      if (node.type === 'directory' && !Array.isArray(node.children)) {
        node.children = [];
      }
      if (node.type !== 'directory' && Array.isArray(node.children)) {
        delete node.children;
      }
    }

    this.entriesByPath.set(pathValue, entry);
    this.attachNode(pathValue, node, getEntryParentPath(entry));

    if (node.type === 'directory') {
      this.rehomeChildren(pathValue);
    }
  }

  detachNode(pathValue, node) {
    const currentParentPath = this.nodeParentPathByPath.get(pathValue) || '';
    const siblings = currentParentPath
      ? this.nodesByPath.get(currentParentPath)?.children
      : this.roots;
    const index = siblings?.indexOf?.(node) ?? -1;
    if (index >= 0) {
      siblings.splice(index, 1);
    }
    this.nodeParentPathByPath.delete(pathValue);
  }

  attachNode(pathValue, node, requestedParentPath = '') {
    const parentPath = this.nodesByPath.get(requestedParentPath)?.type === 'directory'
      ? requestedParentPath
      : '';
    const currentParentPath = this.nodeParentPathByPath.get(pathValue);

    if (currentParentPath === parentPath) {
      return;
    }

    if (currentParentPath !== undefined) {
      this.detachNode(pathValue, node);
    }

    const siblings = parentPath
      ? this.nodesByPath.get(parentPath)?.children
      : this.roots;
    if (!siblings.includes(node)) {
      siblings.push(node);
    }
    this.nodeParentPathByPath.set(pathValue, parentPath);
  }

  rehomeChildren(parentPath) {
    this.entriesByPath.forEach((entry, pathValue) => {
      if (getEntryParentPath(entry) !== parentPath) {
        return;
      }

      const node = this.nodesByPath.get(pathValue);
      if (node) {
        this.attachNode(pathValue, node, parentPath);
      }
    });
  }
}

export class WorkspaceSyncClient {
  constructor({
    onTreeChange = () => {},
    onWorkspaceEvent = () => {},
  } = {}) {
    this.onTreeChange = onTreeChange;
    this.onWorkspaceEvent = onWorkspaceEvent;
    this.ydoc = new Y.Doc();
    this.entries = this.ydoc.getMap('entries');
    this.events = this.ydoc.getArray('events');
    this.provider = null;
    this._didInitialSync = false;
    this.seenEventIds = new Set();
    this.treeModel = new WorkspaceTreeModel();

    // "Paths of interest" the server watches lazily for us: the directories we have
    // expanded in the tree + our open file, published on this room's Yjs awareness.
    // Retained so they can be (re)applied after (re)connect and re-asserted on focus.
    this._watchSubscription = { activeFile: null, dirs: [] };
    this._watchSubscriptionSignature = '';
    this.handleWindowFocus = () => this.refreshWatchSubscription();
    this.handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        this.refreshWatchSubscription();
      }
    };

    this.handleEntriesChange = (event) => {
      if (!this._didInitialSync || !event) {
        return;
      }

      this.onTreeChange(this.treeModel.applyMapChanges(event.changes.keys, this.entries), {
        changedPaths: Array.from(event.changes.keys.keys()),
        reset: false,
      });
    };
    this.handleEventsChange = () => {
      if (!this._didInitialSync) {
        this.primeEventCache();
        return;
      }

      this.events.toArray().forEach((event) => {
        const normalized = normalizeWorkspaceEvent(event);
        if (!normalized || this.seenEventIds.has(normalized.id)) {
          return;
        }

        this.seenEventIds.add(normalized.id);
        this.onWorkspaceEvent(normalized);
      });
    };
  }

  connect() {
    if (this.provider) {
      return;
    }

    this._didInitialSync = false;
    this.provider = new WebsocketProvider(resolveWsBaseUrl(), WORKSPACE_ROOM_NAME, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });
    stopReconnectOnControlledClose(this.provider);

    this.entries.observe(this.handleEntriesChange);
    this.events.observe(this.handleEventsChange);
    // Re-publish our watch subscription once (re)connected — awareness state is
    // per-connection, so a subscription set before connect or lost on a reconnect
    // must be re-applied.
    this.provider.on('status', ({ status }) => {
      if (status === 'connected') {
        this.applyWatchSubscription();
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.handleWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.provider.on('sync', (isSynced) => {
      if (!isSynced || this._didInitialSync) {
        return;
      }

      this._didInitialSync = true;
      this.primeEventCache();
      this.applyWatchSubscription();
      this.onTreeChange(this.treeModel.reset(this.entries.toJSON()), {
        changedPaths: [],
        reset: true,
      });
    });
  }

  // Publish the directories we have expanded + our open file so the server watches
  // exactly what we are looking at. Deduped by signature so the frequent tree
  // re-renders (search typing, thread-count updates) don't spam awareness.
  setWatchSubscription({ dirs = [], activeFile = null } = {}) {
    const normalizedDirs = Array.from(new Set(
      dirs.filter((dir) => typeof dir === 'string' && dir.length > 0),
    )).sort();
    const normalizedActiveFile = typeof activeFile === 'string' && activeFile ? activeFile : null;
    const signature = `${normalizedActiveFile ?? ''} ${normalizedDirs.join('')}`;
    if (signature === this._watchSubscriptionSignature) {
      return;
    }
    this._watchSubscriptionSignature = signature;
    this._watchSubscription = { activeFile: normalizedActiveFile, dirs: normalizedDirs };
    this.applyWatchSubscription();
  }

  // Re-assert the current subscription unconditionally (e.g. on window focus): Yjs
  // awareness always re-emits on set, prompting the server to re-read our open file
  // so it stays current even when its directory watch is absent (degraded / capped).
  refreshWatchSubscription() {
    this.applyWatchSubscription();
  }

  applyWatchSubscription() {
    const awareness = this.provider?.awareness;
    if (!awareness) {
      return;
    }
    awareness.setLocalStateField('watchDirs', this._watchSubscription.dirs);
    awareness.setLocalStateField('activeFile', this._watchSubscription.activeFile);
  }

  primeEventCache() {
    this.events.toArray().forEach((event) => {
      const normalized = normalizeWorkspaceEvent(event);
      if (normalized) {
        this.seenEventIds.add(normalized.id);
      }
    });
  }

  disconnect() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.entries.unobserve(this.handleEntriesChange);
    this.events.unobserve(this.handleEventsChange);
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this._didInitialSync = false;
    this.seenEventIds.clear();
    this.treeModel.reset(new Map());
  }

  destroy() {
    this.disconnect();
    this.ydoc.destroy();
  }
}
