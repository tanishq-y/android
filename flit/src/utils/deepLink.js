import { PLATFORMS } from '../data/platforms.js';

export function generateDeepLink(platform, productId, productName) {
  if (productId) {
    switch (platform) {
      case 'blinkit':   return `https://blinkit.com/prn/${productId}`;
      case 'zepto':     return `https://www.zeptonow.com/pn/${productId}`;
      case 'instamart': return `https://www.swiggy.com/instamart/item/${productId}`;
      case 'bigbasket': return `https://www.bigbasket.com/pd/${productId}/`;
      case 'jiomart':   return `https://www.jiomart.com/p/groceries/${productId}`;
    }
  }
  const p = PLATFORMS[platform];
  if (!p) return '#';
  return `${p.searchUrl}${encodeURIComponent(productName ?? '')}`;
}
