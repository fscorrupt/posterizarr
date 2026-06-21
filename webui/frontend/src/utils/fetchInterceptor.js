/**
 * Setup global fetch interceptor to automatically add Basic Auth credentials
 * This patches the native fetch function to include Authorization header
 * when credentials are stored in sessionStorage
 */

export function setupFetchInterceptor() {
  const originalFetch = window.fetch;
  window.originalFetch = originalFetch;

  window.fetch = function (url, options = {}) {
    const credentials = sessionStorage.getItem("auth_credentials");

    // If credentials exist, add Authorization header
    if (credentials) {
      const headers = new Headers(options.headers || {});

      // Only add if not already present
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Basic ${credentials}`);
      }

      options.headers = headers;
    }

    // Call original fetch with modified options
    return originalFetch(url, options);
  };
}

export function removeFetchInterceptor() {
  // Restore original fetch if needed
  if (window.originalFetch) {
    window.fetch = window.originalFetch;
    delete window.originalFetch;
  }
}
