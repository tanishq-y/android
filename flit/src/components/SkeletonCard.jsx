export default function SkeletonCard() {
  return (
    <div className="bg-white rounded-[12px] border border-[#E5E7EB] p-3 flex gap-3">
      {/* Image placeholder */}
      <div className="skeleton w-16 h-16 rounded-lg flex-shrink-0" />

      {/* Content */}
      <div className="flex-1 flex flex-col gap-2 py-0.5">
        {/* Badge + name */}
        <div className="skeleton h-4 w-16 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-3/4 rounded" />

        {/* Price row */}
        <div className="flex gap-2 mt-1">
          <div className="skeleton h-6 w-14 rounded" />
          <div className="skeleton h-4 w-10 rounded mt-1" />
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mt-1">
          <div className="skeleton h-9 flex-1 rounded-lg" />
          <div className="skeleton h-9 flex-1 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
