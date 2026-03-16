import {
  createComment,
  createLongMarkdownDocument,
  clearReadmeCollaborationSidecars,
  dragEditorSelection,
  expect,
  README_TEST_DOCUMENT,
  openChat,
  openFile,
  replaceEditorContent,
  restoreReadmeTestDocument,
  restoreVaultFileFromTemplate,
  setEditorSelection,
  seedStoredUserName,
  sendChatMessage,
  stubPlantUmlRender,
  test,
  waitForCommentSelectionChip,
  waitForExcalidrawFrameHarness,
  waitForExcalidrawTestHarness,
} from './helpers/app-fixture.js';

function createSeededMultiplayerScene() {
  const timestamp = 1_710_000_000_000;

  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    appState: {
      gridSize: 20,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
    elements: [
      {
        id: 'table-shell',
        type: 'rectangle',
        x: 160,
        y: 120,
        width: 420,
        height: 220,
        angle: 0,
        strokeColor: '#1f2937',
        backgroundColor: '#f8fafc',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: { type: 3 },
        roughness: 0,
        opacity: 100,
        seed: 101,
        version: 11,
        versionNonce: 1001,
        index: 'a0',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-1',
        type: 'line',
        x: 300,
        y: 120,
        width: 0,
        height: 220,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 102,
        version: 11,
        versionNonce: 1002,
        index: 'a1',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [0, 220]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-2',
        type: 'line',
        x: 440,
        y: 120,
        width: 0,
        height: 220,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 103,
        version: 11,
        versionNonce: 1003,
        index: 'a2',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [0, 220]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-3',
        type: 'line',
        x: 160,
        y: 193,
        width: 420,
        height: 0,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 104,
        version: 11,
        versionNonce: 1004,
        index: 'a3',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [420, 0]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-4',
        type: 'line',
        x: 160,
        y: 266,
        width: 420,
        height: 0,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 105,
        version: 11,
        versionNonce: 1005,
        index: 'a4',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [420, 0]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-note',
        type: 'text',
        x: 205,
        y: 145,
        width: 154.078125,
        height: 25,
        angle: 0,
        strokeColor: '#0f172a',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 106,
        version: 11,
        versionNonce: 1006,
        index: 'a5',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
        fontSize: 20,
        fontFamily: 1,
        text: 'Quarterly pipeline',
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        originalText: 'Quarterly pipeline',
        autoResize: true,
        lineHeight: 1.25,
      },
      {
        id: 'status-pill',
        type: 'ellipse',
        x: 640,
        y: 175,
        width: 84,
        height: 84,
        angle: 0,
        strokeColor: '#2563eb',
        backgroundColor: '#bfdbfe',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 107,
        version: 11,
        versionNonce: 1007,
        index: 'a6',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
    ],
  };
}

async function seedExcalidrawMultiplayerScene(page) {
  const scene = createSeededMultiplayerScene();
  await page.evaluate((nextScene) => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(nextScene);
  }, scene);
  return scene;
}

async function getSceneElementIds(page) {
  return page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds());
}

async function getSceneElementCount(page) {
  return page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementCount());
}

async function getViewportElementCenter(page, elementId) {
  const bounds = await page.evaluate((id) => window.__COLLABMD_EXCALIDRAW_TEST__.getElementBounds(id), elementId);
  if (!bounds) {
    throw new Error(`Missing bounds for element ${elementId}`);
  }

  return {
    x: bounds.centerX ?? (bounds.x + (bounds.width / 2)),
    y: bounds.centerY ?? (bounds.y + (bounds.height / 2)),
  };
}

async function readExcalidrawFile(page, filePath) {
  return page.evaluate(async (path) => {
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      throw new Error(`Failed to read ${path}`);
    }

    return response.json();
  }, filePath);
}

test('allows explicit session takeover between tabs in the same browser context', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await openFile(pageA, 'README.md');
  await seedStoredUserName(pageB);
  await pageB.goto('/#file=README.md');

  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageB.locator('#tabLockTitle')).toHaveText('This vault is active in another tab');

  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageB.locator('.cm-editor')).toBeVisible();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageA.locator('#tabLockTitle')).toHaveText('This tab is no longer active');

  await replaceEditorContent(pageB, '# Takeover Owner\n\nOnly once.\n');

  await context.close();

  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto('/');
  await expect.poll(async () => {
    const fileData = await verifyPage.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      return response.json();
    });
    return fileData.content;
  }).toBe('# Takeover Owner\n\nOnly once.\n');

  await verifyContext.close();
});

test('direct Excalidraw fallback does not wipe live room state from another page', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#123456',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await pageA.waitForTimeout(150);

  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&syncTimeoutMs=0');
  await waitForExcalidrawTestHarness(pageB);

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#123456');

  await context.close();
});

test('direct Excalidraw follow tracks remote viewport updates', async ({ browser }) => {
  const context = await browser.newContext();
  const followerPage = await context.newPage();
  const targetPage = await context.newPage();

  await followerPage.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&userName=Follower');
  await targetPage.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&userName=Target');
  await waitForExcalidrawTestHarness(followerPage);
  await waitForExcalidrawTestHarness(targetPage);

  const targetPeerId = await targetPage.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalPeerId());

  await followerPage.evaluate((peerId) => {
    window.postMessage({
      source: 'collabmd-host',
      type: 'follow-user',
      peerId,
    }, window.location.origin);
  }, targetPeerId);

  await targetPage.evaluate(() => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setViewport({
      scrollX: 640,
      scrollY: 320,
      zoom: 1.6,
    });
  });

  await expect.poll(async () => (
    followerPage.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getViewport())
  )).toMatchObject({
    scrollX: 640,
    scrollY: 320,
    zoom: 1.6,
  });

  await context.close();
});

test('taking over an Excalidraw file tab preserves the live scene', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await seedStoredUserName(pageA);
  await seedStoredUserName(pageB);

  await pageA.goto('/?test=1#file=sample-excalidraw.excalidraw');
  const frameA = await waitForExcalidrawFrameHarness(pageA);
  await expect.poll(async () => (
    frameA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.isAuthoritativeReady())
  )).toBe(true);

  await frameA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#345678',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await expect.poll(async () => (
    frameA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#345678');

  await pageB.goto('/?test=1#file=sample-excalidraw.excalidraw');
  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();

  const frameB = await waitForExcalidrawFrameHarness(pageB);
  await expect.poll(async () => (
    frameB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#345678');

  await context.close();
});

test('local Excalidraw undo and redo sync the resulting scene to collaborators', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#111111',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#222222',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(true);
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(false);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');
  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');
  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canRedo)
  )).toBe(true);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');
  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await context.close();
});

test('local Excalidraw redo is dropped after local undo followed by a new local edit', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);

  await pageA.evaluate(() => {
    const base = {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [{
        id: 'shape-1',
        isDeleted: false,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
      }],
      files: {},
      source: 'collabmd',
      type: 'excalidraw',
      version: 2,
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(base);

    const withSecondShape = {
      ...base,
      elements: [
        ...base.elements,
        {
          id: 'shape-2',
          isDeleted: false,
          type: 'ellipse',
          x: 180,
          y: 0,
          width: 100,
          height: 80,
        },
      ],
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(withSecondShape);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds())
  )).toEqual(['shape-1', 'shape-2']);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds())
  )).toEqual(['shape-1']);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.elements = [
      ...(scene.elements || []),
      {
        id: 'shape-3',
        isDeleted: false,
        type: 'diamond',
        x: 320,
        y: 0,
        width: 100,
        height: 80,
      },
    ];
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds())
  )).toEqual(['shape-1', 'shape-3']);
  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canRedo)
  )).toBe(false);
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(false);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds())
  )).toEqual(['shape-1', 'shape-3']);

  await context.close();
});

test('local Excalidraw history resets after the room fully closes', async ({ browser }) => {
  const editContext = await browser.newContext();
  const pageA = await editContext.newPage();
  const pageB = await editContext.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);

  await pageA.evaluate(() => {
    const first = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    first.appState = {
      ...(first.appState || {}),
      viewBackgroundColor: '#111111',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(first);

    const second = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    second.appState = {
      ...(second.appState || {}),
      viewBackgroundColor: '#222222',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(second);
  });

  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(true);
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(false);

  await editContext.close();

  const reopenContext = await browser.newContext();
  const pageC = await reopenContext.newPage();

  await pageC.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageC);

  await expect.poll(async () => (
    pageC.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');
  await expect.poll(async () => (
    pageC.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState())
  )).toEqual({
    canRedo: false,
    canUndo: false,
    head: null,
    length: null,
  });

  await pageC.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageC.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await reopenContext.close();
});

test('keeps multiplayer Excalidraw scenes stable while one user drags and another user edits', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const expectedIds = [
    'table-shell',
    'table-divider-1',
    'table-divider-2',
    'table-divider-3',
    'table-divider-4',
    'table-note',
    'status-pill',
  ].sort();

  await restoreVaultFileFromTemplate(pageA, 'sample-excalidraw.excalidraw');
  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);
  await expect.poll(async () => ({
    idsA: await getSceneElementIds(pageA),
    idsB: await getSceneElementIds(pageB),
  })).toEqual({
    idsA: [],
    idsB: [],
  });

  await seedExcalidrawMultiplayerScene(pageA);

  await expect.poll(async () => getSceneElementIds(pageB)).toEqual(expectedIds);
  await expect.poll(async () => getSceneElementCount(pageA)).toBe(expectedIds.length);
  await expect.poll(async () => getSceneElementCount(pageB)).toBe(expectedIds.length);

  const dragStart = await getViewportElementCenter(pageA, 'table-shell');
  await pageA.mouse.move(dragStart.x, dragStart.y);
  await pageA.mouse.down();
  await pageA.mouse.move(dragStart.x + 160, dragStart.y + 90, { steps: 8 });

  await pageB.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#dbeafe',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => ({
    countA: await getSceneElementCount(pageA),
    countB: await getSceneElementCount(pageB),
    idsA: await getSceneElementIds(pageA),
    idsB: await getSceneElementIds(pageB),
  })).toEqual({
    countA: expectedIds.length,
    countB: expectedIds.length,
    idsA: expectedIds,
    idsB: expectedIds,
  });

  await pageA.mouse.up();

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#dbeafe');

  await expect.poll(async () => (
    (await readExcalidrawFile(pageA, 'sample-excalidraw.excalidraw')).content
  )).toContain('table-shell');
  const persistedScene = JSON.parse((await readExcalidrawFile(pageA, 'sample-excalidraw.excalidraw')).content);
  expect(persistedScene.elements.map((element) => element.id).sort()).toEqual(expectedIds);

  await context.close();
});

test('renaming in the app updates the mounted Excalidraw iframe user name', async ({ page }) => {
  await seedStoredUserName(page, 'Before Name');
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  const frame = await waitForExcalidrawFrameHarness(page, '#previewContent .excalidraw-embed iframe');
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('Before Name');

  await page.locator('#editNameBtn').click();
  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await page.locator('#displayNameInput').fill('After Name');
  await page.locator('#displayNameSubmit').click();

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('After Name');
});

test('renders comment controls for text files', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await expect(page.locator('#commentsToggle')).toBeVisible();
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('reveals a stable inline chip only after selection commit', async ({ page }) => {
  await openFile(page, 'README.md');

  await setEditorSelection(page, 'Welcome to the test vault');
  const chip = await waitForCommentSelectionChip(page);
  const firstBox = await chip.boundingBox();

  await setEditorSelection(page, 'Welcome to the test vault. This is the top-level readme.');
  const updatedChip = await waitForCommentSelectionChip(page);
  const secondBox = await updatedChip.boundingBox();

  expect(firstBox?.x).toBeTruthy();
  expect(secondBox?.x).toBeTruthy();
  expect(Math.abs((firstBox?.x ?? 0) - (secondBox?.x ?? 0))).toBeLessThanOrEqual(1);

  await setEditorSelection(page, 'Welcome to the test vault', { collapse: true });
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('focuses the comment textbox when opening the composer', async ({ page }) => {
  await openFile(page, 'README.md');

  await setEditorSelection(page, 'Welcome to the test vault');
  await (await waitForCommentSelectionChip(page)).click();
  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toBeFocused();
  await page.keyboard.type('inline');
  await expect(page.locator('.comment-card-input')).toHaveValue('inline');
  await expect(page.locator('.cm-content')).not.toContainText('inline');
  await page.locator('.comment-card').getByRole('button', { name: 'Cancel' }).click();

  await setEditorSelection(page, 'Welcome to the test vault. This is the top-level readme.', { collapse: true });
  await page.locator('#commentSelectionBtn').click();
  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toBeFocused();
  await page.keyboard.type('toolbar');
  await expect(page.locator('.comment-card-input')).toHaveValue('toolbar');
  await expect(page.locator('.cm-content')).not.toContainText('toolbar');
});

test('typing immediately after opening a multiline comment goes into the composer', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, createLongMarkdownDocument(20));

  await setEditorSelection(page, 'Line 1 for follow testing.\nLine 2 for follow testing.\nLine 3 for follow testing.');
  await (await waitForCommentSelectionChip(page)).click();
  await page.keyboard.type('multiline');

  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toHaveValue('multiline');
  await expect(page.locator('.cm-content')).not.toContainText('multiline');
});

test('keeps the inline chip hidden during pointer drag and hides it when scrolled out of view', async ({ page }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md');
  await expect(page.locator('.cm-editor')).toContainText('Welcome to the test vault');

  await dragEditorSelection(page, 'Welcome to the test vault');
  await expect(page.locator('.comment-selection-chip')).toBeHidden();

  await page.mouse.up();
  await waitForCommentSelectionChip(page);

  await replaceEditorContent(page, createLongMarkdownDocument(180));
  await setEditorSelection(page, 'Line 1 for follow testing.');
  await waitForCommentSelectionChip(page);

  await page.locator('.cm-scroller').evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight });
  });
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('creates and syncs a line comment across collaborators', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(pageA, {
    body: 'Please tighten this intro.',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await expect(pageA.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('#previewContent .comment-preview-badge')).toHaveCount(1);

  await pageB.locator('#commentsToggle').click();
  await expect(pageB.locator('#commentsDrawer')).toBeVisible();
  await pageB.locator('#previewContent .comment-preview-badge').click();
  await expect(pageB.locator('.comment-card')).toContainText('Please tighten this intro.');

  await pageA.close();
  await pageB.close();
});

test('renders icon-based thread markers with counts for grouped comments', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'First grouped comment',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await createComment(page, {
    body: 'Second grouped comment',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  const editorBadge = page.locator('.comment-editor-badge[data-count="2"]').first();
  const previewBadge = page.locator('#previewContent .comment-preview-badge[aria-label="2 comment threads"]').first();

  await expect(editorBadge.locator('.comment-marker-icon')).toBeVisible();
  await expect(editorBadge.locator('.comment-marker-count')).toHaveText('2');
  await expect(previewBadge.locator('.comment-marker-icon')).toBeVisible();
  await expect(previewBadge.locator('.comment-marker-count')).toHaveText('2');
});

test('keeps reply action aligned by using an active Reply toggle state', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'Please clarify this section.',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  const replyButton = page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first();

  await expect(replyButton).toHaveText('Reply');
  await replyButton.click();
  await expect(replyButton).toHaveText('Reply');
  await expect(replyButton).toHaveClass(/is-active/);
  await expect(page.locator('.comment-reply-form')).toBeVisible();
});

test('creates a selected-text comment and surfaces it in the preview bubble card', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'This phrase should stay visible in preview.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await expect(page.locator('#previewContent .comment-preview-highlight')).toHaveCount(1);
  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  await expect(page.locator('.comment-card')).toContainText('Welcome to the test vault');
  await expect(page.locator('.comment-card')).toContainText('This phrase should stay visible in preview.');
});

test('renders multiline markdown comments with fenced code blocks in the thread card', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'First line\nSecond line\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();

  await expect(page.locator('.comment-message-card-body')).toContainText('First line');
  await expect(page.locator('.comment-message-card-body')).toContainText('Second line');
  await expect(page.locator('.comment-message-card-body pre code')).toContainText('const answer = 42;');
  await expect.poll(async () => (
    page.locator('.comment-message-card-body pre').evaluate((element) => getComputedStyle(element).overflowX)
  )).toBe('auto');
});

test('shows wrapped excerpts and the latest comment preview in the comments drawer', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Initial comment',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first().click();
  await page.locator('.comment-card-input').last().fill('Latest reply with\n\n- bullet one\n- bullet two');
  await page.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(page.locator('.comment-reply-form')).toBeHidden();

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await expect(page.locator('.comments-drawer-item-preview')).toContainText('Latest reply with');
  await expect(page.locator('.comments-drawer-item-preview')).toContainText('bullet one');
  await expect.poll(async () => (
    page.locator('.comments-drawer-item-quote').evaluate((element) => getComputedStyle(element).whiteSpace)
  )).toBe('pre-wrap');
});

test('keeps the refreshed comment card within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 780 });
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: '```js\nconst veryLongLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```\n\nLine one\nLine two\nLine three\nLine four\nLine five',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  await expect(page.locator('.comment-card-scroll')).toBeVisible();
  await expect.poll(async () => (
    page.locator('.comment-card-scroll').evaluate((element) => getComputedStyle(element).overflowY)
  )).toBe('auto');

  const box = await page.locator('.comment-card').boundingBox();
  expect(box).toBeTruthy();
  expect((box?.x ?? 0) >= 0).toBe(true);
  expect((box?.y ?? 0) >= 0).toBe(true);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(780);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
});

test('toggles a preset emoji reaction on a comment message', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Reaction ready',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-reaction-quick-add').filter({ hasText: '👍' }).first().click();

  const chip = page.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first();
  await expect(chip).toContainText('1');
  await expect(chip).toHaveClass(/is-active/);
  await expect(page.locator('.comment-reaction-quick-add').filter({ hasText: '👍' })).toHaveCount(0);

  await chip.click();
  await expect(page.locator('.comment-reaction-chip').filter({ hasText: '👍' })).toHaveCount(0);
});

test('supports reacting to reply messages through the extended reaction picker', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Initial comment',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first().click();
  await page.locator('.comment-card-input').last().fill('Reply with reaction');
  await page.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(page.locator('.comment-reply-form')).toBeHidden();

  const replyCard = page.locator('.comment-message-card').last();
  await replyCard.locator('.comment-reaction-more-trigger').click();
  await expect(replyCard.locator('.comment-reaction-picker')).toBeVisible();
  await replyCard.locator('.comment-reaction-picker-btn').filter({ hasText: '💡' }).click();

  const chip = replyCard.locator('.comment-reaction-chip').filter({ hasText: '💡' });
  await expect(chip).toContainText('1');
  await expect(chip).toHaveClass(/is-active/);
});

test('syncs reaction counts across collaborators while keeping active state local', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md', { userName: 'Andes A' });
  await openFile(pageB, 'README.md', { userName: 'Andes B' });
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(pageA, {
    body: 'Sync reaction',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  const openThread = async (targetPage) => {
    await targetPage.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]').first().click();
    await expect(targetPage.locator('.comment-card')).toBeVisible();
  };

  await openThread(pageA);
  await pageA.locator('.comment-reaction-quick-add').filter({ hasText: '👍' }).first().click();

  await openThread(pageB);
  const pageBChip = pageB.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first();
  await expect(pageBChip).toContainText('1');
  await expect(pageBChip).not.toHaveClass(/is-active/);

  await pageBChip.click();
  await expect(pageBChip).toContainText('2');
  await expect(pageBChip).toHaveClass(/is-active/);
  await expect(pageA.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first()).toContainText('2');

  await contextA.close();
  await contextB.close();
});

test('supports comments for Mermaid and PlantUML files', async ({ page }) => {
  await stubPlantUmlRender(page, 'commentable-plantuml');

  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await createComment(page, {
    body: 'Mermaid source comment',
    collapseSelection: true,
    targetText: 'flowchart TD',
  });
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(1);

  await openFile(page, 'sample-plantuml.puml');
  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await createComment(page, {
    body: 'PlantUML source comment',
    collapseSelection: true,
    targetText: '@startuml',
  });
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(1);
});

test('does not render comment UI controls for Excalidraw', async ({ page }) => {
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  await expect(page.locator('#commentSelectionBtn')).toBeHidden();
  await expect(page.locator('#commentsToggle')).toBeHidden();
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await pageA.locator('.cm-content').first().click();
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type('# Shared Draft\n\nUpdated from browser A.', { delay: 5 });

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('shows a foreground toast and stronger unread state for visible remote chat messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    window.__testNotifications = [];

    class TestNotification {
      static permission = 'granted';

      static async requestPermission() {
        return 'granted';
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__testNotifications.push({ title, ...options });
      }

      addEventListener() { }

      close() { }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: TestNotification,
    });
  });

  await openFile(pageA, 'README.md', { userName: 'Sender' });
  await openFile(pageB, 'README.md', { userName: 'Receiver' });

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toHaveText('Alerts on');
  await pageB.locator('#chatToggleBtn').click();

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  const chatToast = pageB.locator('#chatToastContainer .toast').filter({
    hasText: 'Sender: Quick sync: reviewing README right now.',
  }).first();
  await expect(chatToast).toBeVisible();
  await expect(chatToast).toContainText(
    'Sender: Quick sync: reviewing README right now.',
  );
  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');
  await expect(pageB.locator('#chatToggleBtn')).toHaveClass(/is-unread/);
  await expect.poll(async () => (
    pageB.evaluate(() => window.__testNotifications.length)
  )).toBe(0);

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();
  await expect(pageB.locator('#chatToggleBtn')).not.toHaveClass(/is-unread/);

  await pageA.close();
  await pageB.close();
});

test('shows a browser notification for a background chat message when alerts are enabled', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    window.__testNotifications = [];

    class TestNotification {
      static permission = 'granted';

      static async requestPermission() {
        return 'granted';
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__testNotifications.push({ title, ...options });
      }

      addEventListener() { }

      close() { }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: TestNotification,
    });
  });

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toHaveText('Alerts on');
  await pageB.locator('#chatToggleBtn').click();

  await pageB.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
  });

  await sendChatMessage(pageA, 'Background ping from README.');

  await expect.poll(async () => (
    pageB.evaluate(() => window.__testNotifications.length)
  )).toBe(1);

  const notification = await pageB.evaluate(() => window.__testNotifications[0]);
  expect(notification.title).toContain('CollabMD chat');
  expect(notification.body).toBe('README: Background ping from README.');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');

  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await replaceEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('pins and labels the current user in the header avatar list', async ({ browser }) => {
  const localPage = await browser.newPage();
  const remotePage = await browser.newPage();

  await openFile(localPage, 'README.md', { userName: 'Owner' });
  await openFile(remotePage, 'README.md', { userName: 'Teammate' });

  await expect(localPage.locator('#userCount')).toHaveText('2 online');

  const localAvatar = localPage.locator('#userAvatars > .user-avatar').first();
  await expect(localAvatar).toHaveClass(/is-local/);
  await expect(localAvatar).toContainText('You');
  await expect(localAvatar).toHaveAttribute('aria-label', /Owner \(you\) — README/);
  await expect(localPage.locator('#userAvatars .user-avatar-button')).toHaveCount(1);

  await localPage.close();
  await remotePage.close();
});
