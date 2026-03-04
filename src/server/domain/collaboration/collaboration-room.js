import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { MSG_AWARENESS, MSG_SYNC } from './protocol.js';

function sendMessage(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(payload);
  }
}

function readAwarenessEntries(update) {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));

    entries.push({ clientId, state });
  }

  return entries;
}

export class CollaborationRoom {
  constructor({ name, docNamespace, persistenceStore, onEmpty }) {
    this.name = name;
    this.docKey = `${docNamespace}-${name}`;
    this.persistenceStore = persistenceStore;
    this.onEmpty = onEmpty;
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.clients = new Set();
    this.hydrated = false;
    this.persistTimer = null;

    this.awareness.setLocalState(null);
    this.registerDocListeners();
  }

  async hydrate() {
    if (this.hydrated || !this.persistenceStore) {
      this.hydrated = true;
      return;
    }

    const update = await this.persistenceStore.read(this.docKey);

    if (update) {
      Y.applyUpdate(this.doc, update, 'persistence');
    }

    this.hydrated = true;
  }

  registerDocListeners() {
    this.doc.on('update', (update, origin) => {
      this.schedulePersist();

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const client of this.clients) {
        if (client !== origin) {
          try {
            sendMessage(client, message);
          } catch (error) {
            console.error(`[room:${this.name}] Failed to broadcast sync update:`, error.message);
          }
        }
      }
    });

    this.awareness.on('update', ({ added, updated, removed }) => {
      const changedClientIds = added.concat(updated, removed);

      if (changedClientIds.length === 0) {
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClientIds),
      );
      const message = encoding.toUint8Array(encoder);

      for (const client of this.clients) {
        try {
          sendMessage(client, message);
        } catch (error) {
          console.error(`[room:${this.name}] Failed to broadcast awareness update:`, error.message);
        }
      }
    });
  }

  schedulePersist() {
    if (!this.persistenceStore) {
      return;
    }

    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persist().catch((error) => {
        console.error(`[room:${this.name}] Failed to persist document:`, error.message);
      });
    }, 250);
  }

  async persist() {
    if (!this.persistenceStore) {
      return;
    }

    await this.persistenceStore.write(this.docKey, Y.encodeStateAsUpdate(this.doc));
  }

  async addClient(ws) {
    await this.hydrate();

    ws.controlledClientIds = new Set();
    this.clients.add(ws);

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    sendMessage(ws, encoding.toUint8Array(syncEncoder));

    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())),
      );
      sendMessage(ws, encoding.toUint8Array(awarenessEncoder));
    }
  }

  removeClient(ws) {
    if (ws.controlledClientIds?.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ws.controlledClientIds), ws);
      ws.controlledClientIds.clear();
    }

    this.clients.delete(ws);

    if (this.clients.size > 0) {
      return;
    }

    clearTimeout(this.persistTimer);
    void this.persist().catch((error) => {
      console.error(`[room:${this.name}] Failed to persist final room state:`, error.message);
    });

    this.awareness.destroy();
    this.doc.destroy();
    this.onEmpty?.(this.name);
  }

  handleMessage(ws, rawData) {
    const message = rawData instanceof Buffer ? new Uint8Array(rawData) : new Uint8Array(rawData);

    try {
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);

          if (encoding.length(encoder) > 1) {
            sendMessage(ws, encoding.toUint8Array(encoder));
          }
          break;
        }

        case MSG_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          const entries = readAwarenessEntries(update);

          for (const entry of entries) {
            if (entry.state === null) {
              ws.controlledClientIds.delete(entry.clientId);
            } else {
              ws.controlledClientIds.add(entry.clientId);
            }
          }

          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
          break;
        }

        default:
          console.warn(`[room:${this.name}] Unsupported message type: ${messageType}`);
      }
    } catch (error) {
      console.error(`[room:${this.name}] Failed to handle message:`, error.message);
    }
  }
}
