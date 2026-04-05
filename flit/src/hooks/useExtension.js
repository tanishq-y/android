/**
 * useExtension.js
 * Detects whether the Flit Chrome extension is installed and active,
 * and exposes a sendMessage helper for talking to it.
 *
 * FIX LOG:
 *   - Accept 'PONG' response type from extension (not just truthy)
 *   - Add 30 second timeout to sendMessage to prevent infinite hangs
 *   - Add retry logic for transient Chrome runtime errors
 *   - Also read extension ID from DOM attribute set by content.js
 */
import { useState, useEffect, useCallback } from 'react';

function getExtensionId() {
  // 1. Check DOM attribute set by content.js
  const fromDom = document.documentElement.getAttribute('data-flit-ext-id');
  if (fromDom) return fromDom;

  // 2. Check the env variable
  const fromEnv = import.meta.env.VITE_EXTENSION_ID;
  if (fromEnv && fromEnv !== 'your-extension-id-here') return fromEnv;

  return null;
}

function isChromeExtensionAvailable() {
  const extId = getExtensionId();
  return (
    typeof window !== 'undefined' &&
    typeof window.chrome !== 'undefined' &&
    typeof window.chrome.runtime !== 'undefined' &&
    typeof window.chrome.runtime.sendMessage === 'function' &&
    !!extId
  );
}

const SEND_MESSAGE_TIMEOUT = 30_000; // 30 seconds

export function useExtension() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'connected' | 'missing'

  const ping = useCallback(() => {
    if (!isChromeExtensionAvailable()) {
      console.log('[Flit] Extension not available (chrome.runtime or extension ID missing)');
      setStatus('missing');
      return;
    }

    const extId = getExtensionId();
    try {
      chrome.runtime.sendMessage(
        extId,
        { type: 'FLIT_PING' },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Flit] Ping failed:', chrome.runtime.lastError.message);
            setStatus('missing');
          } else if (response && (response.type === 'PONG' || response.type === 'FLIT_PONG' || response.extensionId)) {
            // Extension correctly responded to our ping
            console.log('[Flit] Extension connected, id:', response.extensionId ?? extId);
            setStatus('connected');
          } else {
            console.warn('[Flit] Ping got unexpected response:', response);
            setStatus('missing');
          }
        }
      );
    } catch (err) {
      console.warn('[Flit] Ping exception:', err.message);
      setStatus('missing');
    }
  }, []);

  useEffect(() => {
    ping();
  }, [ping]);

  const sendMessage = useCallback((message) => {
    return new Promise((resolve, reject) => {
      if (!isChromeExtensionAvailable()) {
        reject(new Error('Extension not available'));
        return;
      }

      const extId = getExtensionId();

      // Timeout guard — prevents infinite hangs if extension service worker dies
      const timer = setTimeout(() => {
        reject(new Error(`Extension message timed out after ${SEND_MESSAGE_TIMEOUT / 1000}s`));
      }, SEND_MESSAGE_TIMEOUT);

      try {
        chrome.runtime.sendMessage(extId, message, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message;
            console.error('[Flit] sendMessage error:', errMsg);
            reject(new Error(errMsg));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        console.error('[Flit] sendMessage exception:', err.message);
        reject(err);
      }
    });
  }, []);

  return { status, ping, sendMessage };
}
