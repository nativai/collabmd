import { basename, dirname, extname } from 'node:path';

import yaml from 'js-yaml';

import { createWikiTargetIndex, resolveWikiTargetWithIndex } from '../../../domain/wiki-link-resolver.js';
import { isImageAttachmentFilePath, isMarkdownFilePath, stripVaultFileExtension } from '../../../domain/file-kind.js';
import { extractYamlFrontmatter } from '../../../domain/yaml-frontmatter.js';
import { mapWithConcurrency } from '../../shared/async-utils.js';

const INTERNAL_LINK_RE = /(!)?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const INLINE_TAG_RE = /(^|[\s(])#([A-Za-z0-9/_-]+)/g;
const SUPPORTED_VIEW_TYPES = new Set(['cards', 'list', 'table']);
const INDEX_READ_CONCURRENCY = 8;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function capitalize(value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim().replace(/^#/u, ''))
      .filter(Boolean);
  }

  const normalized = String(value ?? '').trim().replace(/^#/u, '');
  return normalized ? [normalized] : [];
}

function normalizeVaultPathSegments(pathValue = '') {
  return String(pathValue ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function resolveVaultRelativePath(fromFilePath, relativePath) {
  const sourceSegments = normalizeVaultPathSegments(fromFilePath);
  const targetSegments = String(relativePath ?? '')
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (targetSegments.length === 0) {
    return '';
  }

  sourceSegments.pop();
  const resolvedSegments = [...sourceSegments];

  for (const rawSegment of targetSegments) {
    const segment = String(rawSegment ?? '').trim();
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (resolvedSegments.length === 0) {
        return '';
      }
      resolvedSegments.pop();
      continue;
    }

    resolvedSegments.push(segment);
  }

  return resolvedSegments.join('/');
}

function extractInlineTags(markdownText = '') {
  const tags = new Set();
  let match;
  while ((match = INLINE_TAG_RE.exec(String(markdownText ?? ''))) !== null) {
    tags.add(match[2]);
  }
  return [...tags];
}

function extractReferences(markdownText = '', wikiTargetIndex) {
  const links = [];
  const embeds = [];
  let match;
  while ((match = INTERNAL_LINK_RE.exec(String(markdownText ?? ''))) !== null) {
    const isEmbed = Boolean(match[1]);
    const rawTarget = String(match[2] ?? '').trim();
    if (!rawTarget) {
      continue;
    }

    const resolvedPath = resolveWikiTargetWithIndex(rawTarget, wikiTargetIndex);
    const linkValue = createLinkValue(resolvedPath || rawTarget, {
      exists: Boolean(resolvedPath),
      rawTarget,
    });
    links.push(linkValue);
    if (isEmbed) {
      embeds.push(linkValue);
    }
  }
  return { embeds, links };
}

function dedupeLinkValues(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value?.external
      ? `external:${value.url || value.rawTarget || value.display || ''}`
      : `path:${value.path || value.rawTarget || value.display || ''}`;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createLinkValue(target, {
  display = '',
  exists = false,
  external = false,
  rawTarget = '',
} = {}) {
  return {
    __baseType: 'link',
    display: display ? String(display) : '',
    exists: Boolean(exists),
    external: Boolean(external),
    path: external ? '' : String(target ?? ''),
    rawTarget: String(rawTarget || target || ''),
    url: external ? String(target ?? '') : '',
  };
}

function createFormulaNamespace(row, evaluationState) {
  return {
    __baseType: 'formula-namespace',
    evaluationState,
    row,
  };
}

function createContextFileValue(fileValue) {
  return fileValue ?? null;
}

function compareVaultPaths(left = '', right = '') {
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

function isWorkspaceFileEntry(entry = {}) {
  return entry?.nodeType === 'file' || entry?.type !== 'directory';
}

function listWorkspaceFilePaths(workspaceState = {}) {
  return Array.from(workspaceState?.entries?.values?.() ?? [])
    .filter((entry) => isWorkspaceFileEntry(entry))
    .map((entry) => entry.path)
    .sort(compareVaultPaths);
}

function normalizeWikiTargetKey(target = '') {
  const normalizedTarget = String(target ?? '').trim();
  if (!normalizedTarget) {
    return '';
  }

  return normalizedTarget.endsWith('.md') ? normalizedTarget : `${normalizedTarget}.md`;
}

function collectWikiTargetKeysForFilePath(filePath = '') {
  const normalizedPath = String(filePath ?? '').trim();
  if (!normalizedPath || !normalizedPath.endsWith('.md')) {
    return [];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const keys = [];
  for (let index = 0; index < segments.length; index += 1) {
    keys.push(segments.slice(index).join('/'));
  }

  return keys;
}

function normalizeBaseDefinition(source = '') {
  const raw = yaml.load(String(source ?? '')) ?? {};
  const rawObject = isPlainObject(raw) ? raw : {};
  const rawProperties = isPlainObject(rawObject.properties) ? rawObject.properties : {};
  const properties = Object.entries(rawProperties).reduce((acc, [id, config]) => {
    const normalizedConfig = isPlainObject(config) ? { ...config } : {};
    acc[id] = {
      displayName: typeof normalizedConfig.displayName === 'string' ? normalizedConfig.displayName : null,
      formula: typeof normalizedConfig.formula === 'string' ? normalizedConfig.formula : null,
      id,
      raw: normalizedConfig,
    };
    return acc;
  }, {});

  const rawViews = Array.isArray(rawObject.views) ? rawObject.views : [];
  const views = rawViews.map((rawView, index) => normalizeBaseView(rawView, index));
  if (views.length === 0) {
    views.push(normalizeBaseView({ name: 'Table', type: 'table' }, 0));
  }

  return {
    filters: rawObject.filters ?? null,
    properties,
    raw: rawObject,
    views,
  };
}

function normalizeBaseView(rawView, index) {
  const view = isPlainObject(rawView) ? rawView : {};
  const type = typeof view.type === 'string' ? view.type : 'table';
  const name = typeof view.name === 'string' && view.name.trim()
    ? view.name.trim()
    : `${capitalize(type)} ${index + 1}`;
  return {
    extra: Object.entries(view).reduce((acc, [key, value]) => {
      if ([
        'filters',
        'groupBy',
        'group_by',
        'image',
        'limit',
        'name',
        'order',
        'properties',
        'sort',
        'sorts',
        'summaries',
        'type',
      ].includes(key)) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {}),
    filters: view.filters ?? null,
    groupBy: typeof view.groupBy === 'string'
      ? view.groupBy
      : (typeof view.group_by === 'string' ? view.group_by : null),
    id: `view-${index}`,
    image: typeof view.image === 'string' ? view.image : null,
    limit: Number.isFinite(Number(view.limit)) ? Math.max(0, Number(view.limit)) : null,
    name,
    order: normalizeViewOrder(view.order ?? view.properties),
    sort: normalizeViewSort(view.sort ?? view.sorts),
    summaries: normalizeSummaries(view.summaries),
    supported: SUPPORTED_VIEW_TYPES.has(type),
    type,
  };
}

function normalizeViewOrder(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (isPlainObject(entry)) {
          return entry.id ?? entry.property ?? entry.name ?? null;
        }
        return null;
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeViewSort(value) {
  if (typeof value === 'string' && value.trim()) {
    return [{ direction: 'asc', property: value.trim() }];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { direction: 'asc', property: entry };
      }
      if (!isPlainObject(entry)) {
        return null;
      }

      const property = entry.property ?? entry.id ?? entry.name ?? null;
      if (typeof property !== 'string' || !property.trim()) {
        return null;
      }

      const direction = String(entry.direction ?? entry.order ?? 'asc').toLowerCase() === 'desc'
        ? 'desc'
        : 'asc';
      return { direction, property: property.trim() };
    })
    .filter(Boolean);
}

function normalizeSummaries(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeSummary(entry, index))
      .filter(Boolean);
  }

  if (isPlainObject(value)) {
    const entries = [];
    Object.entries(value).forEach(([property, propertySummaries]) => {
      if (Array.isArray(propertySummaries)) {
        propertySummaries.forEach((entry, index) => {
          const normalized = normalizeSummary(entry, index, property);
          if (normalized) {
            entries.push(normalized);
          }
        });
        return;
      }

      const normalized = normalizeSummary(propertySummaries, entries.length, property);
      if (normalized) {
        entries.push(normalized);
      }
    });
    return entries;
  }

  return [];
}

function normalizeSummary(entry, index, property = null) {
  if (typeof entry === 'string') {
    return {
      id: `summary-${index}`,
      label: capitalize(entry),
      property,
      type: entry.toLowerCase(),
    };
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const summaryProperty = typeof (entry.property ?? property) === 'string'
    ? String(entry.property ?? property).trim()
    : null;
  const formula = typeof entry.formula === 'string' ? entry.formula : null;
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : (formula ? 'custom' : null);
  if (!summaryProperty) {
    return null;
  }

  return {
    formula,
    id: `summary-${index}`,
    label: typeof entry.name === 'string' ? entry.name : capitalize(type || 'Summary'),
    property: summaryProperty,
    type,
  };
}

function tokenizeExpression(source = '') {
  const tokens = [];
  const text = String(source ?? '');
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    const twoChar = text.slice(index, index + 2);
    const threeChar = text.slice(index, index + 3);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      index += 2;
      continue;
    }
    if (threeChar === '...') {
      tokens.push({ type: 'operator', value: threeChar });
      index += 3;
      continue;
    }
    if ('+-*/%!<>()[]{}.,:'.includes(character)) {
      tokens.push({
        type: '()[]{}.,:'.includes(character) ? 'punctuation' : 'operator',
        value: character,
      });
      index += 1;
      continue;
    }
    if (character === '"' || character === '\'') {
      let value = '';
      let cursor = index + 1;
      while (cursor < text.length) {
        const nextCharacter = text[cursor];
        if (nextCharacter === '\\') {
          const escaped = text[cursor + 1] ?? '';
          value += escaped;
          cursor += 2;
          continue;
        }
        if (nextCharacter === character) {
          break;
        }
        value += nextCharacter;
        cursor += 1;
      }
      if (text[cursor] !== character) {
        throw new Error(`Unterminated string in expression: ${source}`);
      }
      tokens.push({ type: 'string', value });
      index = cursor + 1;
      continue;
    }
    if (/\d/u.test(character)) {
      let cursor = index + 1;
      while (cursor < text.length && /[\d.]/u.test(text[cursor])) {
        cursor += 1;
      }
      tokens.push({ type: 'number', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      let cursor = index + 1;
      while (cursor < text.length && /[A-Za-z0-9_$]/u.test(text[cursor])) {
        cursor += 1;
      }
      tokens.push({ type: 'identifier', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }

    throw new Error(`Unexpected token "${character}" in expression: ${source}`);
  }

  return tokens;
}

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

function parseExpression(source = '') {
  const tokens = tokenizeExpression(source);
  let index = 0;

  const peek = () => tokens[index] ?? null;
  const consume = (expectedValue = null) => {
    const token = tokens[index] ?? null;
    if (!token) {
      throw new Error(`Unexpected end of expression: ${source}`);
    }
    if (expectedValue !== null && token.value !== expectedValue) {
      throw new Error(`Expected "${expectedValue}" in expression: ${source}`);
    }
    index += 1;
    return token;
  };

  const parsePrimary = () => {
    const token = peek();
    if (!token) {
      throw new Error(`Unexpected end of expression: ${source}`);
    }

    if (token.type === 'number') {
      consume();
      return { type: 'Literal', value: Number(token.value) };
    }

    if (token.type === 'string') {
      consume();
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'identifier') {
      consume();
      if (token.value === 'true') return { type: 'Literal', value: true };
      if (token.value === 'false') return { type: 'Literal', value: false };
      if (token.value === 'null') return { type: 'Literal', value: null };
      return { name: token.value, type: 'Identifier' };
    }

    if (token.value === '(') {
      consume('(');
      const expression = parseBinaryExpression(0);
      consume(')');
      return expression;
    }

    if (token.value === '[') {
      consume('[');
      const elements = [];
      while (peek() && peek().value !== ']') {
        elements.push(parseBinaryExpression(0));
        if (peek()?.value === ',') {
          consume(',');
        }
      }
      consume(']');
      return { elements, type: 'ArrayExpression' };
    }

    if (token.value === '{') {
      consume('{');
      const properties = [];
      while (peek() && peek().value !== '}') {
        const keyToken = consume();
        const key = keyToken.type === 'identifier' ? keyToken.value : String(keyToken.value ?? '');
        consume(':');
        properties.push({ key, value: parseBinaryExpression(0) });
        if (peek()?.value === ',') {
          consume(',');
        }
      }
      consume('}');
      return { properties, type: 'ObjectExpression' };
    }

    throw new Error(`Unexpected token "${token.value}" in expression: ${source}`);
  };

  const parsePostfix = (baseNode) => {
    let node = baseNode;
    while (peek()) {
      if (peek().value === '.') {
        consume('.');
        const property = consume();
        if (property.type !== 'identifier') {
          throw new Error(`Expected property name in expression: ${source}`);
        }
        node = {
          computed: false,
          object: node,
          property: { name: property.value, type: 'Identifier' },
          type: 'MemberExpression',
        };
        continue;
      }

      if (peek().value === '[') {
        consume('[');
        const property = parseBinaryExpression(0);
        consume(']');
        node = {
          computed: true,
          object: node,
          property,
          type: 'MemberExpression',
        };
        continue;
      }

      if (peek().value === '(') {
        consume('(');
        const args = [];
        while (peek() && peek().value !== ')') {
          args.push(parseBinaryExpression(0));
          if (peek()?.value === ',') {
            consume(',');
          }
        }
        consume(')');
        node = {
          arguments: args,
          callee: node,
          type: 'CallExpression',
        };
        continue;
      }

      break;
    }
    return node;
  };

  const parseUnary = () => {
    const token = peek();
    if (token?.type === 'operator' && ['!', '-'].includes(token.value)) {
      consume();
      return {
        argument: parseUnary(),
        operator: token.value,
        type: 'UnaryExpression',
      };
    }

    return parsePostfix(parsePrimary());
  };

  const parseBinaryExpression = (minimumPrecedence) => {
    let left = parseUnary();
    while (true) {
      const operator = peek();
      const precedence = operator ? BINARY_PRECEDENCE[operator.value] : null;
      if (!precedence || precedence < minimumPrecedence) {
        break;
      }

      consume();
      const right = parseBinaryExpression(precedence + 1);
      left = {
        left,
        operator: operator.value,
        right,
        type: 'BinaryExpression',
      };
    }
    return left;
  };

  const ast = parseBinaryExpression(0);
  if (index < tokens.length) {
    throw new Error(`Unexpected token "${tokens[index].value}" in expression: ${source}`);
  }
  return ast;
}

class ExpressionScope {
  constructor({ locals = {}, parent = null, rootContext }) {
    this.locals = locals;
    this.parent = parent;
    this.rootContext = rootContext;
  }

  child(locals = {}) {
    return new ExpressionScope({
      locals,
      parent: this,
      rootContext: this.rootContext,
    });
  }

  has(name) {
    if (Object.hasOwn(this.locals, name)) {
      return true;
    }
    return this.parent?.has(name) ?? false;
  }

  get(name) {
    if (Object.hasOwn(this.locals, name)) {
      return this.locals[name];
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return this.rootContext.resolveIdentifier(name);
  }
}

function normalizeDuration(duration) {
  const match = String(duration ?? '').trim().match(/^(-?\d+)\s*([smhdw])$/iu);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
    w: 604_800_000,
  }[unit];
  return Number.isFinite(amount) && multiplier ? amount * multiplier : null;
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{8}$/u.test(normalized)) {
    return new Date(`${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T00:00:00`);
  }

  if (/^\d{8}\d{4}$/u.test(normalized)) {
    return new Date(`${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T${normalized.slice(8, 10)}:${normalized.slice(10, 12)}:00`);
  }

  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isDateLikeString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return (
    /^\d{8}(?:\d{4})?$/u.test(normalized)
    || /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(normalized)
  );
}

function coerceDateComparable(value) {
  if (!isDateLikeString(value)) {
    return value;
  }

  return parseDateValue(value) ?? value;
}

function normalizeComparablePair(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return [
      left instanceof Date ? left : coerceDateComparable(left),
      right instanceof Date ? right : coerceDateComparable(right),
    ];
  }

  if (typeof left === 'string' && typeof right === 'string' && isDateLikeString(left) && isDateLikeString(right)) {
    return [
      parseDateValue(left) ?? left,
      parseDateValue(right) ?? right,
    ];
  }

  return [left, right];
}

function formatDateValue(value, format = 'YYYY-MM-DD') {
  const date = parseDateValue(value);
  if (!date) {
    return '';
  }

  const padded = (number) => String(number).padStart(2, '0');
  return String(format ?? 'YYYY-MM-DD')
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, padded(date.getMonth() + 1))
    .replace(/DD/g, padded(date.getDate()))
    .replace(/HH/g, padded(date.getHours()))
    .replace(/mm/g, padded(date.getMinutes()))
    .replace(/ss/g, padded(date.getSeconds()));
}

function toComparableValue(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

function toDisplayText(value) {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return formatDateValue(value, 'YYYY-MM-DD HH:mm:ss');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayText(entry)).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (value?.__baseType === 'file') {
    return value.path || value.name || '';
  }
  if (value?.__baseType === 'link') {
    return value.display || value.path || value.url || '';
  }
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object Object]';
    }
  }
  return String(value);
}

function valuesEqual(left, right) {
  const [normalizedLeft, normalizedRight] = normalizeComparablePair(left, right);

  left = normalizedLeft;
  right = normalizedRight;

  if (left?.__baseType === 'file' && right?.__baseType === 'file') {
    return left.path === right.path;
  }
  if (left?.__baseType === 'link' && right?.__baseType === 'link') {
    return left.url === right.url && left.path === right.path;
  }
  if (left instanceof Date || right instanceof Date) {
    return toComparableValue(left) === toComparableValue(right);
  }
  return left === right;
}

function resolveImageAttachmentPath(value, {
  rowFilePath = '',
  snapshot = null,
  sourcePath = '',
} = {}) {
  const text = String(value ?? '').trim();
  const rowsByPath = snapshot?.rowsByPath;
  if (!text || !rowsByPath) {
    return null;
  }

  const candidates = [];
  const seen = new Set();
  const appendCandidate = (candidate) => {
    const normalized = String(candidate ?? '').trim().replace(/\\/g, '/');
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (rowFilePath) {
    appendCandidate(resolveVaultRelativePath(rowFilePath, text));
  }
  if (sourcePath) {
    appendCandidate(resolveVaultRelativePath(sourcePath, text));
  }
  appendCandidate(text);

  return candidates.find((candidate) => (
    isImageAttachmentFilePath(candidate)
    && rowsByPath.has(candidate)
  )) ?? null;
}

function serializeBaseValue(value, options = {}) {
  if (value == null || value === '') {
    return { text: '', type: 'empty', value: null };
  }
  if (value instanceof Date) {
    return {
      iso: value.toISOString(),
      text: formatDateValue(value, 'YYYY-MM-DD HH:mm:ss'),
      type: 'date',
      value: value.toISOString(),
    };
  }
  if (Array.isArray(value)) {
    return {
      items: value.map((entry) => serializeBaseValue(entry, options)),
      text: toDisplayText(value),
      type: 'list',
      value: value.map((entry) => toDisplayText(entry)),
    };
  }
  if (value?.__baseType === 'file') {
    return {
      path: value.path,
      text: value.path,
      type: 'file',
      value: value.path,
    };
  }
  if (value?.__baseType === 'link') {
    return {
      external: value.external,
      path: value.path,
      text: value.display || value.path || value.url,
      type: 'link',
      url: value.url,
      value: value.display || value.path || value.url,
    };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'true' : 'false', type: 'boolean', value };
  }
  if (typeof value === 'number') {
    return { text: Number.isFinite(value) ? String(value) : '', type: 'number', value };
  }
  if (typeof value === 'string') {
    const imagePath = resolveImageAttachmentPath(value, options);
    if (imagePath) {
      return {
        path: imagePath,
        text: value,
        type: 'image',
        value: imagePath,
      };
    }
    return { text: value, type: 'string', value };
  }
  return {
    text: toDisplayText(value),
    type: 'object',
    value,
  };
}

function compareValues(left, right) {
  const [normalizedLeft, normalizedRight] = normalizeComparablePair(left, right);
  left = normalizedLeft;
  right = normalizedRight;

  const comparableLeft = toComparableValue(left);
  const comparableRight = toComparableValue(right);
  if (comparableLeft == null && comparableRight == null) return 0;
  if (comparableLeft == null) return 1;
  if (comparableRight == null) return -1;
  if (typeof comparableLeft === 'number' && typeof comparableRight === 'number') {
    return comparableLeft - comparableRight;
  }
  return String(toDisplayText(comparableLeft)).localeCompare(String(toDisplayText(comparableRight)), undefined, { sensitivity: 'base' });
}

function applyBinaryOperator(operator, left, right) {
  if (operator === '&&') {
    return Boolean(left) && Boolean(right);
  }
  if (operator === '||') {
    return Boolean(left) || Boolean(right);
  }
  if (operator === '==') {
    return valuesEqual(left, right);
  }
  if (operator === '!=') {
    return !valuesEqual(left, right);
  }
  if (operator === '<') {
    return compareValues(left, right) < 0;
  }
  if (operator === '<=') {
    return compareValues(left, right) <= 0;
  }
  if (operator === '>') {
    return compareValues(left, right) > 0;
  }
  if (operator === '>=') {
    return compareValues(left, right) >= 0;
  }
  if (operator === '+') {
    if (left instanceof Date && typeof right === 'string') {
      const duration = normalizeDuration(right);
      return duration == null ? left : new Date(left.getTime() + duration);
    }
    if (typeof left === 'string' || typeof right === 'string') {
      return `${toDisplayText(left)}${toDisplayText(right)}`;
    }
    return Number(left ?? 0) + Number(right ?? 0);
  }
  if (operator === '-') {
    if (left instanceof Date && typeof right === 'string') {
      const duration = normalizeDuration(right);
      return duration == null ? left : new Date(left.getTime() - duration);
    }
    if (left instanceof Date && right instanceof Date) {
      return left.getTime() - right.getTime();
    }
    return Number(left ?? 0) - Number(right ?? 0);
  }
  if (operator === '*') {
    return Number(left ?? 0) * Number(right ?? 0);
  }
  if (operator === '/') {
    return Number(right ?? 0) === 0 ? null : Number(left ?? 0) / Number(right ?? 0);
  }
  if (operator === '%') {
    return Number(right ?? 0) === 0 ? null : Number(left ?? 0) % Number(right ?? 0);
  }

  throw new Error(`Unsupported operator: ${operator}`);
}

function invokeGlobalFunction(name, argNodes, scope, evaluate) {
  if (name === 'if') {
    const condition = evaluate(argNodes[0], scope);
    return condition ? evaluate(argNodes[1], scope) : evaluate(argNodes[2], scope);
  }

  const args = argNodes.map((node) => evaluate(node, scope));
  switch (name) {
    case 'date':
      return parseDateValue(args[0]);
    case 'link': {
      const target = String(args[0] ?? '').trim();
      if (!target) {
        return null;
      }
      const external = /^[a-z]+:/iu.test(target);
      return createLinkValue(target, {
        display: typeof args[1] === 'string' ? args[1] : '',
        exists: external,
        external,
      });
    }
    case 'list':
      return args;
    case 'max':
      return args.flat().reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'min':
      return args.flat().reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'now':
      return new Date();
    case 'today': {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date;
    }
    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

function invokeMethod(target, name, argNodes, scope, evaluate, rootContext) {
  if (target?.__baseType === 'formula-namespace') {
    if (argNodes.length > 0) {
      throw new Error(`Formula namespace property "${name}" is not callable`);
    }
    return rootContext.resolveFormulaValue(name, target.row, target.evaluationState);
  }

  if (Array.isArray(target)) {
    if (name === 'contains') {
      const needle = evaluate(argNodes[0], scope);
      return target.some((entry) => valuesEqual(entry, needle));
    }
    if (name === 'containsAll') {
      return argNodes.every((node) => target.some((entry) => valuesEqual(entry, evaluate(node, scope))));
    }
    if (name === 'containsAny') {
      return argNodes.some((node) => target.some((entry) => valuesEqual(entry, evaluate(node, scope))));
    }
    if (name === 'filter') {
      const predicate = argNodes[0];
      return target.filter((value, index) => Boolean(evaluate(predicate, scope.child({ index, value }))));
    }
    if (name === 'flat') {
      return target.flat();
    }
    if (name === 'isEmpty') {
      return target.length === 0;
    }
    if (name === 'join') {
      return target.map((entry) => toDisplayText(entry)).join(String(evaluate(argNodes[0], scope) ?? ''));
    }
    if (name === 'map') {
      const mapper = argNodes[0];
      return target.map((value, index) => evaluate(mapper, scope.child({ index, value })));
    }
    if (name === 'reduce') {
      const reducer = argNodes[0];
      let accumulator = argNodes.length > 1 ? evaluate(argNodes[1], scope) : null;
      target.forEach((value, index) => {
        accumulator = evaluate(reducer, scope.child({ acc: accumulator, index, value }));
      });
      return accumulator;
    }
    if (name === 'reverse') {
      return [...target].reverse();
    }
    if (name === 'slice') {
      return target.slice(Number(evaluate(argNodes[0], scope) ?? 0), argNodes[1] ? Number(evaluate(argNodes[1], scope)) : undefined);
    }
    if (name === 'sort') {
      return [...target].sort(compareValues);
    }
    if (name === 'unique') {
      const uniqueValues = [];
      target.forEach((value) => {
        if (!uniqueValues.some((entry) => valuesEqual(entry, value))) {
          uniqueValues.push(value);
        }
      });
      return uniqueValues;
    }
  }

  if (typeof target === 'string') {
    switch (name) {
      case 'contains':
        return target.toLowerCase().includes(String(evaluate(argNodes[0], scope) ?? '').toLowerCase());
      case 'endsWith':
        return target.endsWith(String(evaluate(argNodes[0], scope) ?? ''));
      case 'isEmpty':
        return target.length === 0;
      case 'lower':
        return target.toLowerCase();
      case 'replace':
        return target.replaceAll(String(evaluate(argNodes[0], scope) ?? ''), String(evaluate(argNodes[1], scope) ?? ''));
      case 'split':
        return target.split(String(evaluate(argNodes[0], scope) ?? ''));
      case 'startsWith':
        return target.startsWith(String(evaluate(argNodes[0], scope) ?? ''));
      case 'title':
        return target.replace(/\b\p{L}/gu, (match) => match.toUpperCase());
      case 'trim':
        return target.trim();
      case 'upper':
        return target.toUpperCase();
      default:
        break;
    }
  }

  if (typeof target === 'number') {
    switch (name) {
      case 'ceil':
        return Math.ceil(target);
      case 'floor':
        return Math.floor(target);
      case 'isEmpty':
        return false;
      case 'round':
        return Number.isFinite(evaluate(argNodes[0], scope))
          ? Number(target.toFixed(Number(evaluate(argNodes[0], scope))))
          : Math.round(target);
      case 'toFixed':
        return target.toFixed(Number(evaluate(argNodes[0], scope) ?? 0));
      default:
        break;
    }
  }

  const asDate = parseDateValue(target);
  if (asDate) {
    switch (name) {
      case 'format':
        return formatDateValue(asDate, String(evaluate(argNodes[0], scope) ?? 'YYYY-MM-DD'));
      case 'isEmpty':
        return false;
      default:
        break;
    }
  }

  if (target?.__baseType === 'file') {
    switch (name) {
      case 'asLink':
        return createLinkValue(target.path, {
          display: typeof evaluate(argNodes[0], scope) === 'string' ? evaluate(argNodes[0], scope) : '',
          exists: true,
        });
      case 'hasLink': {
        const needle = evaluate(argNodes[0], scope);
        const needlePath = needle?.__baseType === 'file'
          ? needle.path
          : (needle?.__baseType === 'link' ? needle.path : String(needle ?? ''));
        return target.links.some((link) => link.path === needlePath || link.rawTarget === needlePath);
      }
      case 'hasProperty':
        return Object.hasOwn(target.properties, String(evaluate(argNodes[0], scope) ?? ''));
      case 'hasTag':
        return argNodes.some((node) => {
          const value = String(evaluate(node, scope) ?? '').replace(/^#/u, '');
          return target.tags.some((tag) => tag === value || tag.startsWith(`${value}/`));
        });
      case 'inFolder': {
        const folder = String(evaluate(argNodes[0], scope) ?? '').replace(/\/+$/u, '');
        return !folder || target.folder === folder || target.folder.startsWith(`${folder}/`);
      }
      default:
        break;
    }
  }

  if (target?.__baseType === 'link') {
    switch (name) {
      case 'asFile':
        return target.path ? rootContext.snapshot.rowsByPath.get(target.path)?.file ?? null : null;
      case 'linksTo': {
        const other = evaluate(argNodes[0], scope);
        const otherPath = other?.__baseType === 'file'
          ? other.path
          : (other?.__baseType === 'link' ? other.path : String(other ?? ''));
        return target.path === otherPath;
      }
      default:
        break;
    }
  }

  if (isPlainObject(target)) {
    switch (name) {
      case 'isEmpty':
        return Object.keys(target).length === 0;
      case 'keys':
        return Object.keys(target);
      case 'values':
        return Object.values(target);
      default:
        break;
    }
  }

  throw new Error(`Unsupported method "${name}"`);
}

function evaluateAst(ast, scope) {
  const rootContext = scope.rootContext;
  const evaluate = (node, nextScope = scope) => evaluateAst(node, nextScope);

  switch (ast?.type) {
    case 'ArrayExpression':
      return ast.elements.map((element) => evaluate(element, scope));
    case 'BinaryExpression':
      return applyBinaryOperator(ast.operator, evaluate(ast.left, scope), evaluate(ast.right, scope));
    case 'CallExpression': {
      if (ast.callee?.type === 'Identifier') {
        return invokeGlobalFunction(ast.callee.name, ast.arguments, scope, evaluate);
      }
      if (ast.callee?.type === 'MemberExpression') {
        const target = evaluate(ast.callee.object, scope);
        const property = ast.callee.computed
          ? evaluate(ast.callee.property, scope)
          : ast.callee.property.name;
        return invokeMethod(target, String(property ?? ''), ast.arguments, scope, evaluate, rootContext);
      }
      throw new Error('Unsupported call target');
    }
    case 'Identifier':
      return scope.get(ast.name);
    case 'Literal':
      return ast.value;
    case 'MemberExpression': {
      const target = evaluate(ast.object, scope);
      const property = ast.computed ? evaluate(ast.property, scope) : ast.property.name;
      if (target?.__baseType === 'formula-namespace') {
        return rootContext.resolveFormulaValue(String(property ?? ''), target.row, target.evaluationState);
      }
      if (target == null) {
        return null;
      }
      return target[property];
    }
    case 'ObjectExpression':
      return ast.properties.reduce((acc, property) => {
        acc[property.key] = evaluate(property.value, scope);
        return acc;
      }, {});
    case 'UnaryExpression': {
      const value = evaluate(ast.argument, scope);
      return ast.operator === '!' ? !value : -Number(value ?? 0);
    }
    default:
      throw new Error(`Unsupported expression node "${ast?.type}"`);
  }
}

function evaluateExpression(expressionSource, rootContext, locals = {}) {
  const cache = rootContext.astCache;
  let ast = cache.get(expressionSource);
  if (!ast) {
    ast = parseExpression(expressionSource);
    cache.set(expressionSource, ast);
  }
  const scope = new ExpressionScope({ locals, rootContext });
  return evaluateAst(ast, scope);
}

function evaluateFilterNode(filterNode, rootContext) {
  if (!filterNode) {
    return true;
  }
  if (typeof filterNode === 'string') {
    return Boolean(evaluateExpression(filterNode, rootContext));
  }
  if (!isPlainObject(filterNode)) {
    return true;
  }

  if (Array.isArray(filterNode.and)) {
    return filterNode.and.every((entry) => evaluateFilterNode(entry, rootContext));
  }
  if (Array.isArray(filterNode.or)) {
    return filterNode.or.some((entry) => evaluateFilterNode(entry, rootContext));
  }
  if (filterNode.not != null) {
    return !evaluateFilterNode(filterNode.not, rootContext);
  }

  return true;
}

function normalizeFormulaLookupName(name = '') {
  return String(name ?? '').replace(/^formula\./u, '');
}

function createEvaluationRootContext({
  astCache = new Map(),
  currentRow,
  definition,
  evaluationState = null,
  identifierResolver = null,
  snapshot,
  thisFile,
}) {
  const nextEvaluationState = evaluationState ?? {
    cache: new Map(),
    stack: new Set(),
  };

  return {
    astCache,
    currentRow,
    definition,
    evaluationState: nextEvaluationState,
    resolveFormulaValue: (name, row, state = nextEvaluationState) => {
      const formulaName = normalizeFormulaLookupName(name);
      const formulaPropertyId = Object.keys(definition.properties).find((propertyId) => {
        const config = definition.properties[propertyId];
        return config?.formula && normalizeFormulaLookupName(propertyId) === formulaName;
      });
      if (!formulaPropertyId) {
        return null;
      }

      const cacheKey = `${row.file.path}::${formulaPropertyId}`;
      if (state.cache.has(cacheKey)) {
        return state.cache.get(cacheKey);
      }
      if (state.stack.has(cacheKey)) {
        throw new Error(`Circular formula reference: ${formulaPropertyId}`);
      }

      state.stack.add(cacheKey);
      const nextContext = createEvaluationRootContext({
        astCache,
        currentRow: row,
        definition,
        evaluationState: state,
        snapshot,
        thisFile,
      });
      const result = evaluateExpression(definition.properties[formulaPropertyId].formula, nextContext);
      state.stack.delete(cacheKey);
      state.cache.set(cacheKey, result);
      return result;
    },
    resolveIdentifier: (name) => {
      if (typeof identifierResolver === 'function') {
        const resolved = identifierResolver(name);
        if (resolved !== undefined) {
          return resolved;
        }
      }
      if (name === 'file') {
        return currentRow.file;
      }
      if (name === 'formula') {
        return createFormulaNamespace(currentRow, nextEvaluationState);
      }
      if (name === 'note') {
        return currentRow.noteProperties;
      }
      if (name === 'this') {
        return createContextFileValue(thisFile);
      }
      if (name === 'values') {
        return [];
      }
      if (Object.hasOwn(currentRow.noteProperties, name)) {
        return currentRow.noteProperties[name];
      }
      return null;
    },
    snapshot,
    thisFile,
  };
}

function resolvePropertyLabel(propertyId, definition) {
  const config = definition.properties[propertyId];
  if (config?.displayName) {
    return config.displayName;
  }
  return propertyId.startsWith('file.')
    ? propertyId.slice(5)
    : propertyId.replace(/^note\./u, '');
}

function getPropertyValue(propertyId, row, definition, snapshot, thisFile) {
  if (propertyId.startsWith('file.')) {
    return propertyId.split('.').slice(1).reduce((acc, segment) => acc?.[segment], row.file);
  }

  if (propertyId.startsWith('note.')) {
    return row.noteProperties[propertyId.slice(5)] ?? null;
  }

  const propertyConfig = definition.properties[propertyId];
  if (propertyConfig?.formula) {
    const context = createEvaluationRootContext({
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
    return context.resolveFormulaValue(propertyId, row, context.evaluationState);
  }

  const formulaConfig = definition.properties[`formula.${propertyId}`];
  if (formulaConfig?.formula) {
    const context = createEvaluationRootContext({
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
    return context.resolveFormulaValue(propertyId, row, context.evaluationState);
  }

  return row.noteProperties[propertyId] ?? null;
}

function buildColumns(definition, view) {
  const order = view.order.length > 0
    ? view.order
    : ['file.name', ...Object.keys(definition.properties)];
  return order.map((propertyId) => ({
    id: propertyId,
    label: resolvePropertyLabel(propertyId, definition),
  }));
}

function collectEvaluatedPropertyIds(columns, view) {
  const propertyIds = new Set(columns.map((column) => column.id));

  if (view.groupBy) {
    propertyIds.add(view.groupBy);
  }

  view.sort.forEach((sortConfig) => {
    if (sortConfig?.property) {
      propertyIds.add(sortConfig.property);
    }
  });

  view.summaries.forEach((summary) => {
    if (summary?.property) {
      propertyIds.add(summary.property);
    }
  });

  return [...propertyIds];
}

function summarizeValues(values = [], summary, definition, snapshot, thisFile) {
  const meaningfulValues = values.filter((value) => value != null && value !== '');
  switch (summary.type) {
    case 'average': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    case 'checked':
      return values.filter(Boolean).length;
    case 'custom': {
      const context = createEvaluationRootContext({
        astCache: new Map(),
        currentRow: {
          file: thisFile,
          noteProperties: thisFile?.properties ?? {},
        },
        definition,
        identifierResolver: (name) => (name === 'values' ? values : undefined),
        snapshot,
        thisFile,
      });
      return evaluateExpression(summary.formula, context);
    }
    case 'earliest':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'empty':
      return values.filter((value) => value == null || value === '').length;
    case 'filled':
      return meaningfulValues.length;
    case 'latest':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'max':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'median': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
      if (numbers.length === 0) return null;
      const middle = Math.floor(numbers.length / 2);
      return numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
    }
    case 'min':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'range': {
      const sorted = meaningfulValues.slice().sort(compareValues);
      if (sorted.length === 0) return null;
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first instanceof Date && last instanceof Date) {
        return last.getTime() - first.getTime();
      }
      return Number(last ?? 0) - Number(first ?? 0);
    }
    case 'stddev': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite);
      if (numbers.length === 0) return null;
      const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
      return Math.sqrt(variance);
    }
    case 'sum':
      return meaningfulValues.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    case 'unchecked':
      return values.filter((value) => value === false || value == null).length;
    case 'unique': {
      const uniqueValues = [];
      meaningfulValues.forEach((value) => {
        if (!uniqueValues.some((entry) => valuesEqual(entry, value))) {
          uniqueValues.push(value);
        }
      });
      return uniqueValues.length;
    }
    default:
      return null;
  }
}

function createSummaryPayload(columns, rows, summaries, definition, snapshot, thisFile) {
  return summaries.map((summary) => {
    const column = columns.find((entry) => entry.id === summary.property);
    const values = rows.map((row) => row.rawCells[summary.property]);
    const value = summarizeValues(values, summary, definition, snapshot, thisFile);
    return {
      id: summary.id,
      label: summary.label,
      property: summary.property,
      propertyLabel: column?.label ?? summary.property,
      value: serializeBaseValue(value, {
        snapshot,
        sourcePath: thisFile?.path ?? '',
      }),
    };
  });
}

function rowMatchesSearch(row, columns, query) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    row.file.path,
    ...columns.map((column) => toDisplayText(row.rawCells[column.id])),
  ].join('\n').toLowerCase();
  return haystack.includes(normalizedQuery);
}

function createCsv(rows, columns) {
  const escapeCell = (value) => {
    const text = String(value ?? '');
    if (/[,"\n]/u.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [
    columns.map((column) => escapeCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => escapeCell(toDisplayText(row.rawCells[column.id]))).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function serializeBaseDefinition(definition) {
  const raw = definition?.raw ?? definition ?? {};
  return `${yaml.dump(raw, { lineWidth: -1, noRefs: true }).trim()}\n`;
}

export class BaseQueryService {
  constructor({
    vaultFileStore,
    workspaceStateProvider = null,
    workspaceStateSynchronizer = null,
  }) {
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateProvider = workspaceStateProvider;
    this.workspaceStateSynchronizer = workspaceStateSynchronizer;
    this.indexSnapshot = null;
    this.lastWorkspaceState = null;
  }

  async getWorkspaceState() {
    const workspaceState = await this.workspaceStateProvider?.();
    if (workspaceState) {
      this.lastWorkspaceState = workspaceState;
      return workspaceState;
    }

    if (this.lastWorkspaceState) {
      return this.lastWorkspaceState;
    }

    const scannedWorkspaceState = await this.vaultFileStore.scanWorkspaceState();
    this.lastWorkspaceState = scannedWorkspaceState;
    return scannedWorkspaceState;
  }

  createSnapshotRow(filePath, workspaceState, wikiTargetIndex, markdownContent = null) {
    const metadata = workspaceState.metadata.get(filePath) ?? null;
    const frontmatter = markdownContent ? extractYamlFrontmatter(markdownContent) : null;
    const noteProperties = isPlainObject(frontmatter?.data) ? frontmatter.data : {};
    const bodyMarkdown = frontmatter?.bodyMarkdown ?? markdownContent ?? '';
    const references = extractReferences(bodyMarkdown, wikiTargetIndex);
    const tags = [...new Set([
      ...normalizeTags(noteProperties.tags),
      ...extractInlineTags(bodyMarkdown),
    ])];
    const fileValue = {
      __baseType: 'file',
      backlinks: [],
      basename: stripVaultFileExtension(basename(filePath)),
      ctime: Number.isFinite(metadata?.ctimeMs) ? new Date(metadata.ctimeMs) : null,
      embeds: references.embeds,
      ext: extname(filePath).replace(/^\./u, ''),
      folder: dirname(filePath) === '.' ? '' : dirname(filePath).replace(/\\/g, '/'),
      links: references.links,
      mtime: Number.isFinite(metadata?.mtimeMs) ? new Date(metadata.mtimeMs) : null,
      name: basename(filePath),
      path: filePath,
      properties: noteProperties,
      size: Number(metadata?.size ?? 0) || 0,
      tags,
    };

    return {
      forwardLinks: new Set(
        references.links
          .map((link) => link?.path)
          .filter((targetPath) => targetPath && targetPath !== filePath),
      ),
      row: {
        file: fileValue,
        noteProperties,
        path: filePath,
      },
    };
  }

  rebuildBacklinks(snapshot) {
    const backlinksByTarget = new Map(snapshot.filePaths.map((filePath) => [filePath, []]));

    snapshot.rowsByPath.forEach((row, filePath) => {
      const forwardLinks = snapshot.forwardLinksByPath.get(filePath) ?? new Set();
      forwardLinks.forEach((targetPath) => {
        if (!backlinksByTarget.has(targetPath) || targetPath === row.file.path) {
          return;
        }

        backlinksByTarget.get(targetPath).push(createLinkValue(row.file.path, {
          display: basename(row.file.path),
          exists: true,
        }));
      });
    });

    snapshot.backlinksByPath = backlinksByTarget;
    snapshot.rowsByPath.forEach((row, filePath) => {
      row.file.backlinks = dedupeLinkValues(backlinksByTarget.get(filePath) ?? []);
    });
  }

  async buildIndexSnapshot(workspaceState = null) {
    const resolvedWorkspaceState = workspaceState ?? await this.getWorkspaceState();
    const fileEntries = listWorkspaceFilePaths(resolvedWorkspaceState);
    const wikiTargetIndex = createWikiTargetIndex(fileEntries);
    const markdownContents = new Map();

    await mapWithConcurrency(resolvedWorkspaceState.markdownPaths ?? [], INDEX_READ_CONCURRENCY, async (filePath) => {
      markdownContents.set(filePath, await this.vaultFileStore.readMarkdownFile(filePath));
    });

    const rowsByPath = new Map();
    const forwardLinksByPath = new Map();
    fileEntries.forEach((filePath) => {
      const markdownContent = markdownContents.get(filePath) ?? null;
      const rowRecord = this.createSnapshotRow(filePath, resolvedWorkspaceState, wikiTargetIndex, markdownContent);
      rowsByPath.set(filePath, rowRecord.row);
      forwardLinksByPath.set(filePath, rowRecord.forwardLinks);
    });

    const snapshot = {
      backlinksByPath: new Map(),
      filePaths: fileEntries,
      forwardLinksByPath,
      rowsByPath,
      scannedAt: resolvedWorkspaceState.scannedAt,
      wikiTargetIndex,
      workspaceState: resolvedWorkspaceState,
    };
    this.rebuildBacklinks(snapshot);
    this.indexSnapshot = snapshot;
    this.lastWorkspaceState = resolvedWorkspaceState;
    return snapshot;
  }

  async synchronizeWorkspaceState() {
    await this.workspaceStateSynchronizer?.();
  }

  removeSnapshotPath(snapshot, filePath) {
    snapshot.rowsByPath.delete(filePath);
    snapshot.forwardLinksByPath.delete(filePath);
    snapshot.backlinksByPath.delete(filePath);
    snapshot.filePaths = snapshot.filePaths.filter((candidatePath) => candidatePath !== filePath);
  }

  upsertSnapshotPath(snapshot, filePath) {
    if (snapshot.filePaths.includes(filePath)) {
      return;
    }

    snapshot.filePaths.push(filePath);
    snapshot.filePaths.sort(compareVaultPaths);
  }

  collectImpactedSourcesForMembershipChanges(snapshot, pathValues = []) {
    const affectedTargetKeys = new Set();
    pathValues.forEach((pathValue) => {
      collectWikiTargetKeysForFilePath(pathValue).forEach((targetKey) => {
        affectedTargetKeys.add(targetKey);
      });
    });

    if (affectedTargetKeys.size === 0) {
      return new Set();
    }

    const impactedPaths = new Set();
    snapshot.rowsByPath.forEach((row, filePath) => {
      const links = row?.file?.links ?? [];
      if (links.some((link) => affectedTargetKeys.has(normalizeWikiTargetKey(link?.rawTarget)))) {
        impactedPaths.add(filePath);
      }
    });

    return impactedPaths;
  }

  async refreshSnapshotRows(snapshot, workspaceState, pathValues = []) {
    const filePathsToRefresh = Array.from(new Set(pathValues))
      .filter((pathValue) => {
        const entry = workspaceState?.entries?.get(pathValue);
        return pathValue && isWorkspaceFileEntry(entry);
      });

    await mapWithConcurrency(filePathsToRefresh, INDEX_READ_CONCURRENCY, async (filePath) => {
      const markdownContent = isMarkdownFilePath(filePath)
        ? await this.vaultFileStore.readMarkdownFile(filePath)
        : null;
      const rowRecord = this.createSnapshotRow(filePath, workspaceState, snapshot.wikiTargetIndex, markdownContent);
      snapshot.rowsByPath.set(filePath, rowRecord.row);
      snapshot.forwardLinksByPath.set(filePath, rowRecord.forwardLinks);
    });
  }

  async ensureIndexSnapshot({ basePath = '', sourcePath = '' } = {}) {
    await this.synchronizeWorkspaceState();
    let workspaceState = await this.getWorkspaceState();
    const requiresFreshScan = [basePath, sourcePath]
      .filter(Boolean)
      .some((pathValue) => !workspaceState?.entries?.has?.(pathValue));
    if (requiresFreshScan) {
      workspaceState = await this.vaultFileStore.scanWorkspaceState();
      this.lastWorkspaceState = workspaceState;
      if (this.indexSnapshot?.scannedAt !== workspaceState?.scannedAt) {
        this.indexSnapshot = null;
      }
    }

    if (this.indexSnapshot?.scannedAt === workspaceState?.scannedAt) {
      return this.indexSnapshot;
    }

    return this.buildIndexSnapshot(workspaceState);
  }

  async initializeFromWorkspaceState(workspaceState = null) {
    this.lastWorkspaceState = workspaceState ?? null;
    if (this.indexSnapshot && workspaceState && this.indexSnapshot.scannedAt !== workspaceState.scannedAt) {
      this.indexSnapshot = null;
    }
    return this.indexSnapshot;
  }

  async applyWorkspaceChange(workspaceChange = {}, {
    previousState = null,
    nextState = null,
  } = {}) {
    this.lastWorkspaceState = nextState ?? this.lastWorkspaceState;
    if (!this.indexSnapshot) {
      return null;
    }

    if (!previousState || this.indexSnapshot.scannedAt !== previousState.scannedAt) {
      this.indexSnapshot = null;
      return null;
    }

    const changedPaths = Array.from(new Set(workspaceChange.changedPaths ?? []));
    const deletedFilePaths = (workspaceChange.deletedPaths ?? []).filter((pathValue) => (
      isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const renamedFileEntries = (workspaceChange.renamedPaths ?? []).filter((entry) => (
      isWorkspaceFileEntry(previousState?.entries?.get(entry?.oldPath))
      || isWorkspaceFileEntry(nextState?.entries?.get(entry?.newPath))
    ));
    const createdFilePaths = changedPaths.filter((pathValue) => (
      isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
      && !isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const removedChangedFilePaths = changedPaths.filter((pathValue) => (
      !isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
      && isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const membershipChanged = deletedFilePaths.length > 0
      || renamedFileEntries.length > 0
      || createdFilePaths.length > 0
      || removedChangedFilePaths.length > 0;

    const markdownPathsToRefresh = changedPaths.filter((pathValue) => (
      isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
      && isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
    ));

    if (!membershipChanged && markdownPathsToRefresh.length === 0) {
      this.indexSnapshot.workspaceState = nextState ?? this.indexSnapshot.workspaceState;
      this.indexSnapshot.scannedAt = nextState?.scannedAt ?? this.indexSnapshot.scannedAt;
      return this.indexSnapshot;
    }

    const snapshot = this.indexSnapshot;
    if (membershipChanged) {
      const membershipAffectedPaths = [
        ...deletedFilePaths,
        ...removedChangedFilePaths,
        ...createdFilePaths,
        ...renamedFileEntries.flatMap((entry) => [entry.oldPath, entry.newPath]),
      ];
      const impactedSourcePaths = this.collectImpactedSourcesForMembershipChanges(snapshot, membershipAffectedPaths);

      [...deletedFilePaths, ...removedChangedFilePaths].forEach((pathValue) => {
        this.removeSnapshotPath(snapshot, pathValue);
      });
      renamedFileEntries.forEach((entry) => {
        this.removeSnapshotPath(snapshot, entry.oldPath);
      });
      [...createdFilePaths, ...renamedFileEntries.map((entry) => entry.newPath)].forEach((pathValue) => {
        const nextEntry = nextState?.entries?.get(pathValue);
        if (isWorkspaceFileEntry(nextEntry)) {
          this.upsertSnapshotPath(snapshot, pathValue);
        }
      });

      snapshot.wikiTargetIndex = createWikiTargetIndex(snapshot.filePaths);
      await this.refreshSnapshotRows(snapshot, nextState, [
        ...markdownPathsToRefresh,
        ...createdFilePaths,
        ...renamedFileEntries.map((entry) => entry.newPath),
        ...impactedSourcePaths,
      ]);
    } else {
      await this.refreshSnapshotRows(snapshot, nextState, markdownPathsToRefresh);
    }

    snapshot.workspaceState = nextState;
    snapshot.scannedAt = nextState?.scannedAt ?? snapshot.scannedAt;
    this.rebuildBacklinks(snapshot);
    return snapshot;
  }

  async query({
    activeFilePath = '',
    basePath = '',
    search = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    const baseSource = source ?? (basePath ? await this.vaultFileStore.readBaseFile(basePath) : '');
    if (typeof baseSource !== 'string') {
      throw new Error('Base source not found');
    }

    const definition = normalizeBaseDefinition(baseSource);
    const snapshot = await this.ensureIndexSnapshot({
      basePath,
      sourcePath,
    });
    const thisFilePath = sourcePath || activeFilePath || basePath || '';
    const thisFile = snapshot.rowsByPath.get(thisFilePath)?.file ?? null;
    const activeView = definition.views.find((entry) => entry.name === requestedView || entry.id === requestedView) ?? definition.views[0];
    const columns = buildColumns(definition, activeView);
    const evaluatedPropertyIds = collectEvaluatedPropertyIds(columns, activeView);

    let rows = snapshot.filePaths
      .map((filePath) => snapshot.rowsByPath.get(filePath))
      .filter(Boolean)
      .filter((row) => {
        const globalContext = createEvaluationRootContext({
          currentRow: row,
          definition,
          snapshot,
          thisFile,
        });
        if (!evaluateFilterNode(definition.filters, globalContext)) {
          return false;
        }

        const viewContext = createEvaluationRootContext({
          currentRow: row,
          definition,
          snapshot,
          thisFile,
        });
        return evaluateFilterNode(activeView.filters, viewContext);
      })
      .map((row) => {
        const rawCells = {};
        evaluatedPropertyIds.forEach((propertyId) => {
          rawCells[propertyId] = getPropertyValue(propertyId, row, definition, snapshot, thisFile);
        });
        return {
          file: row.file,
          rawCells,
        };
      });

    activeView.sort.forEach((sortConfig) => {
      rows = rows.slice().sort((left, right) => {
        const delta = compareValues(left.rawCells[sortConfig.property], right.rawCells[sortConfig.property]);
        return sortConfig.direction === 'desc' ? -delta : delta;
      });
    });

    if (activeView.limit != null) {
      rows = rows.slice(0, activeView.limit);
    }

    rows = rows.filter((row) => rowMatchesSearch(row, columns, search));

    const groupsByKey = new Map();
    if (activeView.groupBy) {
      rows.forEach((row) => {
        const groupValue = row.rawCells[activeView.groupBy];
        const groupKey = toDisplayText(groupValue) || 'Empty';
        const entry = groupsByKey.get(groupKey) ?? {
          key: groupKey,
          label: groupKey,
          rows: [],
          value: serializeBaseValue(groupValue, {
            rowFilePath: row.file.path,
            snapshot,
            sourcePath: thisFile?.path ?? '',
          }),
        };
        entry.rows.push(row);
        groupsByKey.set(groupKey, entry);
      });
    } else {
      groupsByKey.set('All', {
        key: 'All',
        label: 'All',
        rows,
        value: serializeBaseValue(null),
      });
    }

    const serializedRows = rows.map((row) => ({
      cells: columns.reduce((acc, column) => {
        acc[column.id] = serializeBaseValue(row.rawCells[column.id], {
          rowFilePath: row.file.path,
          snapshot,
          sourcePath: thisFile?.path ?? '',
        });
        return acc;
      }, {}),
      file: serializeBaseValue(row.file, {
        rowFilePath: row.file.path,
        snapshot,
        sourcePath: thisFile?.path ?? '',
      }),
      path: row.file.path,
    }));
    const rowsByPath = new Map(serializedRows.map((row) => [row.path, row]));

    const groups = Array.from(groupsByKey.values()).map((group) => ({
      key: group.key,
      label: group.label,
      summaries: createSummaryPayload(columns, group.rows, activeView.summaries, definition, snapshot, thisFile),
      value: group.value,
      rows: group.rows.map((row) => rowsByPath.get(row.file.path)),
    }));

    return {
      columns,
      csv: createCsv(rows, columns),
      definition,
      groups,
      rows: serializedRows,
      summaries: createSummaryPayload(columns, rows, activeView.summaries, definition, snapshot, thisFile),
      thisFile: serializeBaseValue(thisFile, {
        snapshot,
        sourcePath: thisFile?.path ?? '',
      }),
      totalRows: rows.length,
      view: {
        ...activeView,
        supported: activeView.supported,
      },
      views: definition.views.map((view) => ({
        id: view.id,
        name: view.name,
        supported: view.supported,
        type: view.type,
      })),
    };
  }
}
