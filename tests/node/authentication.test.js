import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  createAuthService,
} from '../../src/server/auth/create-auth-service.js';
import { loadConfig } from '../../src/server/config/env.js';

function withAuthEnvCleared(fn) {
  const previousStrategy = process.env.AUTH_STRATEGY;
  const previousPassword = process.env.AUTH_PASSWORD;

  delete process.env.AUTH_STRATEGY;
  delete process.env.AUTH_PASSWORD;

  try {
    return fn();
  } finally {
    if (previousStrategy === undefined) {
      delete process.env.AUTH_STRATEGY;
    } else {
      process.env.AUTH_STRATEGY = previousStrategy;
    }

    if (previousPassword === undefined) {
      delete process.env.AUTH_PASSWORD;
    } else {
      process.env.AUTH_PASSWORD = previousPassword;
    }
  }
}

test('loadConfig defaults auth to none', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_NONE);
  assert.equal(config.auth.password, '');
}));

test('password auth generates a password when one is not provided', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    auth: {
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_PASSWORD);
  assert.equal(typeof config.auth.password, 'string');
  assert.equal(config.auth.password.length > 0, true);
  assert.equal(config.auth.passwordWasGenerated, true);
}));

test('oidc auth is reserved in config and marked not implemented in client config', () => {
  const config = loadConfig({
    auth: {
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  assert.equal(authService.getClientConfig().strategy, AUTH_STRATEGY_OIDC);
  assert.equal(authService.getClientConfig().implemented, false);
});

test('password auth returns transport-agnostic session results and API authorization decisions', () => {
  const config = loadConfig({
    auth: {
      password: 'shared-secret',
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);
  const request = {
    headers: {},
  };

  const missingPassword = authService.createSession(request, {});
  assert.equal(missingPassword.statusCode, 400);
  assert.equal(missingPassword.body.error, 'Missing password');
  assert.equal(missingPassword.setCookie, null);

  const unauthorized = authService.authorizeApiRequest(request);
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, 'AUTH_REQUIRED');

  const sessionResult = authService.createSession(request, {
    password: 'shared-secret',
  });
  assert.equal(sessionResult.statusCode, 200);
  assert.equal(sessionResult.body.ok, true);
  assert.equal(typeof sessionResult.setCookie, 'string');

  const authorizedRequest = {
    headers: {
      cookie: sessionResult.setCookie,
    },
  };
  assert.deepEqual(authService.authorizeApiRequest(authorizedRequest), { ok: true });
});

test('loadConfig rejects unsupported auth strategies', () => {
  assert.throws(() => {
    loadConfig({
      auth: {
        strategy: 'saml',
      },
      vaultDir: process.cwd(),
    });
  }, /Unsupported auth strategy/);
});
