export const TOKEN_KEY = "ai_decision_access_token";
export const REFRESH_TOKEN_KEY = "ai_decision_refresh_token";

const REFRESH_ENDPOINT = "/api/auth/refresh";
let ongoingRefreshPromise = null;

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function getAccessToken() {
  const storage = getStorage();
  return storage ? storage.getItem(TOKEN_KEY) : "";
}

export function getRefreshToken() {
  const storage = getStorage();
  return storage ? storage.getItem(REFRESH_TOKEN_KEY) : "";
}

export function saveAuthTokens({ accessToken, refreshToken }) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  if (accessToken) {
    storage.setItem(TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearAuthTokens() {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
}

function parseTokenResponse(json = {}) {
  const accessToken = json?.data?.access_token || json?.access_token || "";
  const refreshToken = json?.data?.refresh_token || json?.refresh_token || "";
  return { accessToken, refreshToken };
}

async function attemptRefreshRequest(refreshToken, contentType) {
  if (!refreshToken) {
    return null;
  }

  let body;
  if (contentType === "application/json") {
    body = JSON.stringify({ refresh_token: refreshToken });
  } else {
    const params = new URLSearchParams();
    params.set("refresh_token", refreshToken);
    body = params.toString();
  }

  const response = await fetch(REFRESH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return null;
  }

  const tokens = parseTokenResponse(json);
  if (!tokens.accessToken) {
    return null;
  }
  saveAuthTokens(tokens);
  return tokens.accessToken;
}

async function requestAccessTokenRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return "";
  }

  const jsonToken = await attemptRefreshRequest(refreshToken, "application/json");
  if (jsonToken) {
    return jsonToken;
  }

  const formToken = await attemptRefreshRequest(
    refreshToken,
    "application/x-www-form-urlencoded"
  );
  if (formToken) {
    return formToken;
  }

  clearAuthTokens();
  return "";
}

async function refreshAccessTokenOnce() {
  if (!ongoingRefreshPromise) {
    ongoingRefreshPromise = requestAccessTokenRefresh().finally(() => {
      ongoingRefreshPromise = null;
    });
  }
  return ongoingRefreshPromise;
}

function withAuthorization(headersInit, token) {
  const headers = new Headers(headersInit || {});
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * Wrapper for authenticated API calls:
 * - attaches Bearer token
 * - refreshes token once on 401
 * - retries request after successful refresh
 */
export async function authFetch(input, init = {}) {
  const token = getAccessToken();
  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }

  const firstResponse = await fetch(input, {
    ...init,
    headers: withAuthorization(init.headers, token),
  });

  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  const renewedToken = await refreshAccessTokenOnce();
  if (!renewedToken) {
    throw new Error("AUTH_EXPIRED");
  }

  return fetch(input, {
    ...init,
    headers: withAuthorization(init.headers, renewedToken),
  });
}
