import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  requestIdleRender,
} from './preview-diagram-utils.js';

function createPreviewWorker() {
  return new Worker(new URL('./preview-render-worker.js', import.meta.url), { type: 'module' });
}

export class PreviewRenderExecutor {
  constructor({
    attachmentApiPath = '/api/attachment',
    cancelIdleRenderFn = cancelIdleRender,
    compilePreviewDocumentLoader = () => import('./preview-render-compiler.js'),
    createWorkerFn = createPreviewWorker,
    getFileList,
    getSourceFilePath = null,
    getWikiLinkAutoCreate = null,
    idleTimeoutMs = IDLE_RENDER_TIMEOUT_MS,
    requestIdleRenderFn = requestIdleRender,
  } = {}) {
    this.attachmentApiPath = attachmentApiPath;
    this.cancelIdleRenderFn = cancelIdleRenderFn;
    this.compilePreviewDocumentLoader = compilePreviewDocumentLoader;
    this.createWorkerFn = createWorkerFn;
    this.getFileList = getFileList;
    this.getSourceFilePath = getSourceFilePath;
    this.getWikiLinkAutoCreate = getWikiLinkAutoCreate;
    this.idleTimeoutMs = idleTimeoutMs;
    this.requestIdleRenderFn = requestIdleRenderFn;
    this.worker = null;
    this.workerDisabled = false;
    this.workerJob = null;
    this.workerPrewarmId = null;

    this.handleWorkerMessage = (event) => {
      if (!this.workerJob || event.data?.renderVersion !== this.workerJob.renderVersion) {
        return;
      }

      const job = this.workerJob;
      this.workerJob = null;

      if (event.data?.error) {
        job.reject(new Error(event.data.error));
        return;
      }

      job.resolve({
        html: event.data.html,
        stats: event.data.stats,
      });
    };

    this.handleWorkerError = (event) => {
      const error = new Error(event.message || 'Preview worker failed');
      if (this.workerJob) {
        this.workerJob.reject(error);
        this.workerJob = null;
      }

      this.reset('Preview worker failed', { disable: true });
    };
  }

  hasPendingJob() {
    return this.workerJob !== null;
  }

  schedulePrewarm({ timeout = this.idleTimeoutMs } = {}) {
    if (this.workerDisabled || this.worker || this.workerPrewarmId !== null) {
      return;
    }

    this.workerPrewarmId = this.requestIdleRenderFn(() => {
      this.workerPrewarmId = null;
      this.ensureWorker();
    }, timeout);
  }

  ensureWorker() {
    if (this.workerDisabled) {
      return null;
    }

    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = this.createWorkerFn();
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
      return this.worker;
    } catch {
      this.workerDisabled = true;
      return null;
    }
  }

  async compile(markdownText, renderVersion, {
    frontmatterCollapsed = false,
    frontmatterInteractive = false,
  } = {}) {
    const worker = this.ensureWorker();

    if (worker) {
      if (this.workerJob) {
        this.reset('Superseded preview render');
      }

      const activeWorker = this.ensureWorker();
      return new Promise((resolve, reject) => {
        this.workerJob = { reject, renderVersion, resolve };
        activeWorker.postMessage({
          attachmentApiPath: this.attachmentApiPath,
          fileList: this.getFileList?.() ?? [],
          frontmatterCollapsed,
          frontmatterInteractive,
          markdownText,
          renderVersion,
          sourceFilePath: this.getSourceFilePath?.() ?? '',
          wikiLinkAutoCreate: this.getWikiLinkAutoCreate?.() ?? true,
        });
      });
    }

    const { compilePreviewDocument } = await this.compilePreviewDocumentLoader();
    return compilePreviewDocument({
      attachmentApiPath: this.attachmentApiPath,
      fileList: this.getFileList?.() ?? [],
      frontmatterCollapsed,
      frontmatterInteractive,
      markdownText,
      sourceFilePath: this.getSourceFilePath?.() ?? '',
      wikiLinkAutoCreate: this.getWikiLinkAutoCreate?.() ?? true,
    });
  }

  cancelWorkerJob(reason) {
    if (!this.workerJob) {
      return;
    }

    this.workerJob.reject(new Error(reason));
    this.workerJob = null;
  }

  reset(reason, { disable = false } = {}) {
    this.cancelWorkerJob(reason);

    if (this.worker) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }

    if (disable) {
      this.workerDisabled = true;
    }
  }

  destroy(reason = 'Preview renderer destroyed') {
    if (this.workerPrewarmId !== null) {
      this.cancelIdleRenderFn(this.workerPrewarmId);
    }
    this.workerPrewarmId = null;
    this.reset(reason);
  }
}
