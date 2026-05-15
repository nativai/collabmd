import { getRuntimeVaultDir, resetE2EVaultSnapshot } from '../helpers/vault-snapshot.js';

await resetE2EVaultSnapshot(getRuntimeVaultDir(process.argv[2]));
