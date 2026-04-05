import { useState }      from 'react';
import { useNavigate }   from 'react-router-dom';
import { ArrowLeft, MapPin, Navigation, CheckCircle } from 'lucide-react';
import { useLocation }   from '../hooks/useLocation.js';

export default function LocationPage() {
  const navigate                 = useNavigate();
  const { state, requestGPS, setManualPincode } = useLocation();
  const [pincode, setPincode]    = useState('');

  function handlePincodeSubmit(e) {
    e?.preventDefault();
    setManualPincode(pincode);
  }

  function handleDone() {
    navigate(-1);
  }

  return (
    <main className="bg-[#F7F8FA] min-h-screen pb-20">
      <div className="max-w-[480px] mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="font-heading font-bold text-[20px] text-gray-900">
            Delivery Location
          </h1>
        </div>

        {/* Current location display */}
        {state.address && (
          <div
            className="flex items-start gap-3 p-3.5 rounded-[12px] border mb-5"
            style={{ background: '#F0FDF4', borderColor: '#A7F3D0' }}
          >
            <CheckCircle size={18} style={{ color: '#059669' }} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-gray-700">Current location</p>
              <p className="text-[14px] font-bold text-gray-900">{state.address}</p>
              {state.pincode && (
                <p className="text-[12px] text-gray-500">Pincode: {state.pincode}</p>
              )}
            </div>
          </div>
        )}

        {/* GPS button */}
        <button
          onClick={requestGPS}
          disabled={state.loading}
          className="w-full flex items-center justify-center gap-2.5 h-12 rounded-[12px] border-2 font-semibold text-[14px] mb-5 transition-all disabled:opacity-60"
          style={{ borderColor: '#0D9F6F', color: '#0D9F6F', background: '#fff' }}
        >
          {state.loading ? (
            <div className="w-4 h-4 border-2 border-[#0D9F6F] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Navigation size={18} />
          )}
          {state.loading ? 'Detecting location…' : '📍 Use my current location'}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-[#E5E7EB]" />
          <span className="text-[12px] text-gray-400 font-medium">or</span>
          <div className="flex-1 h-px bg-[#E5E7EB]" />
        </div>

        {/* Pincode input */}
        <form onSubmit={handlePincodeSubmit}>
          <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
            Enter pincode
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={pincode}
              onChange={e => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="e.g. 201301"
              className="flex-1 h-11 px-4 rounded-[10px] border border-[#E5E7EB] bg-white text-[15px] text-gray-900 outline-none transition-colors focus:border-[#0D9F6F]"
            />
            <button
              type="submit"
              disabled={pincode.length !== 6 || state.loading}
              className="px-5 h-11 rounded-[10px] text-white font-semibold text-[14px] disabled:opacity-50 transition-opacity"
              style={{ background: '#0D9F6F' }}
            >
              Confirm
            </button>
          </div>
        </form>

        {/* Error */}
        {state.error && (
          <p className="mt-3 text-[13px] text-red-600">{state.error}</p>
        )}

        {/* Done button */}
        {state.address && (
          <button
            onClick={handleDone}
            className="w-full mt-6 h-12 rounded-[12px] text-white font-semibold text-[15px] transition-opacity hover:opacity-90"
            style={{ background: '#0D9F6F' }}
          >
            Done
          </button>
        )}

        {/* Info note */}
        <p className="text-[12px] text-gray-400 mt-6 text-center leading-relaxed">
          Your location is used to fetch prices from the correct store.
          It's saved locally and never sent to Flit servers.
        </p>

      </div>
    </main>
  );
}
