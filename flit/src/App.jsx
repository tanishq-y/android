import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

import { CartProvider }     from './context/CartContext.jsx';
import { LocationProvider } from './context/LocationContext.jsx';
import { UserProvider }     from './context/UserContext.jsx';

import Header       from './components/Header.jsx';
import HomePage     from './pages/HomePage.jsx';
import ResultsPage  from './pages/ResultsPage.jsx';
import CartPage     from './pages/CartPage.jsx';
import ConnectPage  from './pages/ConnectPageV2.jsx';
import LocationPage from './pages/LocationPage.jsx';

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/"        element={<HomePage />}     />
        <Route path="/results" element={<ResultsPage />}  />
        <Route path="/cart"    element={<CartPage />}      />
        <Route path="/connect" element={<ConnectPage />}   />
        <Route path="/location" element={<LocationPage />} />
        {/* Catch-all */}
        <Route path="*" element={<HomePage />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <LocationProvider>
          <CartProvider>
            <div className="min-h-screen bg-[#F7F8FA]">
              <Header />
              <AnimatedRoutes />
            </div>
          </CartProvider>
        </LocationProvider>
      </UserProvider>
    </BrowserRouter>
  );
}
