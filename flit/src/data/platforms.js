// SINGLE SOURCE OF TRUTH for all platform-specific values.
// Import this file everywhere. Never hardcode platform IDs, colors, or URLs.

export const PLATFORMS = {
  blinkit: {
    id:          'blinkit',
    name:        'Blinkit',
    color:       '#0C831F',
    bgColor:     '#E8F5E9',
    textColor:   '#FFFFFF',
    logo:        '/logos/blinkit.svg',
    loginUrl:    'https://blinkit.com',
    searchUrl:   'https://blinkit.com/s/?q=',
    tagline:     '10-min delivery',
  },
  zepto: {
    id:          'zepto',
    name:        'Zepto',
    color:       '#8025FB',
    bgColor:     '#F3E8FF',
    textColor:   '#FFFFFF',
    logo:        '/logos/zepto.svg',
    loginUrl:    'https://www.zeptonow.com',
    searchUrl:   'https://www.zeptonow.com/search?q=',
    tagline:     '10-min delivery',
  },
  instamart: {
    id:          'instamart',
    name:        'Instamart',
    color:       '#FC8019',
    bgColor:     '#FFF3E0',
    textColor:   '#FFFFFF',
    logo:        '/logos/instamart.svg',
    loginUrl:    'https://www.swiggy.com',
    searchUrl:   'https://www.swiggy.com/instamart/search?q=',
    tagline:     'by Swiggy',
  },
  bigbasket: {
    id:          'bigbasket',
    name:        'BigBasket',
    color:       '#84C225',
    bgColor:     '#F1F8E9',
    textColor:   '#FFFFFF',
    logo:        '/logos/bigbasket.svg',
    loginUrl:    'https://www.bigbasket.com',
    searchUrl:   'https://www.bigbasket.com/ps/?q=',
    tagline:     'Now & Slotted',
  },
  jiomart: {
    id:          'jiomart',
    name:        'JioMart',
    color:       '#0089CF',
    bgColor:     '#E3F2FD',
    textColor:   '#FFFFFF',
    logo:        '/logos/jiomart.svg',
    loginUrl:    'https://www.jiomart.com',
    searchUrl:   'https://www.jiomart.com/search#q=',
    tagline:     'Express delivery',
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS);

export function getPlatform(id) {
  return PLATFORMS[id] ?? null;
}

export const DEFAULT_ETAS = {
  blinkit:   '10 mins',
  zepto:     '10 mins',
  instamart: '20-30 mins',
  bigbasket: '1-2 hrs',
  jiomart:   '2-4 hrs',
};
