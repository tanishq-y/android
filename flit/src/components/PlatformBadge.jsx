import { getPlatform } from '../data/platforms.js';

export default function PlatformBadge({ platform, size = 'sm' }) {
  const p = getPlatform(platform);
  if (!p) return null;

  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-md ${padding}`}
      style={{
        backgroundColor: p.bgColor,
        color:           p.color,
      }}
    >
      {p.name}
    </span>
  );
}
