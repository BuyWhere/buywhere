import { NextRequest } from "next/server";
import { proxyDashboardApi } from "@/lib/dashboard-api";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { webhookId: string } }
) {
  const { webhookId } = params;

  return proxyDashboardApi(
    request,
    `/v1/webhooks/${encodeURIComponent(webhookId)}`,
    { method: "DELETE" }
  );
}
