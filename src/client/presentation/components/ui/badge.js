import { classNames } from './class-names.js';

/**
 * @param {{ tone?: 'accent'|'solid'|'muted'|'code', count?: boolean, hidden?: boolean, extra?: string|string[] }} [options]
 * @returns {string}
 */
export function badgeClassNames(options = {}) {
  const {
    tone = 'accent',
    count = false,
    hidden = false,
    extra = [],
  } = options;

  return classNames(
    'ui-pill-badge',
    tone && `ui-pill-badge--${tone}`,
    {
      'ui-pill-badge--count': count,
      hidden,
    },
    extra,
  );
}
