import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';

export default function SearchBar({ initialValue = '', autoFocus = false, size = 'lg' }) {
  const [value, setValue]   = useState(initialValue);
  const navigate            = useNavigate();
  const inputRef            = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  // Keep in sync if parent changes initialValue (e.g. ResultsPage pre-filling from URL)
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  function handleSubmit(e) {
    e?.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/results?q=${encodeURIComponent(q)}`);
  }

  function handleClear() {
    setValue('');
    inputRef.current?.focus();
  }

  const isLg   = size === 'lg';
  const height  = isLg ? 'h-[52px]' : 'h-[44px]';
  const radius  = isLg ? 'rounded-[26px]' : 'rounded-[22px]';
  const textSz  = isLg ? 'text-base' : 'text-sm';
  const iconSz  = isLg ? 20 : 18;

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={`relative flex items-center ${height} ${radius} bg-white border transition-all`}
        style={{
          borderColor:  value ? '#0D9F6F' : '#E5E7EB',
          borderWidth:  '1.5px',
          boxShadow:    value
            ? '0 0 0 3px rgba(13,159,111,0.12), 0 2px 8px rgba(0,0,0,0.06)'
            : '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Search icon */}
        <span className="absolute left-4 flex-shrink-0 pointer-events-none">
          <Search size={iconSz} color="#9CA3AF" />
        </span>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Search for milk, eggs, bread…"
          className={`w-full h-full bg-transparent outline-none font-body ${textSz} text-gray-900 placeholder-gray-400`}
          style={{ paddingLeft: '2.75rem', paddingRight: value ? '2.75rem' : '1rem' }}
          aria-label="Search products"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Clear button */}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </form>
  );
}
