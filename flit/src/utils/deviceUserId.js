const STORAGE_KEY = 'flit_user_id';

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `flit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateDeviceUserId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const created = generateId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return 'flit_fallback_user';
  }
}