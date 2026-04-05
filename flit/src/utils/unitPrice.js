// Parses quantity strings like "500 ml", "1 kg", "2 x 200 ml" into numeric values.
// Used for unit price calculation (₹/g or ₹/ml).

export function parseQuantity(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.toLowerCase().trim();

  // "2 x 200 ml", "3x100g"
  const multi = s.match(/(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm|litre|liter|ltr|pcs?|piece)/);
  if (multi) {
    const count = parseFloat(multi[1]);
    const val   = parseFloat(multi[2]);
    const unit  = multi[3];
    const norm  = _normaliseUnit(val, unit);
    return { value: count * norm.value, unit: norm.unit };
  }

  // "500 ml", "1 kg", "450g", "6 pcs", "pack of 3"
  const single = s.match(/(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm|litre|liter|ltr|pcs?|piece|pack)/);
  if (single) return _normaliseUnit(parseFloat(single[1]), single[2].trim());

  const packOf = s.match(/pack of (\d+)/);
  if (packOf) return { value: parseInt(packOf[1]), unit: 'piece' };

  return null;
}

function _normaliseUnit(val, unit) {
  if (unit === 'kg')   return { value: val * 1000, unit: 'g' };
  if (unit === 'l' || unit === 'litre' || unit === 'liter' || unit === 'ltr')
                       return { value: val * 1000, unit: 'ml' };
  if (unit === 'gm' || unit === 'g') return { value: val, unit: 'g' };
  if (unit === 'ml')   return { value: val, unit: 'ml' };
  return { value: val, unit: 'piece' };
}

export function unitPrice(price, quantityString) {
  const q = parseQuantity(quantityString);
  if (!q || q.value <= 0) return null;
  return price / q.value;
}

export function formatUnitPrice(price, unit) {
  if (price === null || price === undefined) return null;
  const formatted = price < 1 ? price.toFixed(3) : price.toFixed(2);
  const label     = unit === 'g' ? '/g' : unit === 'ml' ? '/ml' : '/pc';
  return `₹${formatted}${label}`;
}
