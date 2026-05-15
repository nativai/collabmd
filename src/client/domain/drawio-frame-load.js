export function createDrawioFrameLoadPayload({
  currentTheme = 'dark',
  currentXml = '',
  isEditor = false,
  isExportImageMode = false,
} = {}) {
  const theme = currentTheme === 'light' ? 'simple' : 'dark';
  return {
    autosave: isEditor && !isExportImageMode ? 1 : 0,
    dark: currentTheme === 'dark' ? 1 : 0,
    modified: 'unsavedChanges',
    noExitBtn: 1,
    noSaveBtn: isExportImageMode ? 1 : (isEditor ? 0 : 1),
    saveAndExit: 0,
    theme,
    xml: String(currentXml || ''),
  };
}

export function createDrawioFrameLoadSignature(payload = {}) {
  return JSON.stringify({
    autosave: payload.autosave ?? 0,
    dark: payload.dark ?? 0,
    noSaveBtn: payload.noSaveBtn ?? 1,
    theme: payload.theme ?? 'dark',
    xml: String(payload.xml ?? ''),
  });
}
