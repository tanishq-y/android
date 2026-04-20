import { useCallback, useEffect, useMemo, useState } from 'react';

import { getOrCreateDeviceUserId } from '../utils/deviceUserId';
import { apiUrl } from '../utils/apiUrl';
import { ensureDeviceAuthToken } from '../utils/deviceAuth';
import { buildPlatformSessionFromCookieHeader } from '../utils/platformSession';

function toNetworkError(error) {
  if (error instanceof TypeError) {
    return new Error('Failed to reach Flit backend. Set backend URL to your laptop LAN IP (http://<your-ip>:3001) and keep server running.');
  }

  return error;
}

function mapStatus(status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized === 'connected') return 'connected';
  if (normalized === 'expired') return 'expired';
  return 'disconnected';
}

export function useSpecPlatformConnection(platformId) {
  const platform = String(platformId ?? '').trim().toLowerCase();
  const userId = useMemo(() => getOrCreateDeviceUserId(), []);

  const [connection, setConnection] = useState({
    platform,
    status: 'unknown',
    status_reason: null,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const getAuthToken = useCallback(async () => {
    try {
      return await ensureDeviceAuthToken(userId);
    } catch (error) {
      throw toNetworkError(error);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const token = await getAuthToken();

      let response;
      try {
        response = await fetch(apiUrl('/api/platforms/status'), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        throw toNetworkError(error);
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      const platformStatus = mapStatus(payload?.platforms?.[platform]);
      setConnection({
        platform,
        status: platformStatus,
        status_reason: null,
      });
    } catch (error) {
      setConnection({
        platform,
        status: 'unknown',
        status_reason: error?.message ?? 'status_failed',
      });
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, platform]);

  const saveSession = useCallback(async ({ cookieHeader, expiresAt = null, session = null }) => {
    const header = String(cookieHeader ?? '').trim();

    const sessionPayload = session && typeof session === 'object'
      ? session
      : buildPlatformSessionFromCookieHeader(platform, header);

    const hasCookies = sessionPayload?.cookies && Object.keys(sessionPayload.cookies).length > 0;
    if (!hasCookies) {
      throw new Error('A valid cookie header is required.');
    }

    setSyncing(true);

    try {
      const token = await getAuthToken();

      let response;
      try {
        response = await fetch(apiUrl('/api/platforms/connect'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            platform,
            session: sessionPayload,
            expiresAt,
          }),
        });
      } catch (error) {
        throw toNetworkError(error);
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      await refresh();
      return payload;
    } finally {
      setSyncing(false);
    }
  }, [getAuthToken, platform, refresh]);

  const disconnect = useCallback(async () => {
    const token = await getAuthToken();

    let response;
    try {
      response = await fetch(apiUrl(`/api/platforms/${platform}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      throw toNetworkError(error);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }

    await refresh();
    return payload;
  }, [getAuthToken, platform, refresh]);

  const verify = useCallback(async () => {
    const token = await getAuthToken();

    let response;
    try {
      response = await fetch(apiUrl(`/api/platforms/${platform}/verify`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      throw toNetworkError(error);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }

    await refresh();
    return payload;
  }, [getAuthToken, platform, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    userId,
    connection,
    loading,
    syncing,
    refresh,
    saveSession,
    disconnect,
    verify,
  };
}