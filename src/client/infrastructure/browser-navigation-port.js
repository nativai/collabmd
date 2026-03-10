import {
  getHashRoute,
  navigateToFile,
  navigateToGitDiff,
} from './runtime-config.js';

export class BrowserNavigationPort {
  getHashRoute() {
    return getHashRoute();
  }

  navigateToFile(filePath) {
    navigateToFile(filePath);
  }

  navigateToGitDiff(payload) {
    navigateToGitDiff(payload);
  }
}
