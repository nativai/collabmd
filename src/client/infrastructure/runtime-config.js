function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getRuntimeConfig() {
  return {
    environment: 'development',
    publicWsBaseUrl: '',
    wsBasePath: '/ws',
    ...(window.__COLLABMD_CONFIG__ ?? {}),
  };
}

export function getRoomFromHash() {
  const match = window.location.hash.match(/room=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function navigateToRoom(roomId) {
  window.location.hash = `room=${encodeURIComponent(roomId)}`;
}

export function resolveWsBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const customServerUrl = params.get('server');

  if (customServerUrl) {
    return trimTrailingSlash(customServerUrl);
  }

  const config = getRuntimeConfig();
  if (config.publicWsBaseUrl) {
    return trimTrailingSlash(config.publicWsBaseUrl);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${config.wsBasePath}`;
}
