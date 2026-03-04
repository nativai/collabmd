import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import { DEFAULT_CONTENT } from '../domain/default-content.js';
import { createRandomUser } from '../domain/room.js';
import { resolveWsBaseUrl } from './runtime-config.js';

function createEditorTheme(theme) {
  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-text)',
    },
    '.cm-content': {
      caretColor: 'var(--color-primary)',
      fontFamily: 'var(--font-mono)',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-primary)',
      borderLeftWidth: '2px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-dynamic)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-divider)',
      color: 'var(--color-text-faint)',
      minWidth: '44px',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--color-surface-offset)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-surface-offset)',
      color: 'var(--color-text-muted)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--color-primary-highlight)',
      outline: '1px solid var(--color-primary)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--color-primary-highlight)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--color-primary-highlight)',
    },
  }, { dark: theme === 'dark' });
}

export class EditorSession {
  constructor({
    editorContainer,
    initialTheme,
    lineInfoElement,
    onAwarenessChange,
    onConnectionChange,
    onContentChange,
  }) {
    this.editorContainer = editorContainer;
    this.initialTheme = initialTheme;
    this.lineInfoElement = lineInfoElement;
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.editorView = null;
    this.provider = null;
    this.themeCompartment = new Compartment();
    this.syntaxThemeCompartment = new Compartment();
    this.ydoc = null;
    this.ytext = null;
    this.wsBaseUrl = '';
  }

  async initialize(roomId) {
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('codemirror');

    const undoManager = new Y.UndoManager(this.ytext);
    const user = createRandomUser();
    const provider = new WebsocketProvider(this.wsBaseUrl, roomId, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });

    this.provider = provider;

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', user);

    this.trackConnectionStatus();

    this.ytext.observe(() => {
      this.onContentChange?.();
    });

    let initializedDefaultContent = false;
    provider.on('sync', (isSynced) => {
      if (!isSynced || initializedDefaultContent) {
        return;
      }

      initializedDefaultContent = true;

      if (this.ytext.toString() === '') {
        this.ydoc.transact(() => {
          this.ytext.insert(0, DEFAULT_CONTENT);
        }, 'default-content');
      }

      this.onContentChange?.();
    });

    awareness.on('change', () => {
      this.onAwarenessChange?.(this.collectUsers(awareness));
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.onContentChange?.();
      }

      if (update.selectionSet || update.docChanged) {
        this.updateCursorInfo(update.state);
      }
    });

    this.editorContainer.innerHTML = '';
    this.editorView = new EditorView({
      parent: this.editorContainer,
      state: EditorState.create({
        doc: this.ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
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
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          this.themeCompartment.of(createEditorTheme(this.initialTheme)),
          this.syntaxThemeCompartment.of(this.initialTheme === 'dark' ? oneDark : []),
          yCollab(this.ytext, awareness, { undoManager }),
          updateListener,
          EditorView.lineWrapping,
        ],
      }),
    });

    this.updateCursorInfo(this.editorView.state);
    this.onAwarenessChange?.(this.collectUsers(awareness));
    this.onContentChange?.();
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

  getText() {
    if (this.ytext) {
      return this.ytext.toString();
    }

    if (this.editorView) {
      return this.editorView.state.doc.toString();
    }

    return '';
  }

  requestMeasure() {
    this.editorView?.requestMeasure();
  }

  destroy() {
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;

    this.editorView?.destroy();
    this.editorView = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.ytext = null;

    if (this.editorContainer) {
      this.editorContainer.innerHTML = '';
    }
  }

  trackConnectionStatus() {
    if (!this.provider) {
      return;
    }

    let attempts = 0;
    let hasEverConnected = false;

    this.provider.on('status', ({ status }) => {
      if (status === 'connecting') {
        attempts += 1;
      }

      const firstConnection = status === 'connected' && !hasEverConnected;
      if (status === 'connected') {
        attempts = 0;
        hasEverConnected = true;
      }

      this.onConnectionChange?.({
        attempts,
        firstConnection,
        hasEverConnected,
        status,
        unreachable: !hasEverConnected && attempts >= 3,
        wsBaseUrl: this.wsBaseUrl,
      });
    });
  }

  collectUsers(awareness) {
    const users = [];

    awareness.getStates().forEach((state, clientId) => {
      if (!state.user) {
        return;
      }

      users.push({
        ...state.user,
        clientId,
        isLocal: clientId === awareness.clientID,
      });
    });

    return users;
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
}
