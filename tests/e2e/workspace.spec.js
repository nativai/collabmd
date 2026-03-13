import {
  expect,
  openFile,
  openHome,
  openSampleFull,
  replaceEditorContent,
  test,
  waitForEditor,
  waitForHeavyPreviewContent,
  appendEditorContent,
} from './helpers/app-fixture.js';

test('shows empty state when no file is selected', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Welcome to CollabMD');
});

test('prompts first-time visitors for a display name', async ({ browser }) => {
  const page = await browser.newPage();

  await page.goto('/');

  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await expect(page.locator('#displayNameTitle')).toHaveText('Choose your display name');
  await expect(page.locator('#displayNameCopy')).toContainText('continue as a guest');
  await expect(page.locator('#displayNameCancel')).toHaveText('Skip for now');
  await expect(page.locator('#displayNameInput')).toHaveValue('');

  await page.locator('#displayNameCancel').click();
  await expect(page.locator('#displayNameDialog')).not.toBeVisible();
  await expect.poll(async () => (
    page.evaluate(() => window.localStorage.getItem('collabmd-user-name'))
  )).toBeNull();

  await page.close();
});

test('sidebar shows vault file tree', async ({ page }) => {
  await openHome(page);
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

  await replaceEditorContent(page, '# Safe Preview\n\nLine one<br>Line two\n\n<script>window.__collabmdXss = true</script>\n<div id="raw-html">inline html</div>');

  await expect(page.locator('#previewContent script')).toHaveCount(0);
  await expect(page.locator('#previewContent #raw-html')).toHaveCount(0);
  await expect(page.locator('#previewContent p').first()).toHaveText('Line oneLine two');
  await expect(page.locator('#previewContent p').first().locator('br')).toHaveCount(1);
  await expect(page.locator('#previewContent')).toContainText('<script>window.__collabmdXss = true</script>');
});

test('opens a file by clicking the sidebar', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-dir', { hasText: 'projects' }).first().click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'collabmd' }).first().click();

  await waitForEditor(page);
  await expect(page.locator('#previewContent')).toContainText('CollabMD Project');
  await expect(page.locator('#activeFileName')).toContainText('collabmd');
});

test('creates files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFileBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');

  await page.locator('#fileActionInput').fill('plans/q1-roadmap');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('q1-roadmap');
  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('q1-roadmap');
});

test('creates empty folders from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFolderBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();

  await page.locator('#fileActionInput').fill('plans/archive');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('archive');
});

test('creates files inside a folder from the tree context menu', async ({ page }) => {
  await openHome(page);

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New markdown file' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toContainText('Parent folder: daily');
  await page.locator('#fileActionInput').fill('meeting-notes');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('meeting-notes');
  await expect(page.locator('#fileTree')).toContainText('daily');
  await expect(page.locator('#fileTree')).toContainText('meeting-notes');
});

test('creates root files from empty tree space context menu', async ({ page }) => {
  await openHome(page);

  await page.locator('#fileSearchInput').fill('zzzz-no-match');
  await expect(page.locator('#fileTree')).toContainText('No matches');

  await page.locator('#fileTree').click({ button: 'right', position: { x: 24, y: 24 } });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New PlantUML diagram' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toHaveAttribute('hidden', '');
  await page.locator('#fileActionInput').fill('quick-diagram');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('quick-diagram');

  await page.locator('#fileSearchInput').fill('');
  await expect(page.locator('#fileTree')).toContainText('quick-diagram');
});

test('renames and deletes files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFileBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await page.locator('#fileActionInput').fill('scratchpad');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  const scratchpadItem = page.locator('#fileTree .file-tree-item', { hasText: 'scratchpad' }).first();
  await scratchpadItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionLabel')).toHaveText('Name');
  await page.locator('#fileActionInput').fill('release-notes');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#activeFileName')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).not.toContainText('scratchpad');

  const renamedItem = page.locator('#fileTree .file-tree-item', { hasText: 'release-notes' }).first();
  await renamedItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionField')).toHaveAttribute('hidden', '');
  await expect(page.locator('#fileActionNote')).toContainText('release-notes.md');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#fileTree')).not.toContainText('release-notes');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('redundant hashchange events do not reopen the same markdown file into overlapping sessions', async ({ page }) => {
  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  await page.evaluate(() => {
    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });

  await waitForEditor(page);
  await appendEditorContent(page, 'hashchange marker');

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=sample-full.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toContain('hashchange marker');

  const persistedContent = await page.evaluate(async () => {
    const response = await fetch('/api/file?path=sample-full.md');
    const data = await response.json();
    return data.content || '';
  });

  expect((persistedContent.match(/hashchange marker/g) || []).length).toBe(1);
  expect((persistedContent.match(/CollabMD — Technical Design Document/g) || []).length).toBe(1);
});
