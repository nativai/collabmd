export class WorkspaceStateStore {
  constructor(initialState = {}) {
    this.state = {
      activeSidebarTab: 'files',
      chatInitialSyncComplete: false,
      chatIsOpen: false,
      chatMessageIds: new Set(),
      chatMessages: [],
      chatUnreadCount: 0,
      commentThreads: [],
      connectionHelpShown: false,
      connectionState: { status: 'disconnected', unreachable: false },
      currentFilePath: null,
      fileExplorerReady: false,
      followedCursorSignature: '',
      followedUserClientId: null,
      gitRepoAvailable: false,
      globalUsers: [],
      isTabActive: false,
      sessionLoadToken: 0,
      ...initialState,
    };
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    return value;
  }

  nextSessionLoadToken() {
    const nextToken = Number(this.state.sessionLoadToken || 0) + 1;
    this.state.sessionLoadToken = nextToken;
    return nextToken;
  }

  replaceChatState({ initialSyncComplete, isOpen, messageIds, messages, unreadCount }) {
    this.state.chatMessages = Array.isArray(messages) ? messages : [];
    this.state.chatMessageIds = messageIds instanceof Set ? messageIds : new Set();
    this.state.chatUnreadCount = Number.isFinite(unreadCount) ? unreadCount : 0;
    this.state.chatIsOpen = Boolean(isOpen);
    this.state.chatInitialSyncComplete = Boolean(initialSyncComplete);
  }
}
