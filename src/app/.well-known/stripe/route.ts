const RESPONSE_BODY = {
  error: "not_found",
  message:
    "BuyWhere customer portal sessions are private authenticated flows and are not available from this public alias.",
  recovery: "/account?tab=billing",
};

function notFoundResponse() {
  return Response.json(RESPONSE_BODY, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function GET() {
  return notFoundResponse();
}

export function POST() {
  return notFoundResponse();
}
