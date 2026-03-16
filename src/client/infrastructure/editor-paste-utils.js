function extractPastedImageFile(event) {
  const clipboardFiles = Array.from(event?.clipboardData?.files ?? []);
  for (const file of clipboardFiles) {
    if (file?.type?.startsWith?.('image/')) {
      return file;
    }
  }

  const clipboardItems = Array.from(event?.clipboardData?.items ?? []);
  for (const item of clipboardItems) {
    if (item.kind !== 'file' || !item.type?.startsWith?.('image/')) {
      continue;
    }

    const file = item.getAsFile?.();
    if (file) {
      return file;
    }
  }

  return null;
}

export function handleImagePasteEvent(event, onImagePaste) {
  const imageFile = extractPastedImageFile(event);
  if (!imageFile) {
    return false;
  }

  if (typeof onImagePaste !== 'function') {
    console.warn('[editor] Ignoring pasted image because no image paste handler is registered.');
    return false;
  }

  console.debug('[editor] Detected pasted image.', {
    name: imageFile.name ?? '',
    size: imageFile.size ?? null,
    type: imageFile.type ?? '',
  });
  event.preventDefault?.();
  void Promise.resolve(onImagePaste(imageFile)).catch((error) => {
    console.error('[editor] Failed to process pasted image:', error);
  });
  return true;
}
