import { chatFeature } from '../application/app-shell/chat-feature.js';
import { commentsFeature } from '../application/app-shell/comments-feature.js';
import { exportFeature } from '../application/app-shell/export-feature.js';
import { gitFeature } from '../application/app-shell/git-feature.js';
import { lazyControllerFeature } from './lazy-controller-feature.js';
import { presenceFeature } from '../application/app-shell/presence-feature.js';
import { uiFeature } from '../application/app-shell/ui-feature.js';
import { workspaceFeature } from '../application/app-shell/workspace-feature.js';

export const appShellFeatures = Object.freeze({
  chat: chatFeature,
  comments: commentsFeature,
  export: exportFeature,
  git: gitFeature,
  lazyControllers: lazyControllerFeature,
  presence: presenceFeature,
  ui: uiFeature,
  workspace: workspaceFeature,
});

export function createAppShellFeatureSurface(appShell, features = appShellFeatures) {
  const methodEntries = [];
  const methodOwners = new Map();

  for (const [featureName, feature] of Object.entries(features)) {
    for (const [methodName, method] of Object.entries(feature)) {
      if (typeof method !== 'function') {
        continue;
      }
      if (methodOwners.has(methodName)) {
        throw new Error(`Duplicate App Shell feature method "${methodName}" from ${methodOwners.get(methodName)} and ${featureName}`);
      }
      methodOwners.set(methodName, featureName);
      methodEntries.push([methodName, method]);
    }
  }

  const target = {};
  const surface = new Proxy(target, {
    get(surfaceTarget, property, receiver) {
      if (Reflect.has(surfaceTarget, property)) {
        return Reflect.get(surfaceTarget, property, receiver);
      }
      return appShell[property];
    },
    has(surfaceTarget, property) {
      return Reflect.has(surfaceTarget, property) || property in appShell;
    },
    set(surfaceTarget, property, value) {
      if (Reflect.has(surfaceTarget, property)) {
        return Reflect.set(surfaceTarget, property, value);
      }
      appShell[property] = value;
      return true;
    },
  });

  for (const [methodName, method] of methodEntries) {
    Object.defineProperty(target, methodName, {
      configurable: false,
      enumerable: true,
      value: (...args) => method.apply(surface, args),
    });
  }

  return surface;
}
