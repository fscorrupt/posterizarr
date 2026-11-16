/**
 * Enhanced fetch wrapper that automatically includes Basic Auth credentials
 * if they are stored in sessionStorage or localStorage for same-origin requests.
 *
 * Usage:
 *   import { authFetch } from './utils/authFetch';
 *   const response = await authFetch('/api/status');
 */

function isSameOrigin(input) {
  try {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof Request
        ? input.url
        : input instanceof URL
        ? input.href
        : String(input);
    const targetUrl = new URL(urlStr, window.location.href);
    return targetUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function authFetch(url, options = {}) {
  const credentials = sessionStorage.getItem("auth_credentials") || localStorage.getItem("auth_credentials");

  const headers = {
    ...options.headers,
  };

  // Add Basic Auth header if credentials are available and target is same-origin
  if (credentials && isSameOrigin(url)) {
    headers["Authorization"] = `Basic ${credentials}`;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

export default authFetch;
