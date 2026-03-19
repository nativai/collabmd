import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';

test('EditorSession preserves collaboration compatibility getters', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const awareness = { getStates: () => new Map() };
  const provider = { connected: true, destroy() {}, disconnect() {} };
  const ydoc = { clientID: 1, destroy() {} };
  const ytext = { toString: () => '' };

  session.collaborationClient.awareness = awareness;
  session.collaborationClient.provider = provider;
  session.collaborationClient.ydoc = ydoc;
  session.collaborationClient.ytext = ytext;

  assert.equal(session.awareness, awareness);
  assert.equal(session.provider, provider);
  assert.equal(session.ydoc, ydoc);
  assert.equal(session.ytext, ytext);

  session.destroy();
});

test('EditorSession keeps bootstrap content out of Yjs until collaborative view activation', async () => {
  const contentChanges = [];
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {
      contentChanges.push(session.getText());
    },
    preferredUserName: 'Tester',
  });

  const provisionalCalls = [];
  const collaborativeCalls = [];
  session.viewAdapter.initializeProvisional = ({ content, filePath }) => {
    provisionalCalls.push({ content, filePath });
    session.viewAdapter.getText = () => content;
  };
  session.viewAdapter.initialize = ({ filePath, ytext }) => {
    collaborativeCalls.push({ filePath, text: ytext.toString() });
    session.viewAdapter.getText = () => ytext.toString();
  };

  session.collaborationClient.initialSyncComplete = false;
  session.collaborationClient.initialize = async () => {
    const ytext = {
      toString: () => '# Live\n',
    };
    session.collaborationClient.ytext = ytext;
    return {
      awareness: { getStates: () => new Map() },
      commentThreads: [],
      localUser: null,
      undoManager: null,
      ydoc: {},
      ytext,
    };
  };
  session.commentThreadStore.bind = () => {};

  assert.equal(session.showBootstrapContent({ content: '# Bootstrap\n', filePath: 'README.md' }), true);
  assert.deepEqual(provisionalCalls, [{ content: '# Bootstrap\n', filePath: 'README.md' }]);
  assert.equal(session.getText(), '# Bootstrap\n');

  await session.initialize('README.md');

  assert.equal(collaborativeCalls.length, 0);
  assert.equal(session.collaborationClient.getText(), '# Live\n');
  assert.equal(session.getText(), '# Live\n');

  assert.equal(session.activateCollaborativeView(), true);
  assert.deepEqual(collaborativeCalls, [{ filePath: 'README.md', text: '# Live\n' }]);
  assert.equal(session.bootstrapContent, null);
  assert.deepEqual(contentChanges, ['# Bootstrap\n']);
});
