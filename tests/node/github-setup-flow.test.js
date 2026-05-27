import test from 'node:test';
import assert from 'node:assert/strict';

import { createSignedCookieManager } from '../../src/server/auth/session-cookie.js';
import { GitHubSetupFlow } from '../../src/server/infrastructure/github/github-setup-flow.js';

function createRequest({ cookie = '' } = {}) {
  return {
    headers: cookie ? { cookie } : {},
  };
}

function createGithubSetupFlow() {
  const resolvedInstallations = [];
  return {
    flow: new GitHubSetupFlow({
      cookieManager: createSignedCookieManager({
        cookieName: 'collabmd_github_setup_flow',
        secret: 'test-secret',
      }),
      githubAppClient: {
        createInstallationSetupUrl({ state }) {
          const url = new URL('https://github.example/apps/collabmd-test/installations/new');
          url.searchParams.set('state', state);
          return url.href;
        },
        async resolveVaultSourceFromInstallation(installationId) {
          resolvedInstallations.push(installationId);
          return {
            installation: {
              accountLogin: 'example-org',
              id: installationId,
            },
            repository: {
              defaultBranch: 'main',
              fullName: 'example-org/docs',
              id: '12345',
              name: 'docs',
              owner: 'example-org',
              visibility: 'private',
            },
          };
        },
      },
    }),
    resolvedInstallations,
  };
}

test('GitHubSetupFlow completes only when the signed setup cookie and state match', async () => {
  const { flow, resolvedInstallations } = createGithubSetupFlow();
  const admin = { email: 'admin@example.com' };
  const setup = flow.begin(createRequest(), { admin });
  const cookie = setup.setCookie.split(';')[0];
  const state = new URL(setup.setupUrl).searchParams.get('state');

  const result = await flow.complete(
    createRequest({ cookie }),
    new URL(`https://notes.example.com/api/hosted/vault-source/github/callback?installation_id=98765&state=${encodeURIComponent(state)}`),
    { admin },
  );

  assert.equal(result.installationId, '98765');
  assert.equal(result.github.repository.fullName, 'example-org/docs');
  assert.deepEqual(resolvedInstallations, ['98765']);
});

test('GitHubSetupFlow rejects a callback with a mismatched state', async () => {
  const { flow, resolvedInstallations } = createGithubSetupFlow();
  const admin = { email: 'admin@example.com' };
  const setup = flow.begin(createRequest(), { admin });
  const cookie = setup.setCookie.split(';')[0];

  await assert.rejects(
    () => flow.complete(
      createRequest({ cookie }),
      new URL('https://notes.example.com/api/hosted/vault-source/github/callback?installation_id=98765&state=wrong'),
      { admin },
    ),
    {
      code: 'HOSTED_GITHUB_SETUP_STATE_MISMATCH',
      statusCode: 403,
    },
  );
  assert.deepEqual(resolvedInstallations, []);
});

test('GitHubSetupFlow rejects a callback completed by a different admin', async () => {
  const { flow, resolvedInstallations } = createGithubSetupFlow();
  const setup = flow.begin(createRequest(), { admin: { email: 'admin@example.com' } });
  const cookie = setup.setCookie.split(';')[0];
  const state = new URL(setup.setupUrl).searchParams.get('state');

  await assert.rejects(
    () => flow.complete(
      createRequest({ cookie }),
      new URL(`https://notes.example.com/api/hosted/vault-source/github/callback?installation_id=98765&state=${encodeURIComponent(state)}`),
      { admin: { email: 'other-admin@example.com' } },
    ),
    {
      code: 'HOSTED_GITHUB_SETUP_ADMIN_MISMATCH',
      statusCode: 403,
    },
  );
  assert.deepEqual(resolvedInstallations, []);
});
