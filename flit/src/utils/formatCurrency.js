export function formatPrice(amount) {
  if (amount === null || amount === undefined) return '—';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function formatDiscount(mrp, price) {
  if (!mrp || mrp <= price) return null;
  const pct = Math.round(((mrp - price) / mrp) * 100);
  return pct > 0 ? `${pct}% off` : null;
}

export function formatDeliveryFee(fee) {
  if (!fee || fee <= 0) return 'Free delivery';
  return `₹${fee} delivery`;
}
