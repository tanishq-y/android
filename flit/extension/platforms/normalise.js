// ─── SHARED NORMALISER (extension-side) ─────────────────────────────────────
// Converts raw platform API responses into the standard Flit product schema.
//
// STANDARD SCHEMA:
// {
//   id:            string            — `${platform}:${productId}`
//   platform:      string            — 'blinkit' | 'zepto' | 'instamart' | 'bigbasket' | 'jiomart'
//   name:          string
//   brand:         string | null
//   image:         string | null     — absolute URL
//   price:         number            — selling price ₹
//   mrp:           number | null     — max retail price ₹
//   discount:      number | null     — % off
//   quantity:      string            — "500 ml", "1 kg"
//   gramsOrMl:     number | null     — parsed numeric quantity
//   unit:          'g'|'ml'|'piece'|null
//   unitPrice:     number | null     — price / gramsOrMl
//   deliveryFee:   number            — 0 = free
//   deliveryEta:   string
//   inStock:       boolean
//   deepLink:      string            — URL to open product on platform
//   platformColor: string            — hex
//   platformLogo:  string            — logo path
// }

// ─── QUANTITY PARSING ─────────────────────────────────────────────────────────

export function parseQuantityValue(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.toLowerCase().trim();

  // "2 x 200 ml", "3x100g"
  const multi = s.match(/(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm|litre|liter|ltr|pcs?|piece)/);
  if (multi) {
    const count = parseFloat(multi[1]);
    const val   = parseFloat(multi[2]);
    const unit  = multi[3];
    return count * normaliseToBase(val, unit);
  }

  // "500 ml", "1 kg", "450g", "6 pcs"
  const single = s.match(/(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm|litre|liter|ltr|pcs?|piece|pack)/);
  if (single) return normaliseToBase(parseFloat(single[1]), single[2].trim());

  // "pack of 3"
  const packOf = s.match(/pack of (\d+)/);
  if (packOf) return parseInt(packOf[1]);

  return null;
}

export function parseQuantityUnit(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.toLowerCase();
  if (s.includes('ml') || s.match(/\bl\b/) || s.includes('ltr') || s.includes('litre') || s.includes('liter')) return 'ml';
  if (s.includes('kg') || s.match(/\bg\b/) || s.includes('gm')) return 'g';
  if (s.includes('pcs') || s.includes('pc') || s.includes('piece') || s.includes('pack')) return 'piece';
  return null;
}

function normaliseToBase(val, unit) {
  if (unit === 'kg') return val * 1000;
  if (unit === 'l' || unit === 'litre' || unit === 'liter' || unit === 'ltr') return val * 1000;
  return val;
}

function computeUnitPrice(price, quantityStr) {
  const val = parseQuantityValue(quantityStr);
  if (!val || val <= 0) return null;
  return price / val;
}

// ─── PER-PLATFORM NORMALISERS ────────────────────────────────────────────────

export function normaliseBlinkitProduct(raw) {
  const sp    = raw.price?.sp ?? raw.sp ?? 0;
  const mrp   = raw.price?.mrp ?? raw.mrp ?? sp;
  const qty   = raw.unit ?? raw.weight_unit ?? '';
  const pid   = raw.id ?? raw.product_id ?? String(Math.random());
  return {
    id:            `blinkit:${pid}`,
    platform:      'blinkit',
    name:          raw.name ?? '',
    brand:         raw.brand ?? null,
    image:         raw.images?.[0]?.url ?? raw.image_url ?? null,
    price:         sp,
    mrp,
    discount:      mrp > sp ? Math.round(((mrp - sp) / mrp) * 100) : null,
    quantity:      qty,
    gramsOrMl:     parseQuantityValue(qty),
    unit:          parseQuantityUnit(qty),
    unitPrice:     computeUnitPrice(sp, qty),
    deliveryFee:   0,
    deliveryEta:   raw.merchant?.eta_mins ? `${raw.merchant.eta_mins} mins` : '10 mins',
    inStock:       raw.in_stock !== false && raw.is_serviceable !== false,
    deepLink:      `https://blinkit.com/prn/${pid}`,
    platformColor: '#0C831F',
    platformLogo:  '/logos/blinkit.svg',
  };
}

export function normaliseZeptoProduct(raw) {
  const item  = raw.productResponse ?? raw;
  const price = item.discountedSellingPrice ?? item.sellingPrice ?? 0;
  const mrp   = item.mrp ?? item.price ?? price;
  const qty   = item.unitString ?? item.quantity ?? '';
  const pid   = item.id ?? item.productId ?? String(Math.random());
  return {
    id:            `zepto:${pid}`,
    platform:      'zepto',
    name:          item.name ?? '',
    brand:         item.brand?.name ?? null,
    image:         item.images?.[0]?.path ?? item.imagePath ?? null,
    price,
    mrp,
    discount:      mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null,
    quantity:      qty,
    gramsOrMl:     parseQuantityValue(qty),
    unit:          parseQuantityUnit(qty),
    unitPrice:     computeUnitPrice(price, qty),
    deliveryFee:   0,
    deliveryEta:   item.etaInMins ? `${item.etaInMins} mins` : '10 mins',
    inStock:       item.availabilityStatus === 'AVAILABLE',
    deepLink:      `https://www.zeptonow.com/pn/${pid}`,
    platformColor: '#8025FB',
    platformLogo:  '/logos/zepto.svg',
  };
}

export function normaliseInstamartProduct(raw) {
  const price = raw.price?.offer_price ?? raw.offer_price ?? 0;
  const mrp   = raw.price?.total_mrp ?? raw.total_mrp ?? price;
  const qty   = raw.weight ?? raw.pack_desc ?? '';
  const pid   = raw.product_id ?? raw.id ?? String(Math.random());
  return {
    id:            `instamart:${pid}`,
    platform:      'instamart',
    name:          raw.display_name ?? raw.name ?? '',
    brand:         raw.brand_name ?? null,
    image:         raw.images?.[0] ?? raw.img_url ?? null,
    price,
    mrp,
    discount:      mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null,
    quantity:      qty,
    gramsOrMl:     parseQuantityValue(qty),
    unit:          parseQuantityUnit(qty),
    unitPrice:     computeUnitPrice(price, qty),
    deliveryFee:   0,
    deliveryEta:   raw.eta ?? '20-30 mins',
    inStock:       raw.in_stock !== false,
    deepLink:      `https://www.swiggy.com/instamart/item/${pid}`,
    platformColor: '#FC8019',
    platformLogo:  '/logos/instamart.svg',
  };
}

export function normaliseBigBasketProduct(raw) {
  const price = raw.sp ?? raw.selling_price ?? 0;
  const mrp   = raw.mrp ?? price;
  const qty   = raw.w ?? raw.pack_desc ?? '';
  const pid   = raw.id ?? raw.product_id ?? String(Math.random());
  return {
    id:            `bigbasket:${pid}`,
    platform:      'bigbasket',
    name:          raw.desc ?? raw.name ?? '',
    brand:         raw.brand?.name ?? null,
    image:         raw.img_url ?? null,
    price,
    mrp,
    discount:      mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null,
    quantity:      qty,
    gramsOrMl:     parseQuantityValue(qty),
    unit:          parseQuantityUnit(qty),
    unitPrice:     computeUnitPrice(price, qty),
    deliveryFee:   0,
    deliveryEta:   raw.eta_text ?? '1-2 hrs',
    inStock:       raw.in_stock !== false,
    deepLink:      `https://www.bigbasket.com/pd/${pid}/`,
    platformColor: '#84C225',
    platformLogo:  '/logos/bigbasket.svg',
  };
}

export function normaliseJioMartProduct(raw) {
  const price = raw.our_price ?? raw.special_price ?? 0;
  const mrp   = raw.price ?? price;
  const qty   = raw.weight_net_quantity ?? raw.pack_info ?? '';
  const pid   = raw.id ?? raw.entity_id ?? String(Math.random());
  return {
    id:            `jiomart:${pid}`,
    platform:      'jiomart',
    name:          raw.name ?? raw.product_name ?? '',
    brand:         raw.brand ?? null,
    image:         raw.image ?? raw.media_gallery_entries?.[0]?.file ?? null,
    price,
    mrp,
    discount:      mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null,
    quantity:      qty,
    gramsOrMl:     parseQuantityValue(qty),
    unit:          parseQuantityUnit(qty),
    unitPrice:     computeUnitPrice(price, qty),
    deliveryFee:   0,
    deliveryEta:   '2-4 hrs',
    inStock:       raw.is_in_stock !== false && raw.stock_status !== 'OUT_OF_STOCK',
    deepLink:      `https://www.jiomart.com/p/groceries/${pid}`,
    platformColor: '#0089CF',
    platformLogo:  '/logos/jiomart.svg',
  };
}

// ─── BATCH NORMALISER ─────────────────────────────────────────────────────────

const NORMALISERS = {
  blinkit:   normaliseBlinkitProduct,
  zepto:     normaliseZeptoProduct,
  instamart: normaliseInstamartProduct,
  bigbasket: normaliseBigBasketProduct,
  jiomart:   normaliseJioMartProduct,
};

export function normaliseAll(platform, rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const fn = NORMALISERS[platform];
  if (!fn) return [];

  return rawArray
    .map(raw => {
      try {
        const product = fn(raw);
        return product.price > 0 && product.name ? product : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
