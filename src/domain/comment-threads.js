import * as Y from 'yjs';

export const COMMENT_BODY_MAX_LENGTH = 2000;
export const COMMENT_EXCERPT_MAX_LENGTH = 160;

function asFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function readThreadValue(thread, key) {
  if (thread instanceof Y.Map) {
    return thread.get(key);
  }

  return thread?.[key];
}

function isResolvedThread(thread) {
  return asFiniteNumber(readThreadValue(thread, 'resolvedAt')) !== null;
}

function createMessageRecord(message) {
  const body = normalizeCommentBody(message?.body);
  if (!body) {
    return null;
  }

  return {
    body,
    createdAt: asFiniteNumber(message?.createdAt) ?? Date.now(),
    id: asString(message?.id) || createCommentId('comment'),
    peerId: asString(message?.peerId),
    userColor: asString(message?.userColor),
    userName: asString(message?.userName) || 'Anonymous',
  };
}

function serializeMessages(messages) {
  const source = messages instanceof Y.Array
    ? messages.toArray()
    : Array.isArray(messages)
      ? messages
      : [];

  return source
    .map((message) => createMessageRecord(message))
    .filter(Boolean);
}

export function createCommentId(prefix = 'comment') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeCommentBody(value) {
  const normalized = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, COMMENT_BODY_MAX_LENGTH);

  return normalized || null;
}

export function summarizeCommentExcerpt(value, maxLength = COMMENT_EXCERPT_MAX_LENGTH) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

export function createCommentThreadSharedType(record = {}) {
  if (asFiniteNumber(record.resolvedAt) !== null) {
    return null;
  }

  const initialMessage = createMessageRecord(record.messages?.[0]);
  if (!initialMessage) {
    return null;
  }

  const messages = new Y.Array();
  const normalizedMessages = record.messages
    ?.map((message) => createMessageRecord(message))
    .filter(Boolean) ?? [];

  messages.push(normalizedMessages.length > 0 ? normalizedMessages : [initialMessage]);

  const thread = new Y.Map();
  thread.set('anchorEnd', asObject(record.anchorEnd));
  thread.set('anchorEndLine', asFiniteNumber(record.anchorEndLine) ?? asFiniteNumber(record.anchorStartLine) ?? 1);
  thread.set('anchorExcerpt', summarizeCommentExcerpt(record.anchorExcerpt));
  thread.set('anchorStart', asObject(record.anchorStart));
  thread.set('anchorStartLine', asFiniteNumber(record.anchorStartLine) ?? 1);
  thread.set('createdAt', asFiniteNumber(record.createdAt) ?? Date.now());
  thread.set('createdByColor', asString(record.createdByColor));
  thread.set('createdByName', asString(record.createdByName) || initialMessage.userName);
  thread.set('createdByPeerId', asString(record.createdByPeerId) || initialMessage.peerId);
  thread.set('id', asString(record.id) || createCommentId('thread'));
  thread.set('messages', messages);
  thread.set('resolvedAt', asFiniteNumber(record.resolvedAt));
  thread.set('resolvedByColor', asString(record.resolvedByColor));
  thread.set('resolvedByName', asString(record.resolvedByName));
  thread.set('resolvedByPeerId', asString(record.resolvedByPeerId));
  return thread;
}

export function serializeCommentThread(thread) {
  if (isResolvedThread(thread)) {
    return null;
  }

  const anchorStart = asObject(readThreadValue(thread, 'anchorStart'));
  const anchorEnd = asObject(readThreadValue(thread, 'anchorEnd'));
  const messages = serializeMessages(readThreadValue(thread, 'messages'));

  if (!anchorStart || !anchorEnd || messages.length === 0) {
    return null;
  }

  return {
    anchorEnd,
    anchorEndLine: asFiniteNumber(readThreadValue(thread, 'anchorEndLine'))
      ?? asFiniteNumber(readThreadValue(thread, 'anchorStartLine'))
      ?? 1,
    anchorExcerpt: summarizeCommentExcerpt(readThreadValue(thread, 'anchorExcerpt')),
    anchorStart,
    anchorStartLine: asFiniteNumber(readThreadValue(thread, 'anchorStartLine')) ?? 1,
    createdAt: asFiniteNumber(readThreadValue(thread, 'createdAt')) ?? messages[0].createdAt,
    createdByColor: asString(readThreadValue(thread, 'createdByColor')) || messages[0].userColor,
    createdByName: asString(readThreadValue(thread, 'createdByName')) || messages[0].userName,
    createdByPeerId: asString(readThreadValue(thread, 'createdByPeerId')) || messages[0].peerId,
    id: asString(readThreadValue(thread, 'id')) || createCommentId('thread'),
    messages,
    resolvedAt: asFiniteNumber(readThreadValue(thread, 'resolvedAt')),
    resolvedByColor: asString(readThreadValue(thread, 'resolvedByColor')),
    resolvedByName: asString(readThreadValue(thread, 'resolvedByName')),
    resolvedByPeerId: asString(readThreadValue(thread, 'resolvedByPeerId')),
  };
}

export function serializeCommentThreads(source) {
  const items = source instanceof Y.Array
    ? source.toArray()
    : Array.isArray(source)
      ? source
      : [];

  return items
    .map((thread) => serializeCommentThread(thread))
    .filter(Boolean);
}

export function populateCommentThreads(sharedArray, records = []) {
  if (!(sharedArray instanceof Y.Array) || !Array.isArray(records) || records.length === 0) {
    return;
  }

  const threads = records
    .map((record) => createCommentThreadSharedType(record))
    .filter(Boolean);

  if (threads.length > 0) {
    sharedArray.push(threads);
  }
}
