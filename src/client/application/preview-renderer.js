import markdownIt from 'markdown-it';
import hljs from 'highlight.js';

function createMarkdownRenderer() {
  const markdown = markdownIt({
    highlight(source, language) {
      if (language === 'mermaid') {
        return '';
      }

      try {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(source, { language }).value;
        }

        return hljs.highlightAuto(source).value;
      } catch {
        return '';
      }
    },
    html: true,
    linkify: true,
    typographer: true,
  });

  let mermaidCounter = 0;
  const fallbackFence = markdown.renderer.rules.fence ?? ((tokens, index, options, env, self) => (
    self.renderToken(tokens, index, options)
  ));

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const info = token.info ? token.info.trim().toLowerCase() : '';

    if (info === 'mermaid') {
      mermaidCounter += 1;
      return `<div class="mermaid" id="mermaid-${mermaidCounter}">${markdown.utils.escapeHtml(token.content)}</div>`;
    }

    return fallbackFence(tokens, index, options, env, self);
  };

  markdown.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
    const inlineToken = tokens[index + 2];
    const content = inlineToken?.content ?? '';

    if (content.startsWith('[ ] ') || content.startsWith('[x] ') || content.startsWith('[X] ')) {
      return '<li class="task-list-item">';
    }

    return self.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.text = (tokens, index) => {
    const content = tokens[index].content;

    if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
      return `<input type="checkbox" checked disabled> ${markdown.utils.escapeHtml(content.slice(4))}`;
    }

    if (content.startsWith('[ ] ')) {
      return `<input type="checkbox" disabled> ${markdown.utils.escapeHtml(content.slice(4))}`;
    }

    return markdown.utils.escapeHtml(content);
  };

  const fallbackLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, env, self) => (
    self.renderToken(tokens, index, options)
  ));

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return fallbackLinkOpen(tokens, index, options, env, self);
  };

  return markdown;
}

export class PreviewRenderer {
  constructor({ getContent, outlineController, previewElement }) {
    this.getContent = getContent;
    this.outlineController = outlineController;
    this.previewElement = previewElement;
    this.markdown = createMarkdownRenderer();
    this.frameId = null;
    this.timeoutId = null;
  }

  applyTheme(theme) {
    const mermaid = window.mermaid;
    const highlightTheme = document.getElementById('hljs-theme');
    if (highlightTheme) {
      const { darkHref, lightHref } = highlightTheme.dataset;
      highlightTheme.href = theme === 'dark' ? darkHref : lightHref;
    }

    if (!mermaid) {
      return;
    }

    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      themeVariables: theme === 'dark' ? {
        background: '#161822',
        clusterBkg: '#1a1c28',
        edgeLabelBackground: '#161822',
        lineColor: '#8b8ba0',
        mainBkg: '#1c1e2c',
        nodeBorder: '#383a50',
        primaryBorderColor: '#383a50',
        primaryColor: '#818cf8',
        primaryTextColor: '#e2e2ea',
        secondaryColor: '#1c1e2c',
        tertiaryColor: '#161822',
        titleColor: '#e2e2ea',
      } : {},
    });
  }

  queueRender() {
    clearTimeout(this.timeoutId);
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }

    this.timeoutId = setTimeout(() => {
      this.frameId = requestAnimationFrame(() => {
        void this.render();
      });
    }, 100);
  }

  async render() {
    if (!this.previewElement) {
      return;
    }

    const mermaid = window.mermaid;
    const markdownText = this.getContent();
    const html = this.markdown.render(markdownText);
    this.previewElement.innerHTML = html;

    this.wrapTables();

    const mermaidNodes = this.previewElement.querySelectorAll('.mermaid');
    if (mermaid && mermaidNodes.length > 0) {
      try {
        await mermaid.run({ nodes: mermaidNodes });
      } catch (error) {
        console.warn('[preview] Mermaid render failed:', error);
      }
    }

    this.outlineController.refresh();
  }

  wrapTables() {
    this.previewElement.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('table-wrapper')) {
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }
}
