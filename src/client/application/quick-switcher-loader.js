export async function ensureQuickSwitcherInstance(host) {
  if (host.quickSwitcher) {
    return host.quickSwitcher;
  }

  if (!host.quickSwitcherModulePromise) {
    host.quickSwitcherModulePromise = host.loadQuickSwitcherController();
  }

  let QuickSwitcherController;
  try {
    QuickSwitcherController = await host.quickSwitcherModulePromise;
  } catch (error) {
    host.quickSwitcherModulePromise = null;
    console.error('[quick-switcher] Failed to load file search.', error);
    host.toastController?.show?.('Failed to load file search. Try again.', {
      dismissible: true,
    });
    throw error;
  }

  if (!host.quickSwitcher) {
    host.quickSwitcher = new QuickSwitcherController({
      getFileList: () => host.fileExplorer.flatFiles,
      onFileSelect: (filePath) => host.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
    });
  }

  return host.quickSwitcher;
}

export async function toggleQuickSwitcherInstance(host) {
  try {
    const quickSwitcher = await ensureQuickSwitcherInstance(host);
    quickSwitcher.toggle();
  } catch {
    // ensureQuickSwitcherInstance reports the load failure and resets the cached import.
  }
}
