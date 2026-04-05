import { createContext, useReducer, useEffect } from 'react';

export const LocationContext = createContext(null);

const INITIAL_STATE = {
  lat:     null,
  lon:     null,
  pincode: null,
  address: null,   // "Sector 18, Noida"
  method:  null,   // 'gps' | 'manual'
  loading: false,
  error:   null,
};

function locationReducer(state, action) {
  switch (action.type) {
    case 'SET_LOCATION': return { ...state, ...action.payload, loading: false, error: null };
    case 'SET_LOADING':  return { ...state, loading: action.payload };
    case 'SET_ERROR':    return { ...state, error: action.payload, loading: false };
    case 'CLEAR':        return { ...INITIAL_STATE };
    case 'HYDRATE':      return { ...state, ...action.payload };
    default:             return state;
  }
}

export function LocationProvider({ children }) {
  const [state, dispatch] = useReducer(locationReducer, INITIAL_STATE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('flit_location');
      if (saved) dispatch({ type: 'HYDRATE', payload: JSON.parse(saved) });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (state.lat || state.pincode) {
      try {
        localStorage.setItem('flit_location', JSON.stringify({
          lat:     state.lat,
          lon:     state.lon,
          pincode: state.pincode,
          address: state.address,
          method:  state.method,
        }));
      } catch { /* ignore */ }
    }
  }, [state.lat, state.lon, state.pincode, state.address, state.method]);

  function requestGPS() {
    if (!navigator.geolocation) {
      dispatch({ type: 'SET_ERROR', payload: 'Geolocation not supported by your browser.' });
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        dispatch({
          type: 'SET_LOCATION',
          payload: {
            lat:     pos.coords.latitude,
            lon:     pos.coords.longitude,
            method:  'gps',
            address: 'Detecting your area…',
          },
        });
        // Reverse geocode for a human-readable label
        _reverseGeocode(pos.coords.latitude, pos.coords.longitude)
          .then(address => {
            if (address) dispatch({ type: 'SET_LOCATION', payload: { address } });
          })
          .catch(() => {});
      },
      (_err) => {
        dispatch({ type: 'SET_ERROR', payload: 'Location access denied. Please enter your pincode.' });
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  }

  async function setManualPincode(pin) {
    if (!pin || String(pin).length !== 6) {
      dispatch({ type: 'SET_ERROR', payload: 'Please enter a valid 6-digit pincode.' });
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res  = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await res.json();
      if (data[0]?.Status === 'Success') {
        const office = data[0].PostOffice[0];
        dispatch({
          type: 'SET_LOCATION',
          payload: {
            pincode: String(pin),
            address: `${office.Name}, ${office.District}`,
            method:  'manual',
            lat:     null,
            lon:     null,
          },
        });
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Pincode not found. Please check and try again.' });
      }
    } catch {
      dispatch({ type: 'SET_ERROR', payload: 'Could not look up pincode. Check your connection.' });
    }
  }

  return (
    <LocationContext.Provider value={{ state, dispatch, requestGPS, setManualPincode }}>
      {children}
    </LocationContext.Provider>
  );
}

async function _reverseGeocode(lat, lon) {
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
    );
    const data = await res.json();
    const addr = data.address;
    return addr?.suburb ?? addr?.neighbourhood ?? addr?.city ?? addr?.town ?? null;
  } catch {
    return null;
  }
}
