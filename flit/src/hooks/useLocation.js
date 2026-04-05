import { useContext } from 'react';
import { LocationContext } from '../context/LocationContext.jsx';

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
