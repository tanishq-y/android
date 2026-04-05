import { createContext, useReducer, useEffect, useMemo } from 'react';

export const CartContext = createContext(null);

const INITIAL_STATE = {
  items: [],           // [{ id, product, quantity, addedAt }]
  appliedCoupon: null,
};

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find(i => i.id === action.payload.id);
      if (existing) {
        return {
          ...state,
          items: state.items.map(i =>
            i.id === action.payload.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        };
      }
      return {
        ...state,
        items: [
          ...state.items,
          { id: action.payload.id, product: action.payload, quantity: 1, addedAt: Date.now() },
        ],
      };
    }

    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.payload) };

    case 'UPDATE_QTY': {
      if (action.payload.quantity <= 0) {
        return { ...state, items: state.items.filter(i => i.id !== action.payload.id) };
      }
      return {
        ...state,
        items: state.items.map(i =>
          i.id === action.payload.id ? { ...i, quantity: action.payload.quantity } : i
        ),
      };
    }

    case 'CLEAR_CART':
      return { ...INITIAL_STATE };

    case 'HYDRATE':
      return action.payload;

    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, INITIAL_STATE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('flit_cart');
      if (saved) dispatch({ type: 'HYDRATE', payload: JSON.parse(saved) });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('flit_cart', JSON.stringify(state));
    } catch { /* ignore */ }
  }, [state]);

  const cartComparison = useMemo(() => {
    const total = state.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity, 0
    );

    const platformGroups = state.items.reduce((groups, item) => {
      const p = item.product.platform;
      if (!groups[p]) groups[p] = { items: [], subtotal: 0 };
      groups[p].items.push(item);
      groups[p].subtotal += item.product.price * item.quantity;
      return groups;
    }, {});

    return {
      total,
      itemCount: state.items.reduce((sum, i) => sum + i.quantity, 0),
      platformGroups,
      suggestedSplit: Object.entries(platformGroups).map(([platform, data]) => ({
        platform,
        items:    data.items,
        subtotal: data.subtotal,
      })),
    };
  }, [state]); // MUST be [state] not individual fields

  return (
    <CartContext.Provider value={{ state, dispatch, cartComparison }}>
      {children}
    </CartContext.Provider>
  );
}
