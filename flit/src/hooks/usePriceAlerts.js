import { useUser } from './useUser.js';
import { apiUrl } from '../utils/apiUrl';

export function usePriceAlerts() {
  const { state, dispatch } = useUser();

  function addAlert(product) {
    dispatch({
      type: 'ADD_ALERT',
      payload: {
        productId:    product.id,
        productName:  product.name,
        platform:     product.platform,
        currentPrice: product.price,
        alertBelow:   Math.floor(product.price * 0.9),  // default: 10% drop
        createdAt:    Date.now(),
      },
    });
  }

  function removeAlert(productId) {
    dispatch({ type: 'REMOVE_ALERT', payload: productId });
  }

  function isAlertSet(productId) {
    return state.priceAlerts.some(a => a.productId === productId);
  }

  // Fire and forget — sends current prices to the server and returns triggered alerts
  async function checkAlerts(currentPrices) {
    if (!state.priceAlerts.length) return [];
    try {
      const res  = await fetch(apiUrl('/api/alerts/check'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prices: currentPrices }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.triggered ?? [];
    } catch {
      return [];
    }
  }

  return {
    alerts: state.priceAlerts,
    addAlert,
    removeAlert,
    isAlertSet,
    checkAlerts,
  };
}
