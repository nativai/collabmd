import { classNames } from './class-names.js';

/**
 * @param {{ extra?: string|string[] }} [options]
 * @returns {string}
 */
export function inputClassNames(options = {}) {
  return classNames('ui-input', options.extra ?? []);
}
