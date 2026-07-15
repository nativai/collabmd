import { createRequestError } from './http-errors.js';

export const REQUEST_BODY_LIMIT_BYTES = 8_388_608;

async function readRequestBuffer(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    let limitError = null;

    const finish = (callback, value) => {
      if (done) {
        return;
      }

      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      callback(value);
    };

    const onData = (chunk) => {
      if (limitError) {
        return;
      }

      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        limitError = createRequestError(413, 'Request body too large');
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      if (limitError) {
        finish(reject, limitError);
        return;
      }

      finish(resolve, Buffer.concat(chunks));
    };

    const onError = (error) => {
      finish(reject, error);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

export async function readRequestBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  const bodyBuffer = await readRequestBuffer(req, maxBytes);
  return bodyBuffer.toString('utf-8');
}

export async function readBinaryRequestBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  return readRequestBuffer(req, maxBytes);
}

export async function parseJsonBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  const rawBody = await readRequestBody(req, maxBytes);

  try {
    return JSON.parse(rawBody);
  } catch {
    throw createRequestError(400, 'Invalid JSON payload');
  }
}
