import {
  isExcalidrawFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  supportsBacklinksForFilePath,
} from '../../../domain/file-kind.js';

export class CollaborationDocumentStore {
  constructor({
    backlinkIndex = null,
    name,
    vaultFileStore = null,
  }) {
    this.name = name;
    this.vaultFileStore = vaultFileStore;
    this.backlinkIndex = backlinkIndex;
  }

  hasPersistence() {
    return Boolean(this.vaultFileStore);
  }

  rename(nextName) {
    if (!nextName || nextName === this.name) {
      return;
    }

    this.name = nextName;
  }

  async readSnapshot() {
    if (!this.vaultFileStore || typeof this.vaultFileStore.readCollaborationSnapshot !== 'function') {
      return null;
    }

    return this.vaultFileStore.readCollaborationSnapshot(this.name);
  }

  async readContent() {
    if (!this.vaultFileStore) {
      return null;
    }

    if (isExcalidrawFilePath(this.name) && typeof this.vaultFileStore.readExcalidrawFile === 'function') {
      return this.vaultFileStore.readExcalidrawFile(this.name);
    }

    if (isMermaidFilePath(this.name) && typeof this.vaultFileStore.readMermaidFile === 'function') {
      return this.vaultFileStore.readMermaidFile(this.name);
    }

    if (isPlantUmlFilePath(this.name) && typeof this.vaultFileStore.readPlantUmlFile === 'function') {
      return this.vaultFileStore.readPlantUmlFile(this.name);
    }

    return this.vaultFileStore.readMarkdownFile(this.name);
  }

  async readCommentThreads() {
    if (!this.vaultFileStore || typeof this.vaultFileStore.readCommentThreads !== 'function') {
      return [];
    }

    return this.vaultFileStore.readCommentThreads(this.name);
  }

  async persistState({
    commentThreads = [],
    content = '',
    snapshot = null,
  } = {}) {
    if (!this.vaultFileStore) {
      return;
    }

    await this.writeContent(content);
    await this.writeCommentThreads(commentThreads);
    await this.writeSnapshot(snapshot);

    if (this.backlinkIndex && supportsBacklinksForFilePath(this.name)) {
      this.backlinkIndex.updateFile(this.name, content);
    }
  }

  async writeContent(content) {
    if (!this.vaultFileStore) {
      return;
    }

    const options = { invalidateCollaborationSnapshot: false };
    if (isExcalidrawFilePath(this.name) && typeof this.vaultFileStore.writeExcalidrawFile === 'function') {
      await this.vaultFileStore.writeExcalidrawFile(this.name, content, options);
      return;
    }

    if (isMermaidFilePath(this.name) && typeof this.vaultFileStore.writeMermaidFile === 'function') {
      await this.vaultFileStore.writeMermaidFile(this.name, content, options);
      return;
    }

    if (isPlantUmlFilePath(this.name) && typeof this.vaultFileStore.writePlantUmlFile === 'function') {
      await this.vaultFileStore.writePlantUmlFile(this.name, content, options);
      return;
    }

    await this.vaultFileStore.writeMarkdownFile(this.name, content, options);
  }

  async writeSnapshot(snapshot) {
    if (!snapshot || !this.vaultFileStore || typeof this.vaultFileStore.writeCollaborationSnapshot !== 'function') {
      return;
    }

    await this.vaultFileStore.writeCollaborationSnapshot(this.name, snapshot);
  }

  async deleteSnapshot() {
    if (!this.vaultFileStore || typeof this.vaultFileStore.deleteCollaborationSnapshot !== 'function') {
      return;
    }

    await this.vaultFileStore.deleteCollaborationSnapshot(this.name);
  }

  async writeCommentThreads(threads) {
    if (!this.vaultFileStore || typeof this.vaultFileStore.writeCommentThreads !== 'function') {
      return;
    }

    await this.vaultFileStore.writeCommentThreads(this.name, threads);
  }
}
