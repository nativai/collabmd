# Design System Audit

## Current Layer Map
- `foundation`: reset and accessibility in [`base.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/base.css), plus tokens/theme primitives in [`foundation/tokens.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/foundation/tokens.css) and [`foundation/themes.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/foundation/themes.css)
- `primitives`: buttons, icon buttons, inputs, badges, pills, panels, floating docks, and dialog surfaces in [`primitives/controls.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/primitives/controls.css)
- `layout`: shared overlays, sidebar, editor page, shell, view modes, and responsive layout rules in [`layout/overlays.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/overlays.css), [`layout/sidebar.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/sidebar.css), [`layout/editor-page.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/editor-page.css), [`layout/shell.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/shell.css), [`layout/view-modes.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/view-modes.css), and [`layout/responsive.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/responsive.css)
- `feature components`: git, diff, collaboration UI, comments, preview sidebars, quick switcher, and diagram preview styles in [`features/git.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/git.css), [`features/diff.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/diff.css), [`features/collaboration-ui.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/collaboration-ui.css), [`features/comments.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/comments.css), [`features/preview-sidebars.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/preview-sidebars.css), [`features/quick-switcher.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/quick-switcher.css), and [`features/diagram-preview.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/diagram-preview.css)
- `markdown and embedded content`: markdown preview, lightbox, mermaid, plantuml, and preview-only file states in [`features/preview-content.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/features/preview-content.css)
- `third-party overrides`: highlight.js, CodeMirror autocomplete, and scrollbar styling in [`overrides/vendor.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/overrides/vendor.css)
- `responsive overrides`: mobile layout tuning consolidated in [`layout/responsive.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/layout/responsive.css)

## High-Drift Areas
- Shared actions diverged into several families: `btn`, `sidebar-action-btn`, `diff-nav-btn`, `pane-header-btn`, `markdown-toolbar-btn`, `diagram-preview-action-btn`, and feature-local pill buttons.
- Typography and shape values drifted outside the token scale, especially `11px`, `12px`, `13px`, and multiple raw radii.
- Some presentation bypassed the system entirely through inline styles in [`public/index.html`](/Users/andes/Documents/andes/collabmd/public/index.html) and generated HTML in [`git-panel-controller.js`](/Users/andes/Documents/andes/collabmd/src/client/presentation/git-panel-controller.js).
- Semantic token gaps existed: `--color-surface-raised` and `--color-surface-ink` were referenced but not defined.

## Refactor Direction
- Keep `base.css` as reset/accessibility-only.
- Use [`style.css`](/Users/andes/Documents/andes/collabmd/src/client/styles/style.css) only as an ordered manifest.
- Add new semantic tokens before adding more local recipes.
- Prefer primitive plus variant composition over feature-local one-off controls.
- Keep JS behavior hooks stable while gradually shifting markup to shared primitive classes.
