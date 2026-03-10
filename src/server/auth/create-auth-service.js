import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createSessionCookieManager } from './session-cookie.js';

export const AUTH_STRATEGY_NONE = 'none';
export const AUTH_STRATEGY_PASSWORD = 'password';
export const AUTH_STRATEGY_OIDC = 'oidc';

export const SUPPORTED_AUTH_STRATEGIES = new Set([
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_PASSWORD,
  AUTH_STRATEGY_OIDC,
]);

export function createRandomAuthPassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }

  return password;
}

export function createRandomSessionSecret() {
  return randomBytes(32).toString('base64url');
}

function hashPassword(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

function createResponse(statusCode, body, options = {}) {
  return {
    body,
    kind: options.kind || 'response',
    setCookie: options.setCookie || null,
    statusCode,
  };
}

function createUnauthorizedBody(clientConfig, {
  error = 'Authentication required',
  code = 'AUTH_REQUIRED',
} = {}) {
  return {
    auth: clientConfig,
    code,
    error,
  };
}

function buildClientConfig(authConfig) {
  if (authConfig.strategy === AUTH_STRATEGY_NONE) {
    return {
      enabled: false,
      implemented: true,
      requiresLogin: false,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: AUTH_STRATEGY_NONE,
    };
  }

  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    return {
      enabled: true,
      implemented: true,
      passwordLabel: 'Host password',
      requiresLogin: true,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: AUTH_STRATEGY_PASSWORD,
      submitLabel: 'Join session',
    };
  }

  return {
    enabled: true,
    implemented: false,
    requiresLogin: true,
    sessionEndpoint: '/api/auth/session',
    statusEndpoint: '/api/auth/status',
    strategy: AUTH_STRATEGY_OIDC,
  };
}

function createPasswordStrategy(authConfig, sessionCookieManager, clientConfig) {
  const expectedPasswordHash = hashPassword(authConfig.password);

  function hasValidSession(req) {
    const session = sessionCookieManager.readSession(req);
    return session?.strategy === AUTH_STRATEGY_PASSWORD;
  }

  return {
    createSession(req, body = {}) {
      if (typeof body.password !== 'string' || !body.password) {
        return createResponse(400, { error: 'Missing password' }, { kind: 'invalid_request' });
      }

      const submittedPasswordHash = hashPassword(body.password);
      const isValidPassword = submittedPasswordHash.length === expectedPasswordHash.length
        && timingSafeEqual(submittedPasswordHash, expectedPasswordHash);

      if (!isValidPassword) {
        return createResponse(401, {
          auth: clientConfig,
          code: 'AUTH_INVALID_CREDENTIALS',
          error: 'Incorrect password',
        }, { kind: 'invalid_credentials' });
      }

      return createResponse(200, {
        auth: clientConfig,
        authenticated: true,
        ok: true,
      }, {
        kind: 'session_created',
        setCookie: sessionCookieManager.createSessionCookie(req, {
          authenticatedAt: Date.now(),
          strategy: AUTH_STRATEGY_PASSWORD,
        }),
      });
    },

    getStatus(req) {
      return createResponse(200, {
        authenticated: hasValidSession(req),
        auth: clientConfig,
      }, { kind: 'status' });
    },

    isAuthenticated(req) {
      return hasValidSession(req);
    },
  };
}

function createNoneStrategy(clientConfig) {
  return {
    createSession() {
      return createResponse(405, { error: 'Authentication is disabled' }, { kind: 'disabled' });
    },

    getStatus() {
      return createResponse(200, {
        authenticated: true,
        auth: clientConfig,
      }, { kind: 'status' });
    },

    isAuthenticated() {
      return true;
    },
  };
}

function createOidcStrategy(clientConfig, sessionCookieManager) {
  return {
    createSession() {
      return createResponse(501, {
        auth: clientConfig,
        code: 'AUTH_NOT_IMPLEMENTED',
        error: 'OIDC authentication is not implemented yet',
      }, { kind: 'not_implemented' });
    },

    getStatus() {
      return createResponse(200, {
        authenticated: false,
        auth: clientConfig,
      }, { kind: 'status' });
    },

    isAuthenticated(req) {
      return sessionCookieManager.readSession(req)?.strategy === AUTH_STRATEGY_OIDC;
    },
  };
}

export function createAuthService(config) {
  const authConfig = config.auth ?? { strategy: AUTH_STRATEGY_NONE };
  const clientConfig = buildClientConfig(authConfig);
  const sessionCookieManager = createSessionCookieManager({
    cookieName: authConfig.sessionCookieName,
    secret: authConfig.sessionSecret,
  });

  let strategy;
  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    strategy = createPasswordStrategy(authConfig, sessionCookieManager, clientConfig);
  } else if (authConfig.strategy === AUTH_STRATEGY_OIDC) {
    strategy = createOidcStrategy(clientConfig, sessionCookieManager);
  } else {
    strategy = createNoneStrategy(clientConfig);
  }

  return {
    authorizeApiRequest(req) {
      if (strategy.isAuthenticated(req)) {
        return { ok: true };
      }

      return {
        body: createUnauthorizedBody(clientConfig),
        ok: false,
        statusCode: 401,
      };
    },

    authorizeWebSocketRequest(req) {
      if (strategy.isAuthenticated(req)) {
        return { ok: true };
      }

      return {
        body: 'Authentication required',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
        ok: false,
        statusCode: 401,
        statusMessage: 'Unauthorized',
      };
    },

    clearSession(req) {
      return createResponse(200, { ok: true }, {
        kind: 'logout_ok',
        setCookie: sessionCookieManager.clearSession(req),
      });
    },

    createSession(req, body) {
      return strategy.createSession(req, body);
    },

    getClientConfig() {
      return clientConfig;
    },

    getStartupInfo() {
      return {
        generatedPassword: authConfig.generatedPassword || '',
        password: authConfig.password || '',
        passwordWasGenerated: Boolean(authConfig.passwordWasGenerated),
        strategy: authConfig.strategy,
      };
    },

    getStatus(req) {
      return strategy.getStatus(req);
    },
  };
}
