import { mkdir, readFile, writeFile } from 'fs/promises';
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

  async read(key) {
    await this.ensureDirectory();

    try {
      const file = await readFile(this.resolvePath(key));
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
    await writeFile(this.resolvePath(key), Buffer.from(update));
  }
}
