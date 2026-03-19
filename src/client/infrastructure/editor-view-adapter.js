import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Decoration,
  EditorView,
  WidgetType,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';

import { normalizeCommentQuote } from '../../domain/comment-threads.js';
import { createMarkdownToolbarEdit } from '../domain/markdown-formatting.js';
import { wikiLinkCompletions } from '../domain/wiki-link-completions.js';
import { plantUmlLanguage, plantUmlLanguageDescription } from '../domain/plantuml-language.js';
import { handleImagePasteEvent } from './editor-paste-utils.js';

const markdownCodeLanguages = [...languages, plantUmlLanguageDescription];
const pairedMatchingBracketMark = Decoration.mark({ class: 'cm-matchingBracket cm-matchingBracket-paired' });
const nonmatchingBracketMark = Decoration.mark({ class: 'cm-nonmatchingBracket' });
const remoteUpdateMark = Decoration.mark({ class: 'cm-remoteUpdateFlash' });
const REMOTE_UPDATE_FLASH_DURATION_MS = 1350;
const REMOTE_UPDATE_CARET_MAX_LENGTH = 160;
const RECENT_LOCAL_INPUT_WINDOW_MS = 900;

class RemoteUpdateCaretWidget extends WidgetType {
  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-remoteUpdateCaretWidget';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  ignoreEvent() {
    return true;
  }
}

const addRemoteUpdateFlashEffect = StateEffect.define();
const clearRemoteUpdateFlashEffect = StateEffect.define();
const remoteUpdateFlashField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes);

    transaction.effects.forEach((effect) => {
      if (effect.is(clearRemoteUpdateFlashEffect)) {
        nextDecorations = Decoration.none;
        return;
      }

      if (effect.is(addRemoteUpdateFlashEffect)) {
        const { from, showCaret, to } = effect.value;
        const nextRanges = [];
        if (to > from) {
          nextRanges.push(remoteUpdateMark.range(from, to));
        }
        if (showCaret) {
          nextRanges.push(Decoration.widget({
            side: -1,
            widget: new RemoteUpdateCaretWidget(),
          }).range(from));
        }
        nextDecorations = nextRanges.length > 0
          ? Decoration.set(nextRanges, true)
          : Decoration.none;
      }
    });

    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function isBracketBeforeCaret(range, state) {
  return state.selection.ranges.some((selectionRange) =>
    selectionRange.empty && range.to === selectionRange.head
  );
}

function renderBracketMatch(match, state) {
  const decorations = [];

  if (!match.matched) {
    decorations.push(nonmatchingBracketMark.range(match.start.from, match.start.to));
    if (match.end) {
      decorations.push(nonmatchingBracketMark.range(match.end.from, match.end.to));
    }
    return decorations;
  }

  const shouldHideStartBracket = isBracketBeforeCaret(match.start, state);
  const shouldHideEndBracket = match.end ? isBracketBeforeCaret(match.end, state) : false;

  if (!shouldHideStartBracket) {
    decorations.push(pairedMatchingBracketMark.range(match.start.from, match.start.to));
  }
  if (match.end && !shouldHideEndBracket) {
    decorations.push(pairedMatchingBracketMark.range(match.end.from, match.end.to));
  }

  return decorations;
}

function createEditorTheme(theme) {
  const activeLineBackground = theme === 'dark'
    ? 'oklch(from var(--color-surface-offset) l c h / 0.55)'
    : 'oklch(from var(--color-surface-offset) l c h / 0.75)';
  const activeLineAccent = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.28)'
    : 'oklch(from var(--color-primary) l c h / 0.18)';
  const selectionBackground = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.4)'
    : 'oklch(from var(--color-primary) l c h / 0.26)';
  const selectionBorder = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.65)'
    : 'oklch(from var(--color-primary) l c h / 0.5)';
  const caretColor = theme === 'dark'
    ? 'color-mix(in oklab, var(--color-primary) 78%, white)'
    : 'color-mix(in oklab, var(--color-primary) 84%, black)';
  const bracketPairBackground = theme === 'dark'
    ? 'oklch(from var(--color-primary) l c h / 0.2)'
    : 'oklch(from var(--color-primary) l c h / 0.12)';
  const bracketPairOutline = theme === 'dark'
    ? 'oklch(from var(--color-primary) calc(l + 0.08) c h / 0.85)'
    : 'oklch(from var(--color-primary) calc(l - 0.04) c h / 0.7)';
  const nonmatchingBracketBackground = theme === 'dark'
    ? 'oklch(from var(--color-error) l c h / 0.12)'
    : 'oklch(from var(--color-error) l c h / 0.1)';
  const nonmatchingBracketOutline = theme === 'dark'
    ? 'oklch(from var(--color-error) calc(l + 0.08) c h / 0.8)'
    : 'oklch(from var(--color-error) calc(l - 0.04) c h / 0.7)';

  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-text)',
    },
    '.cm-content': {
      caretColor,
      fontFamily: 'var(--font-mono)',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: caretColor,
      borderLeftWidth: '3px',
      marginLeft: '-1px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-dynamic)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-divider)',
      color: 'var(--color-text-muted)',
      minWidth: '44px',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-activeLine': {
      backgroundColor: activeLineBackground,
      boxShadow: `inset 3px 0 0 ${activeLineAccent}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: activeLineBackground,
      boxShadow: `inset 3px 0 0 ${activeLineAccent}`,
      color: 'var(--color-text-muted)',
    },
    '.cm-matchingBracket': {
      borderRadius: '2px',
      color: 'inherit',
    },
    '.cm-matchingBracket.cm-matchingBracket-paired': {
      backgroundColor: bracketPairBackground,
      outline: `1px solid ${bracketPairOutline}`,
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: nonmatchingBracketBackground,
      outline: `1px solid ${nonmatchingBracketOutline}`,
      borderRadius: '2px',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--color-primary-highlight)',
    },
    '.cm-remoteUpdateFlash': {
      animation: 'collabmd-remote-update-flash 1.35s ease-out',
      backgroundColor: theme === 'dark'
        ? 'oklch(from var(--color-primary) l c h / 0.22)'
        : 'oklch(from var(--color-primary) l c h / 0.16)',
      borderRadius: '3px',
      boxShadow: `0 0 0 1px ${theme === 'dark'
        ? 'oklch(from var(--color-primary) calc(l + 0.05) c h / 0.26)'
        : 'oklch(from var(--color-primary) calc(l - 0.04) c h / 0.2)'}`,
    },
    '.cm-remoteUpdateCaretWidget': {
      animation: 'collabmd-remote-update-caret 1s ease-out',
      backgroundColor: 'transparent',
      borderLeft: `2px solid ${theme === 'dark'
        ? 'color-mix(in oklab, var(--color-primary) 78%, white)'
        : 'color-mix(in oklab, var(--color-primary) 84%, black)'}`,
      borderRadius: '999px',
      boxShadow: `0 0 0 1px ${theme === 'dark'
        ? 'oklch(from var(--color-primary) calc(l + 0.06) c h / 0.22)'
        : 'oklch(from var(--color-primary) calc(l - 0.04) c h / 0.16)'}`,
      display: 'inline-block',
      height: '1.2em',
      marginLeft: '-1px',
      marginRight: '-1px',
      pointerEvents: 'none',
      transformOrigin: 'center bottom',
      verticalAlign: 'text-bottom',
      width: '0',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: selectionBackground,
    },
    '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
      border: `1px solid ${selectionBorder}`,
      borderRadius: '2px',
    },
    '@keyframes collabmd-remote-update-flash': {
      '0%': {
        backgroundColor: theme === 'dark'
          ? 'oklch(from var(--color-primary) l c h / 0.34)'
          : 'oklch(from var(--color-primary) l c h / 0.26)',
      },
      '100%': {
        backgroundColor: theme === 'dark'
          ? 'oklch(from var(--color-primary) l c h / 0)'
          : 'oklch(from var(--color-primary) l c h / 0)',
      },
    },
    '@keyframes collabmd-remote-update-caret': {
      '0%': {
        boxShadow: `0 0 0 1px ${theme === 'dark'
          ? 'oklch(from var(--color-primary) calc(l + 0.08) c h / 0.34)'
          : 'oklch(from var(--color-primary) calc(l - 0.04) c h / 0.24)'}`,
        opacity: '0',
        transform: 'translateY(0.2em) scaleY(0.7)',
      },
      '18%': {
        opacity: '1',
        transform: 'translateY(0) scaleY(1)',
      },
      '72%': {
        opacity: '1',
        transform: 'translateY(0) scaleY(1)',
      },
      '100%': {
        boxShadow: `0 0 0 1px ${theme === 'dark'
          ? 'oklch(from var(--color-primary) calc(l + 0.08) c h / 0)'
          : 'oklch(from var(--color-primary) calc(l - 0.04) c h / 0)'}`,
        opacity: '0',
        transform: 'translateY(-0.05em) scaleY(0.9)',
      },
    },
  }, { dark: theme === 'dark' });
}

function createLanguageExtension(filePath) {
  if (
    typeof filePath === 'string'
    && (filePath.toLowerCase().endsWith('.puml') || filePath.toLowerCase().endsWith('.plantuml'))
  ) {
    return plantUmlLanguage;
  }

  return markdown({ base: markdownLanguage, codeLanguages: markdownCodeLanguages });
}

function getSelectionBounds(selection) {
  return {
    from: Math.min(...selection.ranges.map((range) => Math.min(range.from, range.to))),
    to: Math.max(...selection.ranges.map((range) => Math.max(range.from, range.to))),
  };
}

export class EditorViewAdapter {
  constructor({
    editorContainer,
    getFileList,
    initialTheme,
    lineInfoElement,
    lineWrappingEnabled = true,
    onDocChanged = null,
    onImagePaste = null,
    onSelectionChanged = null,
    onViewportChanged = null,
  }) {
    this.editorContainer = editorContainer;
    this.getFileList = getFileList ?? (() => []);
    this.initialTheme = initialTheme;
    this.lineInfoElement = lineInfoElement;
    this.lineWrappingEnabled = lineWrappingEnabled;
    this.onDocChanged = onDocChanged;
    this.onImagePaste = onImagePaste;
    this.onSelectionChanged = onSelectionChanged;
    this.onViewportChanged = onViewportChanged;
    this.editorView = null;
    this.themeCompartment = new Compartment();
    this.syntaxThemeCompartment = new Compartment();
    this.lineWrappingCompartment = new Compartment();
    this.viewportFrame = 0;
    this.remoteUpdateFlashTimer = 0;
    this.lastLocalInputAt = 0;
    this.handleScroll = () => {
      if (this.viewportFrame) {
        return;
      }

      this.viewportFrame = requestAnimationFrame(() => {
        this.viewportFrame = 0;
        this.emitViewportChange();
      });
    };
    this.handleLocalInputActivity = () => {
      this.lastLocalInputAt = Date.now();
    };
  }

  createUpdateListener() {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.onDocChanged?.();
      }

      if (update.selectionSet || update.docChanged) {
        this.updateCursorInfo(update.state);
        this.onSelectionChanged?.(update.state);
      }
    });
  }

  getBaseExtensions(filePath, { readOnly = false } = {}) {
    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching({ renderMatch: renderBracketMatch }),
      closeBrackets(),
      autocompletion({
        override: [wikiLinkCompletions(this.getFileList)],
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({
        'aria-label': 'Markdown editor',
      }),
      createLanguageExtension(filePath),
      this.themeCompartment.of(createEditorTheme(this.initialTheme)),
      this.syntaxThemeCompartment.of(this.initialTheme === 'dark' ? oneDark : []),
      this.lineWrappingCompartment.of(this.lineWrappingEnabled ? EditorView.lineWrapping : []),
      remoteUpdateFlashField,
      this.createUpdateListener(),
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
      extensions.push(EditorView.editable.of(false));
      return extensions;
    }

    extensions.splice(13, 0, Prec.highest(EditorView.domEventHandlers({
      paste: (event) => handleImagePasteEvent(event, this.onImagePaste),
    })));
    return extensions;
  }

  clearEditorDom({ preserveLoadingIndicator = true } = {}) {
    if (!this.editorContainer) {
      return;
    }

    const loadingIndicator = preserveLoadingIndicator
      ? this.editorContainer.querySelector('#editorLoading')
      : null;
    Array.from(this.editorContainer.children).forEach((child) => {
      if (child !== loadingIndicator) {
        child.remove();
      }
    });
  }

  teardownEditorView({ clearContainer = false } = {}) {
    this.editorView?.contentDOM?.removeEventListener('beforeinput', this.handleLocalInputActivity);
    this.editorView?.contentDOM?.removeEventListener('keydown', this.handleLocalInputActivity);
    this.editorView?.contentDOM?.removeEventListener('paste', this.handleLocalInputActivity);
    this.editorView?.contentDOM?.removeEventListener('compositionstart', this.handleLocalInputActivity);
    this.editorView?.scrollDOM?.removeEventListener('scroll', this.handleScroll);
    this.editorView?.destroy();
    this.editorView = null;

    if (clearContainer && this.editorContainer) {
      this.editorContainer.innerHTML = '';
      delete this.editorContainer.dataset.editorMode;
    }
  }

  mountEditor(state, { editorMode = 'collaborative', preserveScrollTop = 0 } = {}) {
    this.clearEditorDom({ preserveLoadingIndicator: true });
    this.teardownEditorView();

    this.editorView = new EditorView({
      parent: this.editorContainer,
      state,
    });

    this.editorContainer.dataset.editorMode = editorMode;
    this.editorView.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true });
    this.editorView.contentDOM.addEventListener('beforeinput', this.handleLocalInputActivity);
    this.editorView.contentDOM.addEventListener('keydown', this.handleLocalInputActivity);
    this.editorView.contentDOM.addEventListener('paste', this.handleLocalInputActivity);
    this.editorView.contentDOM.addEventListener('compositionstart', this.handleLocalInputActivity);
    this.updateCursorInfo(this.editorView.state);
    this.onSelectionChanged?.(this.editorView.state);
    this.emitViewportChange();

    if (preserveScrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.editorView?.scrollDOM) {
          this.editorView.scrollDOM.scrollTop = preserveScrollTop;
        }
      });
    }
  }

  initialize({ awareness, filePath, undoManager, ytext }) {
    const preserveScrollTop = this.editorView?.scrollDOM?.scrollTop ?? 0;
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        ...this.getBaseExtensions(filePath),
        yCollab(ytext, awareness, { undoManager }),
      ],
    });

    this.mountEditor(state, {
      editorMode: 'collaborative',
      preserveScrollTop,
    });
  }

  initializeProvisional({ content = '', filePath }) {
    const preserveScrollTop = this.editorView?.scrollDOM?.scrollTop ?? 0;
    const state = EditorState.create({
      doc: String(content ?? ''),
      extensions: this.getBaseExtensions(filePath, { readOnly: true }),
    });

    this.mountEditor(state, {
      editorMode: 'provisional',
      preserveScrollTop,
    });
  }

  destroy() {
    if (this.viewportFrame) {
      cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = 0;
    }
    if (this.remoteUpdateFlashTimer) {
      clearTimeout(this.remoteUpdateFlashTimer);
      this.remoteUpdateFlashTimer = 0;
    }
    this.teardownEditorView({ clearContainer: true });
  }

  getText() {
    return this.editorView?.state.doc.toString() ?? '';
  }

  getDoc() {
    return this.editorView?.state.doc ?? null;
  }

  getState() {
    return this.editorView?.state ?? null;
  }

  getScrollContainer() {
    return this.editorView?.scrollDOM ?? null;
  }

  applyTheme(theme) {
    if (!this.editorView) {
      return;
    }

    this.editorView.dispatch({
      effects: [
        this.themeCompartment.reconfigure(createEditorTheme(theme)),
        this.syntaxThemeCompartment.reconfigure(theme === 'dark' ? oneDark : []),
      ],
    });
  }

  isLineWrappingEnabled() {
    return this.lineWrappingEnabled;
  }

  setLineWrapping(enabled) {
    this.lineWrappingEnabled = Boolean(enabled);

    if (!this.editorView) {
      return this.lineWrappingEnabled;
    }

    this.editorView.dispatch({
      effects: this.lineWrappingCompartment.reconfigure(
        this.lineWrappingEnabled ? EditorView.lineWrapping : [],
      ),
    });

    return this.lineWrappingEnabled;
  }

  requestMeasure() {
    this.editorView?.requestMeasure();
  }

  flashRemoteRange({ from = 0, to = 0 } = {}, durationMs = REMOTE_UPDATE_FLASH_DURATION_MS) {
    const state = this.editorView?.state;
    if (!state || state.doc.length === 0) {
      return false;
    }

    let start = Math.min(Math.max(Math.round(from), 0), state.doc.length);
    let end = Math.min(Math.max(Math.round(to), 0), state.doc.length);
    if (end <= start) {
      if (start < state.doc.length) {
        end = start + 1;
      } else if (start > 0) {
        start -= 1;
        end = start + 1;
      } else {
        return false;
      }
    }

    const rangeLength = Math.max(end - start, 0);
    const showCaret = (
      rangeLength <= REMOTE_UPDATE_CARET_MAX_LENGTH
      && (Date.now() - this.lastLocalInputAt) > RECENT_LOCAL_INPUT_WINDOW_MS
    );

    this.editorView.dispatch({
      effects: addRemoteUpdateFlashEffect.of({ from: start, showCaret, to: end }),
    });

    if (this.remoteUpdateFlashTimer) {
      clearTimeout(this.remoteUpdateFlashTimer);
    }

    this.remoteUpdateFlashTimer = window.setTimeout(() => {
      this.remoteUpdateFlashTimer = 0;
      this.editorView?.dispatch({
        effects: clearRemoteUpdateFlashEffect.of(null),
      });
    }, durationMs);

    return true;
  }

  getViewportState(viewportRatio = 0.35) {
    return {
      topLine: this.getTopVisibleLineNumber(viewportRatio),
      viewportRatio,
    };
  }

  getTopVisibleLineNumber(viewportRatio = 0) {
    if (!this.editorView) {
      return 1;
    }

    const scrollerRect = this.editorView.scrollDOM.getBoundingClientRect();
    const viewportOffset = Math.max(scrollerRect.height * viewportRatio, 8);
    const visibleBlock = this.editorView.lineBlockAtHeight(
      (scrollerRect.top + viewportOffset) - this.editorView.documentTop,
    );

    if (!visibleBlock) {
      return 1;
    }

    return this.editorView.state.doc.lineAt(visibleBlock.from).number;
  }

  getCurrentSelectionLineRange() {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const { doc, selection } = state;
    const { from, to } = getSelectionBounds(selection);
    const startLine = doc.lineAt(from).number;
    let safeTo = Math.min(Math.max(to, from), doc.length);
    if (safeTo > from && doc.lineAt(safeTo).from === safeTo) {
      safeTo -= 1;
    }

    return {
      endLine: doc.lineAt(safeTo).number,
      startLine,
    };
  }

  getCurrentSelectionCommentAnchor() {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const { doc, selection } = state;
    const { from, to } = getSelectionBounds(selection);
    const isCollapsed = from === to;

    if (isCollapsed) {
      const line = doc.lineAt(from);
      return {
        anchorKind: 'line',
        anchorQuote: normalizeCommentQuote(line.text),
        endIndex: line.to,
        endLine: line.number,
        startIndex: line.from,
        startLine: line.number,
      };
    }

    let safeTo = Math.min(Math.max(to, from), doc.length);
    if (safeTo > from && doc.lineAt(safeTo).from === safeTo) {
      safeTo -= 1;
    }

    return {
      anchorKind: 'text',
      anchorQuote: normalizeCommentQuote(doc.sliceString(from, to)),
      endIndex: to,
      endLine: doc.lineAt(safeTo).number,
      startIndex: from,
      startLine: doc.lineAt(from).number,
    };
  }

  normalizeLineRange({ endLine, startLine }) {
    const state = this.editorView?.state;
    if (!state) {
      return { endLine: 1, startLine: 1 };
    }

    const lineCount = state.doc.lines;
    const normalizedStart = Math.min(Math.max(Math.round(startLine ?? 1), 1), lineCount);
    const normalizedEnd = Math.min(Math.max(Math.round(endLine ?? normalizedStart), normalizedStart), lineCount);

    return {
      endLine: normalizedEnd,
      startLine: normalizedStart,
    };
  }

  getLineInfoAt(position) {
    const state = this.editorView?.state;
    if (!state) {
      return null;
    }

    const clampedPosition = Math.min(Math.max(position, 0), state.doc.length);
    const line = state.doc.lineAt(clampedPosition);
    return {
      line,
      lineNumber: line.number,
    };
  }

  getAnchorClientRect(anchor) {
    const state = this.editorView?.state;
    const editorView = this.editorView;
    if (!state || !editorView || !anchor) {
      return null;
    }

    const kind = anchor.anchorKind || anchor.kind || 'line';
    const startIndex = Math.min(Math.max(Math.round(anchor.startIndex ?? 0), 0), state.doc.length);
    const endIndex = Math.min(Math.max(Math.round(anchor.endIndex ?? startIndex), startIndex), state.doc.length);

    if (kind === 'text' && endIndex > startIndex) {
      const startCoords = editorView.coordsAtPos(startIndex);
      const endCoords = editorView.coordsAtPos(Math.max(endIndex - 1, startIndex));
      if (startCoords && endCoords) {
        return {
          bottom: Math.max(startCoords.bottom, endCoords.bottom),
          height: Math.max(startCoords.bottom, endCoords.bottom) - Math.min(startCoords.top, endCoords.top),
          left: Math.min(startCoords.left, endCoords.left),
          right: Math.max(startCoords.right, endCoords.right),
          top: Math.min(startCoords.top, endCoords.top),
          width: Math.max(startCoords.right, endCoords.right) - Math.min(startCoords.left, endCoords.left),
        };
      }
    }

    const targetLine = state.doc.line(
      Math.min(Math.max(Math.round(anchor.startLine ?? 1), 1), state.doc.lines),
    );
    const lineBlock = editorView.lineBlockAt(targetLine.from);
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect();
    const scrollTop = editorView.scrollDOM.scrollTop;
    const contentRect = editorView.contentDOM.getBoundingClientRect();
    const left = contentRect.left;
    const right = Math.max(contentRect.right, scrollerRect.right - 8);
    const top = scrollerRect.top + lineBlock.top - scrollTop;

    return {
      bottom: top + lineBlock.height,
      height: lineBlock.height,
      left,
      right,
      top,
      width: Math.max(right - left, 0),
    };
  }

  getSelectionChipClientRect(anchor) {
    const state = this.editorView?.state;
    const editorView = this.editorView;
    if (!state || !editorView || !anchor) {
      return null;
    }

    const startIndex = Math.min(Math.max(Math.round(anchor.startIndex ?? 0), 0), state.doc.length);
    const startLine = state.doc.lineAt(startIndex);
    const lineBlock = editorView.lineBlockAt(startLine.from);
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect();
    const scrollTop = editorView.scrollDOM.scrollTop;
    const contentRect = editorView.contentDOM.getBoundingClientRect();
    const right = Math.max(contentRect.right, scrollerRect.right - 8);
    const top = scrollerRect.top + lineBlock.top - scrollTop;

    return {
      bottom: top + lineBlock.height,
      height: lineBlock.height,
      left: contentRect.left,
      right,
      top,
      width: Math.max(right - contentRect.left, 0),
    };
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    const state = this.editorView?.state;
    const scroller = this.editorView?.scrollDOM;
    if (!state || !scroller || !this.editorView) {
      return false;
    }

    const targetLineNumber = Math.min(
      Math.max(Math.round(lineNumber), 1),
      state.doc.lines,
    );
    const line = state.doc.line(targetLineNumber);
    const lineBlock = this.editorView.lineBlockAt(line.from);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const viewportOffset = viewportRatio > 0 ? scroller.clientHeight * viewportRatio : 8;
    const nextScrollTop = Math.min(
      Math.max(lineBlock.top - viewportOffset, 0),
      maxScrollTop,
    );

    scroller.scrollTo({ top: nextScrollTop });
    return true;
  }

  scrollToPosition(position, alignment = 'center') {
    const state = this.editorView?.state;
    const scroller = this.editorView?.scrollDOM;
    if (!state || !scroller || !this.editorView) {
      return false;
    }

    const targetPosition = Math.min(Math.max(Math.round(position), 0), state.doc.length);
    const lineBlock = this.editorView.lineBlockAt(targetPosition);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    let nextScrollTop = lineBlock.top;

    if (alignment === 'center') {
      nextScrollTop = lineBlock.top - ((scroller.clientHeight - lineBlock.height) / 2);
    }

    scroller.scrollTo({
      top: Math.min(Math.max(nextScrollTop, 0), maxScrollTop),
    });

    return true;
  }

  applyMarkdownToolbarAction(action) {
    if (!this.editorView) {
      return false;
    }

    const { state } = this.editorView;
    const documentText = state.doc.toString();
    let hasChanges = false;

    const transactionSpec = state.changeByRange((range) => {
      const edit = createMarkdownToolbarEdit(documentText, range, action);
      if (!edit) {
        return { range };
      }

      hasChanges = true;
      return {
        changes: {
          from: edit.from,
          insert: edit.insert,
          to: edit.to,
        },
        range: EditorSelection.range(edit.anchor, edit.head),
      };
    });

    if (!hasChanges) {
      return false;
    }

    this.editorView.dispatch(state.update(transactionSpec, {
      scrollIntoView: true,
      userEvent: 'input',
    }));
    this.editorView.focus();
    return true;
  }

  insertText(text) {
    if (!this.editorView) {
      return false;
    }

    const insertValue = String(text ?? '');
    const { state } = this.editorView;
    const range = state.selection.main;
    const anchor = range.from + insertValue.length;

    this.editorView.dispatch({
      changes: {
        from: range.from,
        insert: insertValue,
        to: range.to,
      },
      scrollIntoView: true,
      selection: {
        anchor,
        head: anchor,
      },
      userEvent: 'input',
    });
    this.editorView.focus();
    return true;
  }

  updateCursorInfo(state) {
    if (!this.lineInfoElement) {
      return;
    }

    const position = state.selection.main.head;
    const line = state.doc.lineAt(position);
    const column = position - line.from + 1;
    this.lineInfoElement.textContent = `Ln ${line.number}, Col ${column}`;
  }

  emitViewportChange() {
    this.onViewportChanged?.(this.getViewportState());
  }
}
