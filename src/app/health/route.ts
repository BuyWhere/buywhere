export function GET(): Response {
  return Response.json({ status: "ok" }, { status: 200 });
}

export function HEAD(): Response {
  return new Response(null, { status: 200 });
}
