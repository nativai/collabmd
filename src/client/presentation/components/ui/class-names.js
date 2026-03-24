export function classNames(...parts) {
  const tokens = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (Array.isArray(part)) {
      const nested = classNames(...part);
      if (nested) {
        tokens.push(nested);
      }
      continue;
    }

    if (typeof part === 'object') {
      Object.entries(part).forEach(([className, enabled]) => {
        if (enabled) {
          tokens.push(className);
        }
      });
      continue;
    }

    tokens.push(String(part));
  }

  return tokens.join(' ');
}
