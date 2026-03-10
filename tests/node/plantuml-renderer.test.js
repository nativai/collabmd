import test from 'node:test';
import assert from 'node:assert/strict';

import { PlantUmlRenderer } from '../../src/server/infrastructure/plantuml/plantuml-renderer.js';

test('PlantUmlRenderer accepts SVG payloads prefixed with PlantUML processing instructions', async () => {
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<?plantuml 1.2026.3beta3?><svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
    }),
    serverUrl: 'https://example.test/plantuml',
  });

  const svg = await renderer.renderSvg('@startuml\nAlice -> Bob: Hi\n@enduml\n');

  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>');
});

test('PlantUmlRenderer rejects non-SVG upstream payloads', async () => {
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-an-svg-response',
    }),
    serverUrl: 'https://example.test/plantuml',
  });

  await assert.rejects(
    () => renderer.renderSvg('@startuml\nAlice -> Bob: Hi\n@enduml\n'),
    /invalid SVG payload/i,
  );
});
