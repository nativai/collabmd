import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCollaboratorsMap,
  buildRenderableCollaboratorsMap,
  findCollaboratorByPeerId,
  getCollaboratorsRenderSignature,
  normalizeCollaboratorViewport,
} from '../../src/client/domain/excalidraw-collaboration.js';

test('normalizeCollaboratorViewport accepts finite viewport values', () => {
  assert.deepEqual(
    normalizeCollaboratorViewport({ scrollX: 10, scrollY: -4, zoom: 1.25 }),
    { scrollX: 10, scrollY: -4, zoom: 1.25 },
  );
  assert.equal(normalizeCollaboratorViewport({ scrollX: 10, scrollY: 2, zoom: 0 }), undefined);
  assert.equal(normalizeCollaboratorViewport({ scrollX: 'x', scrollY: 2, zoom: 1 }), undefined);
});

test('buildCollaboratorsMap preserves viewport awareness and peer lookup', () => {
  const awareness = {
    clientID: 9,
    getStates() {
      return new Map([
        [3, {
          pointer: { tool: 'pointer', x: 100, y: 200 },
          pointerButton: 'down',
          selectedElementIds: { shapeA: true },
          user: {
            color: '#123456',
            colorLight: '#12345633',
            name: 'Remote User',
            peerId: 'peer-remote',
          },
          viewport: { scrollX: 40, scrollY: 90, zoom: 1.4 },
        }],
      ]);
    },
  };

  const collaborators = buildCollaboratorsMap(awareness);
  const collaborator = collaborators.get('3');

  assert.deepEqual(collaborator.viewport, { scrollX: 40, scrollY: 90, zoom: 1.4 });
  assert.equal(findCollaboratorByPeerId(collaborators, 'peer-remote'), collaborator);
  assert.equal(findCollaboratorByPeerId(collaborators, 'missing-peer'), null);
});

test('buildRenderableCollaboratorsMap excludes the current user from Excalidraw scene updates', () => {
  const awareness = {
    clientID: 9,
    getStates() {
      return new Map([
        [3, {
          pointer: { tool: 'pointer', x: 100, y: 200 },
          pointerButton: 'down',
          user: {
            color: '#123456',
            colorLight: '#12345633',
            name: 'Remote User',
            peerId: 'peer-remote',
          },
        }],
        [9, {
          pointer: { tool: 'pointer', x: 10, y: 20 },
          pointerButton: 'up',
          selectedElementIds: { localShape: true },
          user: {
            color: '#654321',
            colorLight: '#65432133',
            name: 'Local User',
            peerId: 'peer-local',
          },
          viewport: { scrollX: 1, scrollY: 2, zoom: 1 },
        }],
      ]);
    },
  };

  const collaborators = buildCollaboratorsMap(awareness);
  const renderable = buildRenderableCollaboratorsMap(collaborators);

  assert.equal(collaborators.get('9').isCurrentUser, true);
  assert.deepEqual([...renderable.keys()], ['3']);

  const before = getCollaboratorsRenderSignature(renderable);
  collaborators.set('9', {
    ...collaborators.get('9'),
    selectedElementIds: { localShape: true, textElement: true },
    viewport: { scrollX: 10, scrollY: 20, zoom: 1.2 },
  });
  const afterLocalOnlyChange = getCollaboratorsRenderSignature(buildRenderableCollaboratorsMap(collaborators));
  assert.equal(afterLocalOnlyChange, before);
});

test('getCollaboratorsRenderSignature is stable for selected element key order', () => {
  const collaborator = {
    button: 'up',
    color: { background: '#12345633', stroke: '#123456' },
    id: 'peer-remote',
    selectedElementIds: { shapeB: true, shapeA: true },
    socketId: '3',
    username: 'Remote User',
  };
  const reorderedCollaborator = {
    ...collaborator,
    selectedElementIds: { shapeA: true, shapeB: true },
  };

  assert.equal(
    getCollaboratorsRenderSignature(new Map([['3', collaborator]])),
    getCollaboratorsRenderSignature(new Map([['3', reorderedCollaborator]])),
  );
});
