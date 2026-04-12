import { createContext, useReducer, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export const LocationContext = createContext(null);

const INITIAL_STATE = {
  lat: null,
  lon: null,
  pincode: null,
  address: null,   // "Sector 18, Noida"
  method: null,   // 'gps' | 'manual'
  loading: false,
  error: null,
};

function locationReducer(state, action) {
  switch (action.type) {
    case 'SET_LOCATION': return { ...state, ...action.payload, loading: false, error: null };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_ERROR': return { ...state, error: action.payload, loading: false };
    case 'CLEAR': return { ...INITIAL_STATE };
    case 'HYDRATE': return { ...state, ...action.payload };
    default: return state;
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
          lat: state.lat,
          lon: state.lon,
          pincode: state.pincode,
          address: state.address,
          method: state.method,
        }));
      } catch { /* ignore */ }
    }
  }, [state.lat, state.lon, state.pincode, state.address, state.method]);

  async function requestGPS() {
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      let coords;

      if (Capacitor.isNativePlatform()) {
        const permission = await Geolocation.requestPermissions();
        const denied = permission.location === 'denied' || permission.coarseLocation === 'denied';

        if (denied) {
          throw new Error('Location access denied. Please allow location permission in app settings.');
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });

        coords = position.coords;
      } else {
        if (!navigator.geolocation) {
          throw new Error('Geolocation not supported by your browser.');
        }

        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { timeout: 15000, enableHighAccuracy: true }
          );
        });

        coords = position.coords;
      }

      dispatch({
        type: 'SET_LOCATION',
        payload: {
          lat: coords.latitude,
          lon: coords.longitude,
          method: 'gps',
          address: 'Detecting your area…',
        },
      });

      _reverseGeocode(coords.latitude, coords.longitude)
        .then(address => {
          if (address) dispatch({ type: 'SET_LOCATION', payload: { address } });
        })
        .catch(() => { });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error?.message || 'Location access denied. Please enter your pincode.',
      });
    }
  }

  async function setManualPincode(pin) {
    if (!pin || String(pin).length !== 6) {
      dispatch({ type: 'SET_ERROR', payload: 'Please enter a valid 6-digit pincode.' });
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await res.json();
      if (data[0]?.Status === 'Success') {
        const office = data[0].PostOffice[0];

        // Geocode the pincode to get real lat/lon for platform APIs
        let lat = null;
        let lon = null;
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?postalcode=${pin}&country=India&format=json&limit=1`
          );
          const geoData = await geoRes.json();
          if (geoData?.[0]) {
            lat = parseFloat(geoData[0].lat);
            lon = parseFloat(geoData[0].lon);
          }
        } catch { /* geocoding is best-effort */ }

        dispatch({
          type: 'SET_LOCATION',
          payload: {
            pincode: String(pin),
            address: `${office.Name}, ${office.District}`,
            method: 'manual',
            lat,
            lon,
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
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
    );
    const data = await res.json();
    const addr = data.address;
    return addr?.suburb ?? addr?.neighbourhood ?? addr?.city ?? addr?.town ?? null;
  } catch {
    return null;
  }
}
