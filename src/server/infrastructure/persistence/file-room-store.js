import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { resolve } from 'path';

function sanitizeRoomKey(key) {
  return key.replace(/[^a-zA-Z0-9-_]/g, '_');
}

export class FileRoomStore {
  constructor({ directory }) {
    this.directory = directory;
    this.ensureDirectoryPromise = null;
  }

  async ensureDirectory() {
    if (!this.ensureDirectoryPromise) {
      this.ensureDirectoryPromise = mkdir(this.directory, { recursive: true });
    }

    await this.ensureDirectoryPromise;
  }

  resolvePath(key) {
    return resolve(this.directory, `${sanitizeRoomKey(key)}.bin`);
  }

  resolveCorruptPath(key) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return resolve(this.directory, `${sanitizeRoomKey(key)}.corrupt-${timestamp}.bin`);
  }

  async read(key) {
    await this.ensureDirectory();

    try {
      const file = await readFile(this.resolvePath(key));
      if (file.byteLength === 0) {
        return null;
      }

      return new Uint8Array(file);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async write(key, update) {
    await this.ensureDirectory();
    const targetPath = this.resolvePath(key);

    if (!update || update.byteLength === 0) {
      await rm(targetPath, { force: true });
      return;
    }

    const temporaryPath = `${targetPath}.tmp`;
    await writeFile(temporaryPath, Buffer.from(update));
    await rename(temporaryPath, targetPath);
  }

  async quarantine(key) {
    await this.ensureDirectory();

    const sourcePath = this.resolvePath(key);
    const corruptPath = this.resolveCorruptPath(key);

    try {
      await rename(sourcePath, corruptPath);
      return corruptPath;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }
}
