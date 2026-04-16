export const TOKEN_KEY = "ai_decision_access_token";
export const REFRESH_TOKEN_KEY = "ai_decision_refresh_token";
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 2;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const REFRESH_ENDPOINT = "/api/auth/refresh";
let ongoingRefreshPromise = null;

function canUseDocument() {
  return typeof document !== "undefined";
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

export function getAccessToken() {
  return readCookie(TOKEN_KEY);
}

export function getRefreshToken() {
  return readCookie(REFRESH_TOKEN_KEY);
}

export function saveAuthTokens({ accessToken, refreshToken }) {
  if (accessToken) {
    writeCookie(TOKEN_KEY, accessToken, ACCESS_TOKEN_MAX_AGE_SECONDS);
  }
  if (refreshToken) {
    writeCookie(REFRESH_TOKEN_KEY, refreshToken, REFRESH_TOKEN_MAX_AGE_SECONDS);
  }
}

export function clearAuthTokens() {
  removeCookie(TOKEN_KEY);
  removeCookie(REFRESH_TOKEN_KEY);
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
