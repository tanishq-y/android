// In-memory price alert store.
// Alerts reset on server restart — acceptable for v1.
// Each alert: { id, productId, productName, platform, currentPrice, alertBelow, createdAt }

import { randomUUID } from 'crypto';

export class AlertManager {
  constructor() {
    this._store = new Map(); // id → alert
  }

  save({ productId, productName, platform, currentPrice, alertBelow }) {
    // Deduplicate by productId — one alert per product
    for (const [id, alert] of this._store) {
      if (alert.productId === productId) {
        const updated = { ...alert, currentPrice, alertBelow };
        this._store.set(id, updated);
        return updated;
      }
    }

    const alert = {
      id:           randomUUID(),
      productId,
      productName,
      platform,
      currentPrice,
      alertBelow,
      createdAt:    Date.now(),
    };
    this._store.set(alert.id, alert);
    return alert;
  }

  remove(productId) {
    for (const [id, alert] of this._store) {
      if (alert.productId === productId) {
        this._store.delete(id);
        return true;
      }
    }
    return false;
  }

  // prices: [{ productId, currentPrice }]
  // Returns alerts whose threshold has been crossed
  check(prices) {
    const priceMap = {};
    for (const { productId, currentPrice } of prices) {
      priceMap[productId] = currentPrice;
    }

    const triggered = [];
    for (const alert of this._store.values()) {
      const current = priceMap[alert.productId];
      if (current !== undefined && current <= alert.alertBelow) {
        triggered.push({ ...alert, currentPrice: current });
      }
    }
    return triggered;
  }

  getAll() {
    return Array.from(this._store.values());
  }
}
