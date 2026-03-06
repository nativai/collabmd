import { test, expect } from '@playwright/test';
import { resetE2EVaultSnapshot } from './helpers/vault-snapshot.js';

test.beforeEach(async () => {
  await resetE2EVaultSnapshot();
});

async function waitForEditor(page) {
  await expect(page.locator('.cm-editor')).toBeVisible();
}

async function openFile(page, filePath) {
  await page.goto(`/#file=${encodeURIComponent(filePath)}`);
  await waitForEditor(page);
}

async function appendEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(content, { delay: 5 });
}

async function replaceEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(content);
}

async function waitForHeavyPreviewContent(page) {
  await page.waitForFunction(() => {
    const preview = document.getElementById('previewContent');
    return preview && (
      preview.querySelector('.mermaid-shell')
      || preview.querySelector('.mermaid svg')
      || preview.querySelector('.excalidraw-embed-placeholder')
      || preview.querySelector('.excalidraw-embed iframe')
    );
  }, { timeout: 60000 });
}

async function getHeavyPreviewCounts(page) {
  return page.evaluate(() => ({
    excalidrawIframes: document.querySelectorAll('#previewContent .excalidraw-embed iframe').length,
    excalidrawPlaceholders: document.querySelectorAll('#previewContent .excalidraw-embed-placeholder').length,
    mermaidShells: document.querySelectorAll('#previewContent .mermaid-shell').length,
    mermaidSvgs: document.querySelectorAll('#previewContent .mermaid svg').length,
    renderPhase: document.getElementById('previewContent')?.dataset.renderPhase || '',
  }));
}

function createLongMarkdownDocument(lineCount = 80) {
  const lines = ['# Follow Target', ''];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(`Line ${index} for follow testing.`);
  }

  return lines.join('\n');
}

function createScrollSyncRegressionDocument(itemCount = 80) {
  const lines = [
    '# Scroll Sync Regression',
    '',
    '## First section',
    '',
  ];

  for (let index = 1; index <= itemCount; index += 1) {
    lines.push(`- First section item ${index}.`);
  }

  lines.push('', '## Second section', '');

  for (let index = 1; index <= itemCount; index += 1) {
    const suffix = index === 52 ? ' sync target.' : '.';
    lines.push(`- Second section item ${index}${suffix}`);
  }

  return lines.join('\n');
}

test('shows empty state when no file is selected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Select a file');
});

test('sidebar shows vault file tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#fileTree')).toContainText('README');
});

test('renders markdown preview when a file is opened', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');
});

test('escapes raw html in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Safe Preview\n\n<script>window.__collabmdXss = true</script>\n<div id="raw-html">inline html</div>');

  await expect(page.locator('#previewContent script')).toHaveCount(0);
  await expect(page.locator('#previewContent #raw-html')).toHaveCount(0);
  await expect(page.locator('#previewContent')).toContainText('<script>window.__collabmdXss = true</script>');
});

test('opens a file by clicking the sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();

  // Click on README in the file tree
  await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();

  await waitForEditor(page);
  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#activeFileName')).toContainText('README');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(pageA, '# Shared Draft\n\nUpdated from browser A.');

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');

  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('keeps preview and outline aligned when scrolling list-heavy editor content', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, createScrollSyncRegressionDocument());
  await expect(page.locator('#previewContent')).toContainText('Second section item 80.');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  const targetEditorLine = page.locator('.cm-line', { hasText: 'Second section item 52 sync target.' }).first();
  await targetEditorLine.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });

  await expect.poll(async () => {
    const activeItem = page.locator('#outlineNav .outline-item.active').first();
    return activeItem.textContent();
  }).toContain('Second section');

  const targetPreviewOffset = await page.locator('#previewContent li', { hasText: 'Second section item 52 sync target.' }).evaluate((item) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Math.abs(itemRect.top - containerRect.top);
  });

  expect(targetPreviewOffset).toBeLessThan(220);
});

test('scrolls the editor to the selected heading when navigating from the outline', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, createScrollSyncRegressionDocument());
  await expect(page.locator('#previewContent')).toContainText('Second section item 80.');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();
  await page.locator('#outlineNav .outline-item', { hasText: 'Second section' }).click();

  const editorHeadingOffset = await page.locator('.cm-line', { hasText: '## Second section' }).first().evaluate((line) => {
    const scroller = document.querySelector('.cm-scroller');
    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return Math.abs(lineRect.top - scrollerRect.top);
  });

  expect(editorHeadingOffset).toBeLessThan(220);

  const previewHeadingOffset = await page.locator('#previewContent h2', { hasText: 'Second section' }).evaluate((heading) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  });

  expect(previewHeadingOffset).toBeLessThan(220);
  await expect(page.locator('#outlineNav .outline-item.active').first()).toHaveText('Second section');
});

test('keeps the outline open on desktop after selecting a section', async ({ page }) => {
  await openFile(page, 'README.md');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

  await expect(page.locator('#outlinePanel')).toBeVisible();
});

test('keeps the editor interactive before heavy preview reaches ready', async ({ page }) => {
  test.slow();

  await page.goto(`/#file=${encodeURIComponent('full-markdown.md')}`);
  await waitForEditor(page);

  const phase = await page.locator('#previewContent').getAttribute('data-render-phase');
  expect(phase).not.toBe('ready');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');
});

test('progressively hydrates heavy preview instead of rendering all embeds at once', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  await waitForHeavyPreviewContent(page);

  const counts = await getHeavyPreviewCounts(page);
  expect(counts.mermaidShells + counts.mermaidSvgs).toBeGreaterThan(0);
  expect(counts.excalidrawPlaceholders + counts.excalidrawIframes).toBeGreaterThan(0);
  expect(counts.mermaidSvgs).toBeLessThan(1431);
  expect(counts.excalidrawIframes).toBeLessThan(159);
});

test('preserves excalidraw iframe instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  const firstPlaceholder = page.locator('#previewContent .excalidraw-embed-placeholder').first();
  await firstPlaceholder.scrollIntoViewIfNeeded();
  await firstPlaceholder.locator('.excalidraw-embed-placeholder-btn').click();

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const firstInstanceId = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id');
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id')
  ), { timeout: 60000 }).toBe(firstInstanceId);
});

test('hydrates more mermaid and excalidraw content as the heavy preview scrolls', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  await waitForHeavyPreviewContent(page);

  const before = await getHeavyPreviewCounts(page);

  await page.locator('#previewContainer').evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.5;
  });
  await page.waitForTimeout(3000);

  const middle = await getHeavyPreviewCounts(page);

  await page.locator('#previewContainer').evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.85;
  });
  await page.waitForTimeout(3000);

  const after = await getHeavyPreviewCounts(page);
  const mermaidIncreased = middle.mermaidSvgs > before.mermaidSvgs || after.mermaidSvgs > middle.mermaidSvgs;
  const excalidrawIncreased = middle.excalidrawIframes > before.excalidrawIframes || after.excalidrawIframes > middle.excalidrawIframes;

  expect(mermaidIncreased || excalidrawIncreased).toBeTruthy();
});

test.describe('mobile outline', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the outline after selecting a section on mobile', async ({ page }) => {
    await openFile(page, 'README.md');

    await page.locator('#mobileViewToggle').click();

    await expect(page.locator('#outlineToggle')).toBeVisible();
    await page.locator('#outlineToggle').click();

    await expect(page.locator('#outlinePanel')).toBeVisible();
    await expect(page.locator('#outlineNav')).toContainText('My Vault');
    await expect(page.locator('#outlineNav')).toContainText('Links');

    await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

    await expect(page.locator('#outlinePanel')).toBeHidden();
  });
});

test.describe('mobile sidebar', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the sidebar when tapping close button on mobile', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('#sidebar');
    if (await sidebar.isHidden()) {
      await page.locator('#sidebarToggle').click();
    }
    await expect(sidebar).toBeVisible();

    await page.locator('#sidebarClose').click();

    await expect(sidebar).toBeHidden();
  });

  test('closes the sidebar after selecting a file on mobile', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('#sidebar');
    if (await sidebar.isHidden()) {
      await page.locator('#sidebarToggle').click();
    }
    await expect(sidebar).toBeVisible();
    await expect(page.locator('#fileTree')).toContainText('README');

    await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();

    await waitForEditor(page);
    await expect(sidebar).toBeHidden();
  });
});
