import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../../src/server/config/env.js';

test('loadConfig enables perf logging from COLLABMD_PERF_LOGGING', () => {
  const previousValue = process.env.COLLABMD_PERF_LOGGING;
  process.env.COLLABMD_PERF_LOGGING = '1';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.perfLoggingEnabled, true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_PERF_LOGGING;
    } else {
      process.env.COLLABMD_PERF_LOGGING = previousValue;
    }
  }
});

test('loadConfig enables wiki-link auto-create by default', () => {
  const previousValue = process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
  delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.wikiLinkAutoCreate, true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
    } else {
      process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = previousValue;
    }
  }
});

test('loadConfig disables wiki-link auto-create from COLLABMD_WIKI_LINK_AUTO_CREATE=false', () => {
  const previousValue = process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
  process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = 'false';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.wikiLinkAutoCreate, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
    } else {
      process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = previousValue;
    }
  }
});

test('loadConfig disables file watcher from COLLABMD_FILE_WATCHER_ENABLED=false', () => {
  const previousValue = process.env.COLLABMD_FILE_WATCHER_ENABLED;
  process.env.COLLABMD_FILE_WATCHER_ENABLED = 'false';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.fileWatcherEnabled, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_FILE_WATCHER_ENABLED;
    } else {
      process.env.COLLABMD_FILE_WATCHER_ENABLED = previousValue;
    }
  }
});
