import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { GitHubAppClient } from '../../src/server/infrastructure/github/github-app-client.js';

function createPrivateKey() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  });
}

function createJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('GitHubAppClient resolves a single selected repository from an installation', async () => {
  const calls = [];
  const client = new GitHubAppClient({
    apiBaseUrl: 'https://github.example/api',
    appId: '1234',
    privateKey: createPrivateKey(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ options, url });
      if (url.endsWith('/app/installations/99')) {
        assert.match(options.headers.Authorization, /^Bearer /u);
        return createJsonResponse({
          account: { login: 'example-org' },
        });
      }
      if (url.endsWith('/app/installations/99/access_tokens')) {
        assert.equal(options.method, 'POST');
        assert.match(options.headers.Authorization, /^Bearer /u);
        return createJsonResponse({
          token: 'installation-token',
        });
      }
      if (url.endsWith('/installation/repositories')) {
        assert.equal(options.headers.Authorization, 'Bearer installation-token');
        return createJsonResponse({
          repositories: [
            {
              default_branch: 'main',
              full_name: 'example-org/docs',
              id: 12345,
              name: 'docs',
              owner: { login: 'example-org' },
              private: true,
              visibility: 'private',
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await client.resolveVaultSourceFromInstallation('99');

  assert.equal(result.installation.id, '99');
  assert.equal(result.installation.accountLogin, 'example-org');
  assert.deepEqual(result.repository, {
    defaultBranch: 'main',
    fullName: 'example-org/docs',
    id: '12345',
    name: 'docs',
    owner: 'example-org',
    visibility: 'private',
  });
  assert.equal(calls.length, 3);
});

test('GitHubAppClient rejects installations that expose multiple repositories', async () => {
  const client = new GitHubAppClient({
    appId: '1234',
    privateKey: createPrivateKey(),
    fetchImpl: async (url) => {
      if (url.includes('/access_tokens')) {
        return createJsonResponse({ token: 'installation-token' });
      }
      if (url.endsWith('/installation/repositories')) {
        return createJsonResponse({
          repositories: [{ id: 1 }, { id: 2 }],
        });
      }
      return createJsonResponse({
        account: { login: 'example-org' },
      });
    },
  });

  await assert.rejects(
    () => client.resolveVaultSourceFromInstallation('99'),
    /exactly one selected repository/u,
  );
});
