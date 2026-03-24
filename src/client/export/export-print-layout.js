const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const KEEP_WITH_NEXT_BLOCK_SELECTOR = [
  'figure',
  'pre',
  'blockquote',
  'table',
].join(', ');

function isKeepWithNextBlock(element) {
  return Boolean(element?.matches?.(KEEP_WITH_NEXT_BLOCK_SELECTOR));
}

export function groupHeadingWithFollowingBlock(container) {
  if (!container) {
    return;
  }

  const headings = Array.from(container.querySelectorAll(HEADING_SELECTOR));
  headings.forEach((heading) => {
    if (heading.parentElement?.classList.contains('export-keep-with-next')) {
      return;
    }

    const next = heading.nextElementSibling;
    if (!next || next.classList.contains('export-keep-with-next')) {
      return;
    }

    const nodes = [heading];
    let block = next;

    if (block.tagName === 'P') {
      const followingBlock = block.nextElementSibling;
      if (!followingBlock || !isKeepWithNextBlock(followingBlock)) {
        return;
      }
      nodes.push(block);
      block = followingBlock;
    } else if (!isKeepWithNextBlock(block)) {
      return;
    }

    nodes.push(block);

    const wrapper = document.createElement('section');
    wrapper.className = 'export-keep-with-next';
    heading.before(wrapper);
    nodes.forEach((node) => wrapper.appendChild(node));
  });
}
