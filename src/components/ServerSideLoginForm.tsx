export default function ServerSideLoginForm() {
  return (
    <form className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="bw_live_xxxxxxxxxxxxxxxxx"
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
        />
      </label>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href="/api-keys"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          Create a new key
        </a>
        <a
          href="/quickstart"
          className="inline-flex items-center justify-center rounded-xl text-sm font-semibold text-indigo-700 transition hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          View quickstart
        </a>
      </div>
    </form>
  );
}