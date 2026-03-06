export function reconcileEmbedEntries(currentEntries, placeholderDescriptors) {
  const nextEntries = new Map();

  placeholderDescriptors.forEach((descriptor) => {
    const existing = currentEntries.get(descriptor.key);
    const entry = existing ?? {
      filePath: descriptor.filePath,
      iframe: null,
      instanceId: null,
      key: descriptor.key,
      label: descriptor.label,
      placeholder: descriptor.placeholder,
      queued: false,
      wrapper: null,
    };

    entry.filePath = descriptor.filePath;
    entry.key = descriptor.key;
    entry.label = descriptor.label;
    entry.placeholder = descriptor.placeholder;

    nextEntries.set(descriptor.key, entry);
  });

  const removedEntries = [];
  currentEntries.forEach((entry, key) => {
    if (!nextEntries.has(key)) {
      removedEntries.push(entry);
    }
  });

  return {
    nextEntries,
    removedEntries,
  };
}
