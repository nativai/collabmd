const DOCX_EXPORTER_CREATOR = 'CollabMD';

function normalizeDocxBuffer(result) {
  if (Buffer.isBuffer(result)) {
    return result;
  }

  if (result instanceof ArrayBuffer) {
    return Buffer.from(result);
  }

  if (ArrayBuffer.isView(result)) {
    return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  }

  throw new Error('DOCX exporter returned an unsupported payload');
}

export class DocxExporter {
  constructor({
    loadConverter = () => import('@turbodocx/html-to-docx'),
  } = {}) {
    this.loadConverter = loadConverter;
    this.converterPromise = null;
  }

  async ensureConverter() {
    if (this.converterPromise) {
      return this.converterPromise;
    }

    this.converterPromise = this.loadConverter().then((module) => {
      const converter = module?.default ?? module?.HTMLToDOCX ?? module;
      if (typeof converter !== 'function') {
        throw new Error('DOCX converter failed to load');
      }
      return converter;
    });
    return this.converterPromise;
  }

  async render({
    html,
    title = '',
  } = {}) {
    const converter = await this.ensureConverter();
    const result = await converter(String(html ?? ''), null, {
      creator: DOCX_EXPORTER_CREATOR,
      font: 'Arial',
      footer: false,
      pageNumber: false,
      table: {
        row: {
          cantSplit: true,
        },
      },
      title: String(title ?? ''),
    });

    return normalizeDocxBuffer(result);
  }
}
