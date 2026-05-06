export function buildReconciledExcalidrawSceneUpdate({
  appStateOverrides = {},
  currentAppState,
  currentElements = [],
  documentViewState = {},
  includeUnchangedAppState = false,
  reconcileElementsFn,
  restoreAppStateFn,
  restoreElementsFn,
  scene,
  theme = 'dark',
} = {}) {
  const restoredElements = restoreElementsFn(scene?.elements || [], currentElements, {
    repairBindings: true,
  });
  const restoredAppState = restoreAppStateFn(scene?.appState || {}, currentAppState);
  const nextAppState = {
    theme,
    viewBackgroundColor: restoredAppState.viewBackgroundColor ?? '#ffffff',
    gridSize: restoredAppState.gridSize ?? null,
    ...documentViewState,
    ...appStateOverrides,
  };
  const appStateUpdate = Object.fromEntries(
    Object.entries(nextAppState).filter(([key, value]) => (
      includeUnchangedAppState || currentAppState?.[key] !== value
    )),
  );
  const update = {
    elements: reconcileElementsFn(currentElements, restoredElements, currentAppState),
  };

  if (Object.keys(appStateUpdate).length > 0) {
    update.appState = appStateUpdate;
  }

  return update;
}
