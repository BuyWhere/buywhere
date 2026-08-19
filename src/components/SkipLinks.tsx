export default function SkipLinks() {
  return (
    <div className="sr-only focus-within:not-sr-only">
      <a
        href="#main-content"
        className="fixed top-4 left-4 z-[200] -translate-y-20 focus:translate-y-0 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm shadow-lg transition-transform focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-600"
      >
        Skip to main content
      </a>
      <a
        href="#main-navigation"
        className="fixed top-4 left-44 z-[200] -translate-y-20 focus:translate-y-0 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm shadow-lg transition-transform focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-600"
      >
        Skip to navigation
      </a>
    </div>
  );
}
