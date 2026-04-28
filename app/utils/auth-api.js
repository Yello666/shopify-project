export const TOKEN_KEY = "ai_decision_access_token";
export const REFRESH_TOKEN_KEY = "ai_decision_refresh_token";
const TOKEN_KEY_STORAGE = "ai_decision_access_token_storage";
const REFRESH_TOKEN_KEY_STORAGE = "ai_decision_refresh_token_storage";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 2;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const FETCH_CREDENTIALS_MODE = "include";

const REFRESH_ENDPOINT = "/api/auth/refresh";
let ongoingRefreshPromise = null;

function canUseDocument() {
  return typeof document !== "undefined";
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isSecureContext() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function readCookie(name) {
  if (!canUseDocument()) {
    return "";
  }
  const encodedName = encodeURIComponent(name);
  const cookieParts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of cookieParts) {
    const [key, ...valueParts] = part.split("=");
    if (key === encodedName) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return "";
}

function writeCookie(name, value, maxAgeSeconds) {
  if (!canUseDocument()) {
    return;
  }
  const secureAttr = isSecureContext() ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureAttr}`;
}

function removeCookie(name) {
  if (!canUseDocument()) {
    return;
  }
  const secureAttr = isSecureContext() ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(
    name
  )}=; Path=/; Max-Age=0; SameSite=Lax${secureAttr}`;
}

function readStorage(key) {
  if (!canUseLocalStorage()) return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorage(key, value) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode/quota/etc.)
  }
}

function removeStorage(key) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export function getAccessToken() {
  const cookieToken = readCookie(TOKEN_KEY);
  if (cookieToken) return cookieToken;
  return readStorage(TOKEN_KEY_STORAGE);
}

export function getRefreshToken() {
  const cookieToken = readCookie(REFRESH_TOKEN_KEY);
  if (cookieToken) return cookieToken;
  return readStorage(REFRESH_TOKEN_KEY_STORAGE);
}

export function saveAuthTokens({ accessToken, refreshToken }) {
  if (accessToken) {
    writeCookie(TOKEN_KEY, accessToken, ACCESS_TOKEN_MAX_AGE_SECONDS);
    writeStorage(TOKEN_KEY_STORAGE, accessToken);
  }
  if (refreshToken) {
    writeCookie(REFRESH_TOKEN_KEY, refreshToken, REFRESH_TOKEN_MAX_AGE_SECONDS);
    writeStorage(REFRESH_TOKEN_KEY_STORAGE, refreshToken);
  }
}

export function clearAuthTokens() {
  removeCookie(TOKEN_KEY);
  removeCookie(REFRESH_TOKEN_KEY);
  removeStorage(TOKEN_KEY_STORAGE);
  removeStorage(REFRESH_TOKEN_KEY_STORAGE);
}

function parseTokenResponse(json = {}) {
  const accessToken = json?.data?.access_token || json?.access_token || "";
  const refreshToken = json?.data?.refresh_token || json?.refresh_token || "";
  return { accessToken, refreshToken };
}

async function attemptRefreshRequest(refreshToken, contentType) {
  const hasRefreshToken = Boolean(refreshToken);
  const hasBodyMode = Boolean(contentType);
  if (!hasRefreshToken && hasBodyMode) {
    return { refreshed: false, accessToken: "" };
  }

  let body;
  if (hasBodyMode && contentType === "application/json") {
    body = JSON.stringify({ refresh_token: refreshToken });
  } else if (hasBodyMode) {
    const params = new URLSearchParams();
    params.set("refresh_token", refreshToken);
    body = params.toString();
  }

  const response = await fetch(REFRESH_ENDPOINT, {
    method: "POST",
    credentials: FETCH_CREDENTIALS_MODE,
    headers: hasBodyMode ? { "Content-Type": contentType } : undefined,
    body,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { refreshed: false, accessToken: "" };
  }

  const tokens = parseTokenResponse(json);
  if (tokens.accessToken || tokens.refreshToken) {
    saveAuthTokens(tokens);
  }

  return { refreshed: true, accessToken: tokens.accessToken || "" };
}

async function requestAccessTokenRefresh() {
  // Prefer server-managed httpOnly cookie refresh.
  const cookieRefresh = await attemptRefreshRequest("", "");
  if (cookieRefresh.refreshed) {
    return cookieRefresh;
  }

  const refreshToken = getRefreshToken();
  if (refreshToken) {
    const jsonRefresh = await attemptRefreshRequest(refreshToken, "application/json");
    if (jsonRefresh.refreshed) {
      return jsonRefresh;
    }

    const formRefresh = await attemptRefreshRequest(
      refreshToken,
      "application/x-www-form-urlencoded"
    );
    if (formRefresh.refreshed) {
      return formRefresh;
    }
  }

  clearAuthTokens();
  return { refreshed: false, accessToken: "" };
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

function withCredentials(init = {}) {
  return {
    ...init,
    credentials: FETCH_CREDENTIALS_MODE,
  };
}

/**
 * Wrapper for authenticated API calls:
 * - prefers cookie session (httpOnly-compatible)
 * - falls back to Bearer token when required
 * - refreshes once on 401, then retries
 */
export async function authFetch(input, init = {}) {
  const token = getAccessToken();
  const firstResponse = await fetch(input, withCredentials(init));

  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  if (token) {
    const bearerResponse = await fetch(
      input,
      withCredentials({
        ...init,
        headers: withAuthorization(init.headers, token),
      })
    );
    if (bearerResponse.status !== 401) {
      return bearerResponse;
    }
  }

  const refreshResult = await refreshAccessTokenOnce();
  if (!refreshResult.refreshed) {
    throw new Error("AUTH_EXPIRED");
  }

  const cookieRetry = await fetch(input, withCredentials(init));
  if (cookieRetry.status !== 401) {
    return cookieRetry;
  }

  const renewedToken = refreshResult.accessToken || getAccessToken();
  if (renewedToken) {
    const bearerRetry = await fetch(
      input,
      withCredentials({
        ...init,
        headers: withAuthorization(init.headers, renewedToken),
      })
    );
    if (bearerRetry.status !== 401) {
      return bearerRetry;
    }
  }

  throw new Error("AUTH_EXPIRED");
}
