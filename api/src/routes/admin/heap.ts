// 2026-10-18: memory-leak diagnostics. buywhere-api grew ~0.2 GB/day per replica and
// OOM-crashed at the 450 MB heap cap. Admin-only:
//   GET /v1/admin/debug/memory   process + V8 heap-space stats (cheap)
//   GET /v1/admin/debug/heap     streams a V8 heap snapshot (.heapsnapshot; pauses this
//                                replica for a few seconds — use sparingly)
import { Router, Request, Response } from "express";
import v8 from "v8";
import { adminAuth } from "./auth";

const router = Router();

router.get("/v1/admin/debug/memory", adminAuth, (_req: Request, res: Response) => {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  res.json({
    replica: process.env.RAILWAY_REPLICA_ID || null,
    uptime_s: Math.round(process.uptime()),
    rss_mb: mb(m.rss), heap_used_mb: mb(m.heapUsed), heap_total_mb: mb(m.heapTotal),
    external_mb: mb(m.external), array_buffers_mb: mb(m.arrayBuffers),
    heap_limit_mb: mb(v8.getHeapStatistics().heap_size_limit),
    spaces: v8.getHeapSpaceStatistics().map(s => ({ space: s.space_name, used_mb: mb(s.space_used_size) })),
  });
});

router.get("/v1/admin/debug/heap", adminAuth, (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="api-${Date.now()}.heapsnapshot"`);
  v8.getHeapSnapshot().pipe(res);
});

export default router;
