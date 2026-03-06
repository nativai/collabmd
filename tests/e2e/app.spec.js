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

async function openChat(page) {
  await page.locator('#chatToggleBtn').click();
  await expect(page.locator('#chatPanel')).toBeVisible();
}

async function sendChatMessage(page, message) {
  await openChat(page);
  await page.locator('#chatInput').fill(message);
  await page.locator('#chatForm').getByRole('button', { name: 'Send' }).click();
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

async function getVisibleEditorLineNumbers(page) {
  return page.evaluate(() => (
    Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
      .map((element) => Number.parseInt(element.textContent || '', 10))
      .filter((lineNumber) => Number.isFinite(lineNumber))
  ));
}

async function getPreviewHeadingOffset(page, sourceLine) {
  return page.evaluate((line) => {
    const container = document.getElementById('previewContainer');
    const heading = document.querySelector(`#previewContent h2[data-source-line="${line}"]`);
    if (!container || !heading) {
      return Number.POSITIVE_INFINITY;
    }

    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  }, sourceLine);
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

test('opens excalidraw files with a direct iframe preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-item', { hasText: 'system-architecture' }).first().click();

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /file=system-architecture\.excalidraw/);
  await expect(page.locator('#previewContent .excalidraw-embed-label')).toHaveText('system-architecture');
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
  await expect(page.locator('#editorPane')).not.toBeVisible();
  await expect(page.locator('#backlinksPanel')).toHaveClass(/hidden/);

  const initialWidths = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('#previewContent .excalidraw-embed');
    if (!container || !embed) {
      return null;
    }

    return {
      containerWidth: container.getBoundingClientRect().width,
      embedWidth: embed.getBoundingClientRect().width,
    };
  });
  expect(initialWidths).not.toBeNull();
  expect(initialWidths.embedWidth).toBeGreaterThan(initialWidths.containerWidth - 48);

  await page.locator('#previewContent .excalidraw-embed-btn', { hasText: 'Max' }).click();
  await expect(page.locator('#previewContent .excalidraw-embed')).toHaveClass(/is-maximized/);

  const maximizedWidths = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('#previewContent .excalidraw-embed.is-maximized');
    if (!container || !embed) {
      return null;
    }

    return {
      containerWidth: container.getBoundingClientRect().width,
      embedWidth: embed.getBoundingClientRect().width,
    };
  });
  expect(maximizedWidths).not.toBeNull();
  expect(maximizedWidths.embedWidth).toBeGreaterThan(maximizedWidths.containerWidth - 48);
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

test('syncs disposable lobby chat and tracks unread messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();

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

      addEventListener() {}

      close() {}
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

test('preserves Mermaid instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  await waitForHeavyPreviewContent(page);

  const mermaidKey = await page.evaluate(() => (
    document.querySelector('#previewContent .mermaid-shell')?.getAttribute('data-mermaid-key') || ''
  ));
  expect(mermaidKey).toBeTruthy();

  await page.evaluate((key) => {
    const shell = document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`);
    shell?.querySelector('.mermaid-placeholder-btn')?.click();
  }, mermaidKey);

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
    ), mermaidKey)
  ), { timeout: 60000 }).toMatch(/^\d+$/);

  const firstInstanceId = await page.evaluate((key) => (
    document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
  ), mermaidKey);
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
    ), mermaidKey)
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

test('defers heavy preview hydration while the editor is actively scrolling', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  await waitForHeavyPreviewContent(page);
  await expect.poll(async () => (
    page.locator('#previewContent').getAttribute('data-render-phase')
  ), { timeout: 60000 }).toBe('ready');

  const before = await getHeavyPreviewCounts(page);

  await page.locator('.cm-scroller').evaluate(async (scroller) => {
    await new Promise((resolve) => {
      let steps = 0;
      const timer = window.setInterval(() => {
        scroller.scrollTop += 320;
        steps += 1;
        if (steps >= 4) {
          window.clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  });

  const during = await getHeavyPreviewCounts(page);
  expect(during.mermaidSvgs).toBe(before.mermaidSvgs);
  expect(during.excalidrawIframes).toBe(before.excalidrawIframes);

  await page.waitForTimeout(500);

  const after = await getHeavyPreviewCounts(page);
  expect(after.mermaidSvgs >= during.mermaidSvgs).toBeTruthy();
  expect(after.excalidrawIframes >= during.excalidrawIframes).toBeTruthy();
});

test('keeps editor, preview, and outline aligned in heavy documents after lazy hydration changes layout', async ({ page }) => {
  test.slow();

  await openFile(page, 'full-markdown.md');
  await page.locator('#outlineToggle').click();

  const targetOutlineItem = page.locator('#outlineNav .outline-item[data-source-line="682"]').first();
  await expect(targetOutlineItem).toBeVisible({ timeout: 60000 });
  await targetOutlineItem.click();

  await page.waitForTimeout(1500);

  await expect.poll(async () => {
    const lineNumbers = await getVisibleEditorLineNumbers(page);
    return lineNumbers.includes(682);
  }, { timeout: 60000 }).toBeTruthy();

  await expect.poll(async () => (
    getPreviewHeadingOffset(page, 682)
  ), { timeout: 60000 }).toBeLessThan(260);
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
