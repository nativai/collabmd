import {
  buildColumns,
  collectEvaluatedPropertyIds,
  normalizeBaseDefinition,
} from './base-definition.js';
import {
  compareValues,
  createEvaluationRootContext,
  evaluateFilterNode,
  getPropertyValue,
} from './base-expression-runtime.js';
import { BaseIndexSnapshotStore } from './base-index-snapshot-store.js';
import { buildQueryResultPayload, rowMatchesSearch } from './base-query-results.js';

export { serializeBaseDefinition } from './base-definition.js';

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
    return this.snapshotStore.applyWorkspaceChange(...args);
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

    return {
      columns,
      definition,
      ...buildQueryResultPayload({
        activeView,
        columns,
        definition,
        rows,
        snapshot,
        thisFile,
      }),
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
