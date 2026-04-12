import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOrCreateDeviceUserId } from '../utils/deviceUserId';
import { apiUrl } from '../utils/apiUrl';

function toNetworkError(error) {
  if (error instanceof TypeError) {
    return new Error('Failed to reach Flit backend. Set backend URL to your laptop LAN IP (http://<your-ip>:3001) and keep server running.');
  }
  return error;
}

export function useZeptoConnection() {
  const userId = useMemo(() => getOrCreateDeviceUserId(), []);

  const [connection, setConnection] = useState({
    platform: 'zepto',
    status: 'unknown',
    status_reason: null,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'x-flit-user-id': userId,
  }), [userId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let response;
      try {
        response = await fetch(apiUrl('/api/v2/connections/zepto'), {
          method: 'GET',
          headers: { 'x-flit-user-id': userId },
        });
      } catch (error) {
        throw toNetworkError(error);
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }

      setConnection({
        platform: 'zepto',
        status: data.status ?? 'unknown',
        status_reason: data.status_reason ?? null,
        connected_at: data.connected_at ?? null,
        updated_at: data.updated_at ?? null,
      });
    } catch (err) {
      setConnection({
        platform: 'zepto',
        status: 'unknown',
        status_reason: err.message,
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const saveSession = useCallback(async ({ cookieHeader, expiresAt = null }) => {
    if (!cookieHeader || typeof cookieHeader !== 'string' || !cookieHeader.includes('=')) {
      throw new Error('A valid cookie header is required.');
    }

    setSyncing(true);
    try {
      let saveResponse;
      try {
        saveResponse = await fetch(apiUrl('/api/v2/connections/zepto/session'), {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            cookieHeader: cookieHeader.trim(),
            expiresAt,
          }),
        });
      } catch (error) {
        throw toNetworkError(error);
      }

      const payload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) {
        throw new Error(payload?.error ?? `HTTP ${saveResponse.status}`);
      }

      await refresh();
      return payload;
    } finally {
      setSyncing(false);
    }
  }, [authHeaders, refresh]);

  const disconnect = useCallback(async () => {
    let response;
    try {
      response = await fetch(apiUrl('/api/v2/connections/zepto'), {
        method: 'DELETE',
        headers: { 'x-flit-user-id': userId },
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
  }, [refresh, userId]);

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
  };
}
