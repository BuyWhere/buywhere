export default function ServerSideRegisterForm() {
  return (
    <form className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Your name</span>
        <input
          type="text"
          placeholder="Jane Smith"
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
        <input
          type="email"
          placeholder="jane@company.com"
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">What are you building?</span>
        <select
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
        >
          <option>Select a use case (optional)</option>
          <option>AI shopping assistant</option>
          <option>Price comparison tool</option>
          <option>Affiliate recommendation engine</option>
          <option>E-commerce analytics</option>
          <option>LangChain / CrewAI agent</option>
          <option>Other</option>
        </select>
      </label>

      <button
        type="button"
        className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Get free API key →
      </button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Already have a key?{" "}
        <a href="/login" className="text-indigo-600 hover:underline dark:text-indigo-300">
          Sign in
        </a>
      </p>
    </form>
  );
}