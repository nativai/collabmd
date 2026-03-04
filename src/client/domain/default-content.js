export const DEFAULT_CONTENT = `# Welcome to CollabMD 🚀

A realtime collaborative markdown editor. Share the URL to start writing together!

## Features
- **Realtime collaboration** with live cursors
- **Mermaid diagrams** for visual documentation
- **Syntax highlighting** in code blocks
- **GitHub-flavored** markdown support

## Example Diagram

\`\`\`mermaid
graph TD
    A[Open CollabMD] -->|Share Link| B[Invite Collaborators]
    B --> C{Edit Together}
    C --> D[Write Markdown]
    C --> E[Create Diagrams]
    C --> F[Add Code Blocks]
    D --> G[Live Preview]
    E --> G
    F --> G
\`\`\`

## Code Example

\`\`\`javascript
function hello() {
  console.log("Hello, CollabMD!");
}
\`\`\`

| Feature | Status | Description | Platform | Version | Notes |
|---------|--------|-------------|----------|---------|-------|
| Realtime editing | ✅ | Collaborate with multiple users in real time | Web | 1.0 | Powered by Yjs CRDT |
| Mermaid diagrams | ✅ | Render flowcharts, sequence diagrams, and more | Web | 1.0 | Mermaid v11 |
| Code highlighting | ✅ | Syntax highlighting for 100+ languages | Web | 1.0 | Highlight.js |
| Dark mode | ✅ | Toggle between light and dark themes | Web | 1.0 | System-aware |

> "The best way to write documentation is together." — CollabMD
`;
