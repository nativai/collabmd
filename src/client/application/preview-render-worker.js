import { compilePreviewDocument } from './preview-render-compiler.js';

self.onmessage = (event) => {
  const {
    attachmentApiPath,
    fileList,
    markdownText,
    renderVersion,
    sourceFilePath,
  } = event.data ?? {};

  try {
    const result = compilePreviewDocument({
      attachmentApiPath,
      fileList,
      markdownText,
      sourceFilePath,
    });
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
