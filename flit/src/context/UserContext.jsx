import { createContext, useReducer, useEffect } from 'react';

export const UserContext = createContext(null);

const INITIAL_STATE = {
  connectedPlatforms:  [],      // platforms where user is logged in (from GET_STATUS)
  priceAlerts:         [],      // [{ productId, productName, platform, currentPrice, alertBelow, createdAt }]
  recentSearches:      [],      // string[] max 10
};

function userReducer(state, action) {
  switch (action.type) {
    case 'SET_PLATFORM_STATUS':
      // payload: { blinkit: 'logged_in'|'logged_out'|'unknown'|true|false, ... }
      return {
        ...state,
        connectedPlatforms: Object.entries(action.payload)
          .filter(([, s]) => s === 'logged_in' || s === true)
          .map(([p]) => p),
      };

    case 'ADD_ALERT': {
      const deduped = state.priceAlerts.filter(a => a.productId !== action.payload.productId);
      return { ...state, priceAlerts: [...deduped, action.payload] };
    }

    case 'REMOVE_ALERT':
      return {
        ...state,
        priceAlerts: state.priceAlerts.filter(a => a.productId !== action.payload),
      };

    case 'ADD_RECENT_SEARCH': {
      const deduped = [action.payload, ...state.recentSearches.filter(s => s !== action.payload)];
      return { ...state, recentSearches: deduped.slice(0, 10) };
    }

    case 'HYDRATE':
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

export function UserProvider({ children }) {
  const [state, dispatch] = useReducer(userReducer, INITIAL_STATE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('flit_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'HYDRATE', payload: {
          priceAlerts:    parsed.priceAlerts    ?? [],
          recentSearches: parsed.recentSearches ?? [],
        }});
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('flit_user', JSON.stringify({
        priceAlerts:    state.priceAlerts,
        recentSearches: state.recentSearches,
      }));
    } catch { /* ignore */ }
  }, [state.priceAlerts, state.recentSearches]);

  return (
    <UserContext.Provider value={{ state, dispatch }}>
      {children}
    </UserContext.Provider>
  );
}
