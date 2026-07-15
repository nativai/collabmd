import { normalizeEmailAddress } from '../auth/auth-common.js';

export const HOSTED_ROLE_ADMIN = 'admin';
export const HOSTED_ROLE_COLLABORATOR = 'collaborator';

const SUPPORTED_ROLES = new Set([HOSTED_ROLE_ADMIN, HOSTED_ROLE_COLLABORATOR]);

export function normalizeHostedEmail(value) {
  return normalizeEmailAddress(value);
}

export function normalizeHostedRole(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SUPPORTED_ROLES.has(normalized)) {
    return '';
  }
  return normalized;
}
