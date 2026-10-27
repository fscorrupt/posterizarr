/**
 * Setup global fetch interceptor to automatically add Basic Auth credentials
 * This patches the native fetch function to include Authorization header
 * when credentials are stored in sessionStorage
 */

export function setupFetchInterceptor() {
  if (window.__fetchInterceptorInstalled) return;

  const originalFetch = window.fetch;
  window.originalFetch = originalFetch;
  window.__fetchInterceptorInstalled = true;

  window.fetch = function (input, init = {}) {
    const credentials = sessionStorage.getItem("auth_credentials") || localStorage.getItem("auth_credentials");

    // If credentials exist, add Authorization header
    if (credentials) {
      if (input instanceof Request) {
        if (!input.headers.has("Authorization")) {
          input.headers.set("Authorization", `Basic ${credentials}`);
        }
      } else {
        const headers = new Headers(init?.headers || {});
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Basic ${credentials}`);
        }
        init = { ...init, headers };
      }
    }

    // Call original fetch with modified options
    return originalFetch(input, init);
  };

  console.log(
    "Fetch interceptor installed - Auth headers will be added automatically"
  );
}

export function removeFetchInterceptor() {
  // Restore original fetch if needed
  if (window.originalFetch) {
    window.fetch = window.originalFetch;
    delete window.__fetchInterceptorInstalled;
    delete window.originalFetch;
    console.log("Fetch interceptor removed");
  }
}
