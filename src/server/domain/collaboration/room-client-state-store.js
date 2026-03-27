function createClientState() {
  return {
    backpressureCloseIssued: false,
    controlledClientIds: new Set(),
    transportCloseIssued: false,
  };
}

export class RoomClientStateStore {
  constructor() {
    this.clientState = new WeakMap();
  }

  register(client) {
    const state = createClientState();
    this.clientState.set(client, state);
    return state;
  }

  unregister(client) {
    const state = this.get(client);
    this.clientState.delete(client);
    return state;
  }

  get(client) {
    return this.clientState.get(client) ?? null;
  }
}
