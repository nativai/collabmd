import { compilePreviewDocument } from './preview-render-compiler.js';

self.onmessage = (event) => {
  const { fileList, markdownText, renderVersion } = event.data ?? {};

  try {
    const result = compilePreviewDocument({ fileList, markdownText });
    self.postMessage({
      html: result.html,
      renderVersion,
      stats: result.stats,
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      renderVersion,
    });
  }
};
