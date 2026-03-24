import { classNames } from './class-names.js';

/**
 * @param {{ pill?: boolean, hidden?: boolean, extra?: string|string[] }} [options]
 * @returns {string}
 */
export function segmentedControlClassNames(options = {}) {
  return classNames(
    'ui-segmented-control',
    {
      'ui-segmented-control--pill': options.pill,
      hidden: options.hidden,
    },
    options.extra ?? [],
  );
}

/**
 * @param {{ active?: boolean, hidden?: boolean, extra?: string|string[] }} [options]
 * @returns {string}
 */
export function segmentedButtonClassNames(options = {}) {
  return classNames(
    'ui-segmented-btn',
    {
      active: options.active,
      hidden: options.hidden,
    },
    options.extra ?? [],
  );
}
