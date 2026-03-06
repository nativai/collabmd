export const LARGE_DOCUMENT_CHAR_THRESHOLD = 150000;
export const LARGE_DOCUMENT_MERMAID_THRESHOLD = 20;
export const LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD = 8;

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

export function analyzeMarkdownComplexity(markdownText = '') {
  const source = String(markdownText);

  return {
    chars: source.length,
    excalidrawEmbeds: countMatches(source, /!\[\[[^\]]+\.excalidraw(?:\|[^\]]+)?\]\]/gi),
    mermaidBlocks: countMatches(source, /(^|\n)```mermaid\b/gi),
  };
}

export function isLargeDocumentStats(stats) {
  return Boolean(
    stats
    && (
      stats.chars >= LARGE_DOCUMENT_CHAR_THRESHOLD
      || stats.mermaidBlocks >= LARGE_DOCUMENT_MERMAID_THRESHOLD
      || stats.excalidrawEmbeds >= LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD
    )
  );
}

export function getRenderProfile(markdownText = '') {
  const source = String(markdownText);
  const hasMermaid = /(^|\n)```mermaid\b/i.test(source);
  const hasExcalidrawEmbed = /!\[\[[^\]]+\.excalidraw(?:\|[^\]]+)?\]\]/i.test(source);
  const isLargeByLength = source.length >= LARGE_DOCUMENT_CHAR_THRESHOLD;

  if (isLargeByLength) {
    return {
      debounceMs: 500,
      deferUntilIdle: true,
    };
  }

  if (hasMermaid || hasExcalidrawEmbed) {
    return {
      debounceMs: 260,
      deferUntilIdle: true,
    };
  }

  return {
    debounceMs: 100,
    deferUntilIdle: false,
  };
}
