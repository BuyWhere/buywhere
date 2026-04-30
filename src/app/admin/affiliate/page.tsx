import { AffiliateDashboardClient } from "@/components/admin/AffiliateDashboardClient";
import { assertAdminPageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AffiliateAdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const resolvedSearchParams = await searchParams;
    const adminToken = await assertAdminPageAccess(resolvedSearchParams);
    return <AffiliateDashboardClient adminToken={adminToken} />;
  } catch (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="max-w-lg rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <p className="text-sm uppercase tracking-[0.22em] text-sky-300">Admin access required</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Affiliate dashboard is restricted</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            {error instanceof Error ? error.message : "This page is only available to admin sessions."}
          </p>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            Local requests are allowed automatically. Remote access requires `BUYWHERE_ADMIN_TOKEN` or `ADMIN_TOKEN`, supplied as `?token=...`.
          </p>
        </div>
      </div>
    );
  }
}
