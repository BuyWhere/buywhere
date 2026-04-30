export default function Loading() {
  return (
    <div className="flex flex-col min-h-screen">
      <div className="h-16 bg-white border-b border-gray-100 animate-pulse" />
      <div className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24">
          <div className="space-y-8">
            <div className="h-12 bg-gray-200 rounded-lg w-3/4 animate-pulse" />
            <div className="h-6 bg-gray-200 rounded w-1/2 animate-pulse" />
            <div className="h-6 bg-gray-200 rounded w-5/6 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}