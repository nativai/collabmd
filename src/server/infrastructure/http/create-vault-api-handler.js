import { createPlantUmlApiHandler } from './create-plantuml-api-handler.js';
import { createVaultApiCommandHandler } from './create-vault-api-command-handler.js';
import { createVaultApiQueryHandler } from './create-vault-api-query-handler.js';

export function createVaultApiHandler({
  backlinkIndex,
  docxExporter = null,
  plantUmlRenderer = null,
  roomRegistry = null,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const handleVaultApiQuery = createVaultApiQueryHandler({
    backlinkIndex,
    vaultFileStore,
    workspaceMutationCoordinator,
  });
  const handleVaultApiCommand = createVaultApiCommandHandler({
    backlinkIndex,
    docxExporter,
    roomRegistry,
    vaultFileStore,
    workspaceMutationCoordinator,
  });
  const handlePlantUmlApi = createPlantUmlApiHandler({
    plantUmlRenderer,
  });

  return async function handleVaultApi(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith('/api/')) {
      return false;
    }

    if (await handleVaultApiQuery(req, res, requestUrl)) {
      return true;
    }

    if (await handleVaultApiCommand(req, res, requestUrl)) {
      return true;
    }

    if (await handlePlantUmlApi(req, res, requestUrl)) {
      return true;
    }

    return false;
  };
}
