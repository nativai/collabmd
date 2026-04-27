export function isPlainQuickSwitcherShortcut(event) {
  if (!event || event.repeat || (!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey) {
    return false;
  }

  const key = String(event.key ?? '').toLowerCase();
  return key === 'k' || event.code === 'KeyK';
}
