import {
  getHashRoute,
  navigateToGitCommit,
  navigateToFile,
  navigateToGitDiff,
  navigateToGitHistory,
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

  navigateToGitCommit(payload) {
    navigateToGitCommit(payload);
  }

  navigateToGitHistory() {
    navigateToGitHistory();
  }
}
