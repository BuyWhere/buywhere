import { NextRequest } from "next/server";
import { proxyDashboardApi } from "@/lib/dashboard-api";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { webhookId: string } }
) {
  const { webhookId } = params;
  const body = await request.text();

  return proxyDashboardApi(
    request,
    `/v1/webhooks/${encodeURIComponent(webhookId)}/active`,
    {
      method: "PATCH",
      body,
    }
  );
}
