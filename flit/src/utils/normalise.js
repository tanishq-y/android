// Frontend normalise utilities — sorting, filtering, finding best deal.
// Products arriving from server search are already normalised to the standard schema.

export function sortByUnitPrice(products) {
  return [...products].sort((a, b) => {
    if (a.unitPrice === null && b.unitPrice === null) return 0;
    if (a.unitPrice === null) return 1;
    if (b.unitPrice === null) return -1;
    return a.unitPrice - b.unitPrice;
  });
}

export function sortByPrice(products) {
  return [...products].sort(
    (a, b) => (a.price + a.deliveryFee) - (b.price + b.deliveryFee)
  );
}

export function sortByEta(products) {
  return [...products].sort((a, b) => {
    const aMin = parseInt(a.deliveryEta) || 999;
    const bMin = parseInt(b.deliveryEta) || 999;
    return aMin - bMin;
  });
}

export function filterByPlatform(products, activePlatforms) {
  if (!activePlatforms || activePlatforms.length === 0) return products;
  return products.filter(p => activePlatforms.includes(p.platform));
}

export function filterInStock(products, inStockOnly) {
  if (!inStockOnly) return products;
  return products.filter(p => p.inStock);
}

export function findBestDeal(products) {
  const inStock = products.filter(p => p.inStock);
  if (!inStock.length) return null;
  return inStock.reduce((best, p) => {
    const totalBest = best.price + best.deliveryFee;
    const totalP    = p.price + p.deliveryFee;
    return totalP < totalBest ? p : best;
  });
}
