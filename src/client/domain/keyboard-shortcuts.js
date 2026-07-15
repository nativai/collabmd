export function isPlainQuickSwitcherShortcut(event) {
  if (!event || event.repeat || (!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey) {
    return false;
  }

  const key = String(event.key ?? '').toLowerCase();
  return key === 'k' || event.code === 'KeyK';
}

// ⌘/Ctrl+P — focus the inline tree search box ("go to file in this pane"), so the rail filter
// is keyboard-reachable without the mouse (DESIGN §5).
export function isInlineSearchFocusShortcut(event) {
  if (!event || event.repeat || (!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey) {
    return false;
  }

  const key = String(event.key ?? '').toLowerCase();
  return key === 'p' || event.code === 'KeyP';
}

// ⌘/Ctrl+Shift+E — reveal the active file in the tree, re-expanding + centering its row
// (DESIGN §6.1), for after you've scrolled or collapsed away.
export function isRevealActiveFileShortcut(event) {
  if (!event || event.repeat || (!event.metaKey && !event.ctrlKey) || !event.shiftKey || event.altKey) {
    return false;
  }

  const key = String(event.key ?? '').toLowerCase();
  return key === 'e' || event.code === 'KeyE';
}
