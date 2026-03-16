import test from 'node:test';
import assert from 'node:assert/strict';

import { PreviewRenderExecutor } from '../../src/client/application/preview-render-executor.js';

function createFakeWorker() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, payload) {
      listeners.get(type)?.(payload);
    },
    postMessage(payload) {
      this.lastMessage = payload;
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    terminate() {
      this.terminated = true;
    },
  };
}

test('PreviewRenderExecutor falls back to direct compilation when no worker is available', async () => {
  const executor = new PreviewRenderExecutor({
    compilePreviewDocumentLoader: async () => ({
      compilePreviewDocument({ fileList, markdownText }) {
        return {
          html: `<p>${markdownText}</p>`,
          stats: { fileCount: fileList.length },
        };
      },
    }),
    createWorkerFn: () => {
      throw new Error('worker unavailable');
    },
    getFileList: () => ['README.md'],
    getSourceFilePath: () => 'README.md',
  });

  const result = await executor.compile('Hello', 3);

  assert.deepEqual(result, {
    html: '<p>Hello</p>',
    stats: { fileCount: 1 },
  });
});

test('PreviewRenderExecutor compiles through the worker when available', async () => {
  const worker = createFakeWorker();
  const executor = new PreviewRenderExecutor({
    createWorkerFn: () => worker,
    getFileList: () => ['notes/today.md'],
  });

  const resultPromise = executor.compile('# Today', 7);

  assert.deepEqual(worker.lastMessage, {
    attachmentApiPath: '/api/attachment',
    fileList: ['notes/today.md'],
    markdownText: '# Today',
    renderVersion: 7,
    sourceFilePath: '',
  });

  worker.dispatch('message', {
    data: {
      html: '<h1>Today</h1>',
      renderVersion: 7,
      stats: { headings: 1 },
    },
  });

  const result = await resultPromise;
  assert.deepEqual(result, {
    html: '<h1>Today</h1>',
    stats: { headings: 1 },
  });
});

test('PreviewRenderExecutor schedules worker prewarm and tears it down on destroy', () => {
  const idleRequests = [];
  const idleCancels = [];
  const worker = createFakeWorker();
  const executor = new PreviewRenderExecutor({
    cancelIdleRenderFn: (idleId) => idleCancels.push(idleId),
    createWorkerFn: () => worker,
    requestIdleRenderFn: (callback, timeout) => {
      idleRequests.push({ callback, timeout });
      return 5;
    },
  });

  executor.schedulePrewarm({ timeout: 25 });
  assert.deepEqual(idleRequests.map(({ timeout }) => timeout), [25]);

  idleRequests[0].callback();
  assert.equal(worker.terminated, undefined);

  executor.destroy();
  assert.deepEqual(idleCancels, []);
  assert.equal(worker.terminated, true);
});
