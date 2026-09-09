import type { ReactNode } from "react";

type AsyncSurfaceTone = "loading" | "error" | "empty";

interface AsyncSurfaceStateProps {
  tone: AsyncSurfaceTone;
  eyebrow?: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}

function ToneIcon({ tone }: { tone: AsyncSurfaceTone }) {
  if (tone === "error") {
    return (
      <svg className="h-7 w-7 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm8.25-.75A8.25 8.25 0 103.75 12a8.25 8.25 0 0016.5 0z" />
      </svg>
    );
  }

  if (tone === "empty") {
    return (
      <svg className="h-7 w-7 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-4.35-4.35m1.35-5.4a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" />
      </svg>
    );
  }

  return (
    <svg className="h-7 w-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6v6l4 2.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function AsyncSurfaceState({
  tone,
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  meta,
  children,
  compact = false,
}: AsyncSurfaceStateProps) {
  const role = tone === "error" ? "alert" : "status";
  const palette =
    tone === "error"
      ? "border-rose-200 bg-gradient-to-br from-white via-rose-50 to-orange-50"
      : tone === "empty"
        ? "border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50"
        : "border-indigo-200 bg-gradient-to-br from-white via-indigo-50 to-cyan-50";
  const iconWrapClass =
    tone === "error"
      ? "bg-rose-100"
      : tone === "empty"
        ? "bg-slate-100"
        : "bg-indigo-100";

  return (
    <section
      role={role}
      aria-live="polite"
      className={`overflow-hidden rounded-[2rem] border ${palette} shadow-sm`}
    >
      <div className={`${compact ? "p-6" : "p-8 sm:p-10"}`}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className={`mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${iconWrapClass}`}>
              <ToneIcon tone={tone} />
            </div>
            {eyebrow ? (
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
              {description}
            </p>
            {meta ? <div className="mt-4 text-sm text-slate-500">{meta}</div> : null}
            {(primaryAction || secondaryAction) ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {primaryAction}
                {secondaryAction}
              </div>
            ) : null}
          </div>
          {children ? <div className="w-full max-w-xl">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
