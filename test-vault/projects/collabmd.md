# CollabMD Project

Collaborative markdown vault editor.

## Architecture

```mermaid
graph TD
    A[CLI] --> B[Server]
    B --> C[Vault File Store]
    B --> D[Yjs Collaboration]
    D --> E[WebSocket]
    E --> F[Browser Client]
```

## Related
- [[README]]
- [[daily/2026-03-05]]
- [[]]