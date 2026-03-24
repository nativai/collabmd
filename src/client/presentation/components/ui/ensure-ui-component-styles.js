let uiComponentStylesPromise = null;

export function ensureUiComponentStyles() {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }

  if (!uiComponentStylesPromise) {
    uiComponentStylesPromise = Promise.all([
      import('../../../styles/primitives/controls.css'),
      import('../../../styles/components/actions.css'),
      import('../../../styles/components/navigation.css'),
      import('../../../styles/components/states.css'),
    ]).then(() => undefined);
  }

  return uiComponentStylesPromise;
}
