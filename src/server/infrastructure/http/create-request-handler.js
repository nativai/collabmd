import { readFile } from 'fs/promises';
import { extname, normalize, resolve } from 'path';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

function buildRuntimeConfig({ nodeEnv, publicWsBaseUrl, wsBasePath }) {
  return `window.__COLLABMD_CONFIG__ = ${JSON.stringify({
    environment: nodeEnv,
    publicWsBaseUrl,
    wsBasePath,
  })};\n`;
}

function setHeaders(res, headers) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

function createStaticFileReader() {
  const cache = new Map();

  return async function readStaticFile(filePath) {
    if (!cache.has(filePath)) {
      cache.set(filePath, readFile(filePath).catch((error) => {
        cache.delete(filePath);
        throw error;
      }));
    }

    return cache.get(filePath);
  };
}

function resolvePublicFile(publicDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = resolve(publicDir, `.${safePath}`);
  const publicRoot = publicDir.endsWith('/') ? publicDir : `${publicDir}/`;

  if (!absolutePath.startsWith(publicRoot) && absolutePath !== resolve(publicDir, 'index.html')) {
    return null;
  }

  return absolutePath;
}

export function createRequestHandler(config) {
  const readStaticFile = createStaticFileReader();

  return async function handleRequest(req, res) {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    setHeaders(res, {
      ...SECURITY_HEADERS,
      'Access-Control-Allow-Origin': '*',
    });

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (requestUrl.pathname === '/app-config.js') {
      const body = buildRuntimeConfig(config);
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/javascript; charset=utf-8',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let filePath = resolvePublicFile(config.publicDir, requestUrl.pathname);
    if (!filePath && !extname(requestUrl.pathname)) {
      filePath = resolve(config.publicDir, 'index.html');
    }

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    try {
      const file = await readStaticFile(filePath);
      const extension = extname(filePath);
      const isAsset = requestUrl.pathname.startsWith('/assets/');

      res.writeHead(200, {
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
        'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      res.end(file);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      console.error(`[http] Failed to serve "${requestUrl.pathname}":`, error.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  };
}
