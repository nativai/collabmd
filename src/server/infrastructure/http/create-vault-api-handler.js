import { createPlantUmlApiHandler } from './create-plantuml-api-handler.js';
import { createVaultApiCommandHandler } from './create-vault-api-command-handler.js';
import { createVaultApiQueryHandler } from './create-vault-api-query-handler.js';

export function createVaultApiHandler({
  baseQueryService = null,
  backlinkIndex,
  config = {},
  docxExporter = null,
  plantUmlRenderer = null,
  roomRegistry = null,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const handleVaultApiQuery = createVaultApiQueryHandler({
    baseQueryService,
    backlinkIndex,
    config,
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
