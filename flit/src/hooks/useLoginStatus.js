/**
 * useLoginStatus.js
 * Asks the extension which platforms the user is currently logged into.
 *
 * FIX LOG:
 *   - Accept both 'FLIT_LOGIN_STATUS' and 'STATUS' response types
 *   - Read status from both response.status and response.platforms
 */
import { useState, useCallback } from 'react';
import { useExtension } from './useExtension';

const PLATFORMS = [
  { key: 'blinkit',   label: 'Blinkit',   url: 'https://blinkit.com',           color: '#0C831F' },
  { key: 'zepto',     label: 'Zepto',     url: 'https://www.zeptonow.com',       color: '#8025FB' },
  { key: 'instamart', label: 'Instamart', url: 'https://www.swiggy.com',         color: '#FC8019' },
  { key: 'bigbasket', label: 'BigBasket', url: 'https://www.bigbasket.com',      color: '#84C225' },
  { key: 'jiomart',   label: 'JioMart',   url: 'https://www.jiomart.com',        color: '#0089CF' },
];

export function useLoginStatus() {
  const { sendMessage, status: extStatus } = useExtension();
  const [loginStatus, setLoginStatus] = useState(
    Object.fromEntries(PLATFORMS.map((p) => [p.key, 'unknown']))
  );
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (extStatus !== 'connected') return;
    setChecking(true);

    try {
      const res = await sendMessage({ type: 'FLIT_CHECK_LOGIN' });
      // Accept both response shapes
      if (res?.type === 'FLIT_LOGIN_STATUS' && res.status) {
        setLoginStatus(res.status);
      } else if (res?.type === 'STATUS' && res.platforms) {
        setLoginStatus(res.platforms);
      } else if (res?.status) {
        setLoginStatus(res.status);
      } else if (res?.platforms) {
        setLoginStatus(res.platforms);
      }
    } catch (err) {
      console.warn('[Flit] Login status check failed:', err.message);
    } finally {
      setChecking(false);
    }
  }, [sendMessage, extStatus]);

  return { loginStatus, platforms: PLATFORMS, refresh, checking, extStatus };
}
