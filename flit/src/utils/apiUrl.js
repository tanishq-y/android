function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

const API_BASE_STORAGE_KEY = 'flit_api_base_url';

function readStoredApiBaseUrl() {
  if (typeof window === 'undefined') return '';

  try {
    return String(localStorage.getItem(API_BASE_STORAGE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function getStoredApiBaseUrl() {
  return readStoredApiBaseUrl();
}

export function setStoredApiBaseUrl(value) {
  if (typeof window === 'undefined') return;

  const normalised = String(value ?? '').trim();
  try {
    if (!normalised) {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
      return;
    }

    localStorage.setItem(API_BASE_STORAGE_KEY, stripTrailingSlash(normalised));
  } catch {
    // Ignore localStorage failures in restricted runtimes.
  }
}

export function getApiBaseUrl() {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  const fromStorage = readStoredApiBaseUrl();

  if (typeof window !== 'undefined' && window.location?.protocol === 'capacitor:') {
    if (fromStorage) {
      return stripTrailingSlash(fromStorage);
    }

    if (fromEnv) {
      return stripTrailingSlash(fromEnv);
    }

    // Emulator fallback. For physical devices set VITE_API_BASE_URL or localStorage flit_api_base_url.
    return 'http://10.0.2.2:3001';
  }

  if (fromEnv) {
    return stripTrailingSlash(fromEnv);
  }

  if (fromStorage) {
    return stripTrailingSlash(fromStorage);
  }

  return '';
}

export function apiUrl(path) {
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalisedPath}` : normalisedPath;
}
