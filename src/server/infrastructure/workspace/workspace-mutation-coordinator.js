import { WorkspaceReconciliation } from '../../application/workspace-reconciliation.js';
import { createWorkspaceStateFileSystemAdapter } from './workspace-state-file-system-adapter.js';

export class WorkspaceMutationCoordinator extends WorkspaceReconciliation {
  constructor({
    vaultFileStore,
    workspaceStateAdapter = createWorkspaceStateFileSystemAdapter({
      vaultDir: vaultFileStore?.vaultDir,
    }),
    ...options
  }) {
    super({
      ...options,
      vaultFileStore,
      workspaceStateAdapter,
    });
  }
}

export { WorkspaceReconciliation };
