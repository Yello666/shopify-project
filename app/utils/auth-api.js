export const TOKEN_KEY = "ai_decision_access_token";
export const REFRESH_TOKEN_KEY = "ai_decision_refresh_token";
/** 网关/WebSocket 等仅解析 `Cookie: access_token=…` 时使用的 Cookie 名（与 TOKEN_KEY 同值并存）。 */
export const ACCESS_TOKEN_COOKIE_NAME = "access_token";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 2;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const FETCH_CREDENTIALS_MODE = "include";

const REFRESH_ENDPOINT = "/api/v1/auth/refresh";
let ongoingRefreshPromise = null;

function canUseDocument() {
  return typeof document !== "undefined";
}

function isSecureContext() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function readLocalStorage(name) {
  if (!canUseDocument()) {
    return "";
  }
  try {
    return localStorage.getItem(name) || "";
  } catch {
    return "";
  }
}

function writeLocalStorage(name, value) {
  if (!canUseDocument()) {
    return;
  }
  try {
    if (value) {
      localStorage.setItem(name, value);
    } else {
      localStorage.removeItem(name);
    }
  } catch {
    // Quota / private mode — cookie path may still work
  }
}

function readStored(name) {
  return readCookie(name) || readLocalStorage(name);
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

/** Persist token in cookie (preferred for same-origin requests) and localStorage (fallback / large JWT). */
function writeStoredToken(name, value, maxAgeSeconds) {
  if (!value) {
    return;
  }
  writeCookie(name, value, maxAgeSeconds);
  writeLocalStorage(name, value);
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

export function getAccessToken() {
  const fromPrimary = readStored(TOKEN_KEY);
  const fromAlias = readCookie(ACCESS_TOKEN_COOKIE_NAME);
  if (fromPrimary && !fromAlias) {
    writeCookie(
      ACCESS_TOKEN_COOKIE_NAME,
      fromPrimary,
      ACCESS_TOKEN_MAX_AGE_SECONDS,
    );
  }
  return fromPrimary || fromAlias;
}

export function getRefreshToken() {
  return readStored(REFRESH_TOKEN_KEY);
}

export function saveAuthTokens({ accessToken, refreshToken }) {
  if (accessToken) {
    writeStoredToken(TOKEN_KEY, accessToken, ACCESS_TOKEN_MAX_AGE_SECONDS);
    writeCookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, ACCESS_TOKEN_MAX_AGE_SECONDS);
  }
  if (refreshToken) {
    writeStoredToken(
      REFRESH_TOKEN_KEY,
      refreshToken,
      REFRESH_TOKEN_MAX_AGE_SECONDS
    );
  }
}

export function clearAuthTokens() {
  removeCookie(TOKEN_KEY);
  removeCookie(ACCESS_TOKEN_COOKIE_NAME);
  removeCookie(REFRESH_TOKEN_KEY);
  writeLocalStorage(TOKEN_KEY, "");
  writeLocalStorage(REFRESH_TOKEN_KEY, "");
}

export function parseTokenResponse(json = {}) {
  const data = json?.data || {};
  const tokenContainer = data?.token || data?.tokens || json?.token || json?.tokens || {};
  const accessToken =
    data?.access_token ||
    data?.accessToken ||
    tokenContainer?.access_token ||
    tokenContainer?.accessToken ||
    json?.access_token ||
    json?.accessToken ||
    "";
  const refreshToken =
    data?.refresh_token ||
    data?.refreshToken ||
    tokenContainer?.refresh_token ||
    tokenContainer?.refreshToken ||
    json?.refresh_token ||
    json?.refreshToken ||
    "";
  return { accessToken, refreshToken };
}

async function attemptRefreshRequest(refreshToken, contentType) {
  const hasRefreshToken = Boolean(refreshToken);
  const hasBodyMode = Boolean(contentType);
  if (!hasRefreshToken && hasBodyMode) {
    return { refreshed: false, accessToken: "", authRejected: false };
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
    const authRejected = response.status === 401 || response.status === 403;
    return { refreshed: false, accessToken: "", authRejected };
  }

  const tokens = parseTokenResponse(json);
  if (tokens.accessToken || tokens.refreshToken) {
    saveAuthTokens(tokens);
  }

  return { refreshed: true, accessToken: tokens.accessToken || "", authRejected: false };
}

async function requestAccessTokenRefresh() {
  try {
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

      if (jsonRefresh.authRejected || formRefresh.authRejected || cookieRefresh.authRejected) {
        clearAuthTokens();
      }
      return { refreshed: false, accessToken: "" };
    }

    if (cookieRefresh.authRejected) {
      clearAuthTokens();
    }
    return { refreshed: false, accessToken: "" };
  } catch {
    // 网络异常等：不清本地凭据，避免刷新误杀仍有效的会话
    return { refreshed: false, accessToken: "" };
  }
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
