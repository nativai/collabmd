import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDrawioFrameLoadPayload,
  createDrawioFrameLoadSignature,
} from '../../src/client/domain/drawio-frame-load.js';

test('draw.io frame load signatures are stable for unchanged XML, theme, and mode', () => {
  const payload = createDrawioFrameLoadPayload({
    currentTheme: 'dark',
    currentXml: '<mxfile><diagram /></mxfile>',
    isEditor: true,
    isExportImageMode: false,
  });

  assert.deepEqual(payload, {
    autosave: 1,
    dark: 1,
    modified: 'unsavedChanges',
    noExitBtn: 1,
    noSaveBtn: 0,
    saveAndExit: 0,
    theme: 'dark',
    xml: '<mxfile><diagram /></mxfile>',
  });
  assert.equal(
    createDrawioFrameLoadSignature(payload),
    createDrawioFrameLoadSignature(createDrawioFrameLoadPayload({
      currentTheme: 'dark',
      currentXml: '<mxfile><diagram /></mxfile>',
      isEditor: true,
      isExportImageMode: false,
    })),
  );
});

test('draw.io frame load signatures change only for reload-worthy inputs', () => {
  const baseSignature = createDrawioFrameLoadSignature(createDrawioFrameLoadPayload({
    currentTheme: 'dark',
    currentXml: '<mxfile><diagram id="one" /></mxfile>',
    isEditor: true,
    isExportImageMode: false,
  }));

  assert.notEqual(
    createDrawioFrameLoadSignature(createDrawioFrameLoadPayload({
      currentTheme: 'dark',
      currentXml: '<mxfile><diagram id="two" /></mxfile>',
      isEditor: true,
      isExportImageMode: false,
    })),
    baseSignature,
  );
  assert.notEqual(
    createDrawioFrameLoadSignature(createDrawioFrameLoadPayload({
      currentTheme: 'light',
      currentXml: '<mxfile><diagram id="one" /></mxfile>',
      isEditor: true,
      isExportImageMode: false,
    })),
    baseSignature,
  );
  assert.notEqual(
    createDrawioFrameLoadSignature(createDrawioFrameLoadPayload({
      currentTheme: 'dark',
      currentXml: '<mxfile><diagram id="one" /></mxfile>',
      isEditor: false,
      isExportImageMode: false,
    })),
    baseSignature,
  );
});
