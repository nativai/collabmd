import {
  buildColumns,
  collectEvaluatedPropertyIds,
  findView,
  normalizeBaseDefinition,
} from './base-definition.js';
import {
  compareValues,
  createEvaluationRootContext,
  evaluateFilterNode,
  getPropertyValue,
  serializeBaseValue,
} from './base-expression-runtime.js';
import { BaseIndexSnapshotStore } from './base-index-snapshot-store.js';
import {
  buildAvailableProperties,
  collectDistinctPropertyValues,
  createPropertyCatalogSnapshot,
  inferValueType,
} from './base-query-metadata.js';
import { buildQueryResultPayload, rowMatchesSearch } from './base-query-results.js';
import { transformBaseSource } from './base-transform.js';

export { serializeBaseDefinition } from './base-definition.js';

function buildSortChain(activeView) {
  const entries = [];
  (activeView.sort ?? []).forEach((sortConfig) => {
    if (
      sortConfig?.property
      && !entries.some((entry) => entry.property === sortConfig.property)
    ) {
      entries.push(sortConfig);
    }
  });
  return entries;
}

function sortRows(rows, sortChain = []) {
  if (!Array.isArray(sortChain) || sortChain.length === 0) {
    return rows;
  }

  return rows.slice().sort((left, right) => {
    for (const sortConfig of sortChain) {
      const delta = compareValues(left.rawCells[sortConfig.property], right.rawCells[sortConfig.property]);
      if (delta !== 0) {
        return sortConfig.direction === 'desc' ? -delta : delta;
      }
    }

    return String(left.file.path ?? '').localeCompare(String(right.file.path ?? ''));
  });
}

function escapeRegExp(value = '') {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function pruneFilterNodeForProperty(filterNode, propertyId = '') {
  if (!propertyId || !filterNode) {
    return filterNode;
  }

  if (typeof filterNode === 'string') {
    const escapedPropertyId = escapeRegExp(propertyId);
    const propertyFilterPattern = new RegExp(
      `^!?${escapedPropertyId}(?:\\.(?:contains|startsWith|endsWith|isEmpty)\\(.*\\)|\\s*(?:==|!=|>=|<=|>|<)\\s*.+)$`,
      'u',
    );
    return propertyFilterPattern.test(String(filterNode ?? '').trim()) ? null : filterNode;
  }

  if (Array.isArray(filterNode?.and)) {
    const children = filterNode.and
      .map((child) => pruneFilterNodeForProperty(child, propertyId))
      .filter(Boolean);
    return children.length > 0 ? { and: children } : null;
  }

  if (Array.isArray(filterNode?.or)) {
    const children = filterNode.or
      .map((child) => pruneFilterNodeForProperty(child, propertyId))
      .filter(Boolean);
    return children.length > 0 ? { or: children } : null;
  }

  if (filterNode?.not != null) {
    if (Array.isArray(filterNode.not)) {
      const children = filterNode.not
        .map((child) => pruneFilterNodeForProperty(child, propertyId))
        .filter(Boolean);
      return children.length > 0 ? { not: children } : null;
    }

    const child = pruneFilterNodeForProperty(filterNode.not, propertyId);
    return child ? { not: child } : null;
  }

  return filterNode;
}

export class BaseQueryService {
  constructor({
    vaultFileStore,
    workspaceStateProvider = null,
    workspaceStateSynchronizer = null,
  }) {
    this.vaultFileStore = vaultFileStore;
    this.snapshotStore = new BaseIndexSnapshotStore({
      vaultFileStore,
      workspaceStateProvider,
      workspaceStateSynchronizer,
    });
    this.propertyCatalogCache = new Map();
  }

  get workspaceStateProvider() {
    return this.snapshotStore.workspaceStateProvider;
  }

  set workspaceStateProvider(value) {
    this.snapshotStore.workspaceStateProvider = value;
  }

  get workspaceStateSynchronizer() {
    return this.snapshotStore.workspaceStateSynchronizer;
  }

  set workspaceStateSynchronizer(value) {
    this.snapshotStore.workspaceStateSynchronizer = value;
  }

  get indexSnapshot() {
    return this.snapshotStore.indexSnapshot;
  }

  set indexSnapshot(value) {
    this.snapshotStore.indexSnapshot = value;
  }

  get lastWorkspaceState() {
    return this.snapshotStore.lastWorkspaceState;
  }

  set lastWorkspaceState(value) {
    this.snapshotStore.lastWorkspaceState = value;
  }

  async getWorkspaceState() {
    return this.snapshotStore.getWorkspaceState();
  }

  createSnapshotRow(...args) {
    return this.snapshotStore.createSnapshotRow(...args);
  }

  rebuildBacklinks(...args) {
    return this.snapshotStore.rebuildBacklinks(...args);
  }

  async buildIndexSnapshot(...args) {
    return this.snapshotStore.buildIndexSnapshot(...args);
  }

  async synchronizeWorkspaceState() {
    return this.snapshotStore.synchronizeWorkspaceState();
  }

  removeSnapshotPath(...args) {
    return this.snapshotStore.removeSnapshotPath(...args);
  }

  upsertSnapshotPath(...args) {
    return this.snapshotStore.upsertSnapshotPath(...args);
  }

  collectImpactedSourcesForMembershipChanges(...args) {
    return this.snapshotStore.collectImpactedSourcesForMembershipChanges(...args);
  }

  async refreshSnapshotRows(...args) {
    return this.snapshotStore.refreshSnapshotRows(...args);
  }

  async ensureIndexSnapshot(...args) {
    return this.snapshotStore.ensureIndexSnapshot(...args);
  }

  async initializeFromWorkspaceState(...args) {
    return this.snapshotStore.initializeFromWorkspaceState(...args);
  }

  async applyWorkspaceChange(...args) {
    const result = await this.snapshotStore.applyWorkspaceChange(...args);
    const scannedAt = this.snapshotStore.indexSnapshot?.scannedAt;
    if (scannedAt) {
      this.invalidatePropertyCatalogsExcept(scannedAt);
    } else {
      this.propertyCatalogCache.clear();
    }
    return result;
  }

  invalidatePropertyCatalogsExcept(scannedAt = '') {
    Array.from(this.propertyCatalogCache.keys()).forEach((cacheKey) => {
      if (cacheKey !== scannedAt) {
        this.propertyCatalogCache.delete(cacheKey);
      }
    });
  }

  async resolveQueryContext({
    activeFilePath = '',
    basePath = '',
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
    this.invalidatePropertyCatalogsExcept(snapshot?.scannedAt ?? '');

    const thisFilePath = sourcePath || activeFilePath || basePath || '';
    const thisFile = snapshot.rowsByPath.get(thisFilePath)?.file ?? null;
    const activeView = findView(definition, requestedView);
    const columns = buildColumns(definition, activeView);
    const evaluatedPropertyIds = collectEvaluatedPropertyIds(columns, activeView);

    return {
      activeView,
      basePath,
      baseSource,
      columns,
      definition,
      evaluatedPropertyIds,
      snapshot,
      sourcePath,
      thisFile,
    };
  }

  collectCandidateRows({
    activeView,
    astCache = new Map(),
    definition,
    evaluatedPropertyIds,
    snapshot,
    thisFile,
  }) {
    const rows = [];

    snapshot.filePaths.forEach((filePath) => {
      const row = snapshot.rowsByPath.get(filePath);
      if (!row) {
        return;
      }

      const rowContext = this.createRowQueryContext({
        astCache,
        definition,
        row,
        snapshot,
        thisFile,
      });
      if (!evaluateFilterNode(definition.filters, rowContext) || !evaluateFilterNode(activeView.filters, rowContext)) {
        return;
      }

      const rawCells = {};
      evaluatedPropertyIds.forEach((propertyId) => {
        rawCells[propertyId] = getPropertyValue(propertyId, row, definition, snapshot, thisFile, rowContext);
      });

      rows.push({
        file: row.file,
        rawCells,
      });
    });

    return rows;
  }

  createRowQueryContext({
    astCache = new Map(),
    definition,
    row,
    snapshot,
    thisFile,
  }) {
    return createEvaluationRootContext({
      astCache,
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
  }

  getPropertyCatalog(snapshot) {
    const cacheKey = snapshot?.scannedAt ?? 'unknown';
    if (!this.propertyCatalogCache.has(cacheKey)) {
      this.propertyCatalogCache.set(cacheKey, createPropertyCatalogSnapshot(snapshot));
    }

    return this.propertyCatalogCache.get(cacheKey);
  }

  inferFormulaValueTypes(definition, rows = []) {
    const valueTypes = {};

    Object.keys(definition.formulas ?? {}).forEach((propertyId) => {
      let inferred = 'unknown';
      for (const row of rows) {
        inferred = inferValueType(row?.rawCells?.[propertyId]);
        if (inferred !== 'unknown') {
          break;
        }
      }
      valueTypes[propertyId] = inferred;
    });

    return valueTypes;
  }

  buildMeta({
    activeView,
    basePath = '',
    columns,
    definition,
    rows,
    snapshot,
  }) {
    const propertyCatalog = this.getPropertyCatalog(snapshot);
    const formulaValueTypes = this.inferFormulaValueTypes(definition, rows);

    return {
      activeViewConfig: {
        filters: activeView.filters ?? null,
        groupBy: activeView.groupBy ?? null,
        order: [...(activeView.order ?? [])],
        sort: (activeView.sort ?? []).map((entry) => ({ ...entry })),
      },
      availableProperties: buildAvailableProperties({
        activeView,
        columns,
        definition,
        formulaValueTypes,
        propertyCatalog,
      }),
      editable: Boolean(basePath),
    };
  }

  async query({
    activeFilePath = '',
    basePath = '',
    includeCsv = false,
    search = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    const context = await this.resolveQueryContext({
      activeFilePath,
      basePath,
      source,
      sourcePath,
      view: requestedView,
    });

    const astCache = new Map();
    let rows = this.collectCandidateRows({
      ...context,
      astCache,
    });
    rows = rows.filter((row) => rowMatchesSearch(row, context.columns, search));
    rows = sortRows(rows, buildSortChain(context.activeView));

    if (context.activeView.limit != null) {
      rows = rows.slice(0, context.activeView.limit);
    }

    const payload = buildQueryResultPayload({
      activeView: context.activeView,
      columns: context.columns,
      definition: context.definition,
      includeCsv,
      rows,
      snapshot: context.snapshot,
      thisFile: context.thisFile,
    });

    return {
      columns: context.columns,
      definition: context.definition,
      meta: this.buildMeta({
        activeView: context.activeView,
        basePath,
        columns: context.columns,
        definition: context.definition,
        rows,
        snapshot: context.snapshot,
      }),
      ...payload,
      view: {
        ...context.activeView,
        supported: context.activeView.supported,
      },
      views: context.definition.views.map((view) => ({
        id: view.id,
        name: view.name,
        supported: view.supported,
        type: view.type,
      })),
    };
  }

  async propertyValues({
    activeFilePath = '',
    basePath = '',
    propertyId = '',
    query = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    if (!propertyId) {
      throw new Error('Missing propertyId');
    }

    const context = await this.resolveQueryContext({
      activeFilePath,
      basePath,
      source,
      sourcePath,
      view: requestedView,
    });
    const propertyValueContext = {
      ...context,
      activeView: {
        ...context.activeView,
        filters: pruneFilterNodeForProperty(context.activeView?.filters, propertyId),
      },
      definition: {
        ...context.definition,
        filters: pruneFilterNodeForProperty(context.definition?.filters, propertyId),
      },
    };
    const astCache = new Map();
    const rows = this.collectCandidateRows({
      ...propertyValueContext,
      astCache,
      evaluatedPropertyIds: [...new Set([
        ...(context.evaluatedPropertyIds ?? []),
        propertyId,
      ])],
    });
    const values = collectDistinctPropertyValues(rows, propertyId, query).map((entry) => ({
      count: entry.count,
      text: entry.text,
      value: serializeBaseValue(entry.value, {
        snapshot: context.snapshot,
        sourcePath: context.thisFile?.path ?? '',
      }),
    }));

    return {
      ok: true,
      propertyId,
      values,
    };
  }

  async transform({
    activeFilePath = '',
    basePath = '',
    mutation = null,
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    if (!basePath) {
      throw new Error('Only .base files can be transformed');
    }

    const baseSource = source ?? await this.vaultFileStore.readBaseFile(basePath);
    if (typeof baseSource !== 'string') {
      throw new Error('Base source not found');
    }

    const nextSource = transformBaseSource(baseSource, mutation);
    const result = await this.query({
      activeFilePath,
      basePath,
      source: nextSource,
      sourcePath,
      view,
    });

    return {
      meta: result.meta,
      result,
      source: nextSource,
    };
  }
}
