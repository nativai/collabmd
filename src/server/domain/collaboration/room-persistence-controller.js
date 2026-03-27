export class RoomPersistenceController {
  constructor({
    idleGraceMs = 0,
    onDestroy = null,
    onPersist = null,
  }) {
    this.idleGraceMs = idleGraceMs;
    this.onDestroy = onDestroy;
    this.onPersist = onPersist;
    this.persistTimer = null;
    this.destroyTimer = null;
    this.finalizePromise = null;
    this.shutdownGeneration = 0;
  }

  markActivity() {
    this.shutdownGeneration += 1;
    clearTimeout(this.destroyTimer);
    this.destroyTimer = null;
  }

  cancelAll() {
    this.shutdownGeneration += 1;
    clearTimeout(this.persistTimer);
    clearTimeout(this.destroyTimer);
    this.persistTimer = null;
    this.destroyTimer = null;
  }

  schedulePersist(callback = this.onPersist) {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      Promise.resolve(callback?.()).catch((error) => {
        console.error(error);
      });
    }, 500);
  }

  async finalizeIfIdle({
    isIdle,
    onPersistError = null,
    onDestroy = this.onDestroy,
    onPersist = this.onPersist,
  }) {
    if (!isIdle()) {
      return;
    }

    if (this.finalizePromise) {
      return;
    }
    const generation = ++this.shutdownGeneration;

    this.finalizePromise = (async () => {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;

      try {
        await onPersist?.();
      } catch (error) {
        onPersistError?.(error);
      }

      if (!isIdle() || generation !== this.shutdownGeneration) {
        return;
      }

      this.destroyTimer = setTimeout(() => {
        if (!isIdle() || generation !== this.shutdownGeneration) {
          return;
        }

        onDestroy?.();
      }, this.idleGraceMs);
      this.destroyTimer.unref?.();
    })().finally(() => {
      this.finalizePromise = null;
    });
  }
}
