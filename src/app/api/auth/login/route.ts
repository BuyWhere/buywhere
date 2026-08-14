import { NextRequest, NextResponse } from "next/server";

// Returns {apiKey|null, error?} parsed from either a JSON body ({ apiKey }) or a
// classic form-encoded body (apiKey=...). Supports both the hydrated client
// LoginForm (JSON fetch) and the no-JS SSR ServerSideLoginForm (form POST).
async function readApiKey(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const { apiKey } = await request.json();
      return typeof apiKey === "string" ? apiKey : null;
    } catch {
      return null;
    }
  }

  // application/x-www-form-urlencoded (native form POST without JS).
  try {
    const form = await request.formData();
    const value = form.get("apiKey");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const isFormPost =
    (request.headers.get("content-type") ?? "").includes(
      "application/x-www-form-urlencoded",
    );

  try {
    const apiKey = await readApiKey(request);

    if (!apiKey) {
      return loginError("API key is required", 400, isFormPost);
    }

    // Validate API key by checking if it starts with the expected prefix
    if (!apiKey.startsWith("bw_live_") && !apiKey.startsWith("bw_test_")) {
      return loginError("Invalid API key format", 400, isFormPost);
    }

    // Try to verify the API key by making a request to the dashboard account endpoint
    const response = await fetch(`${process.env.API_BASE_URL || "https://api.buywhere.ai"}/v1/dashboard/account`, {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return loginError("Invalid API key", 401, isFormPost);
    }

    const data = await response.json();

    if (isFormPost) {
      // No-JS path: the dashboard reads the key from localStorage client-side,
      // so a full session cannot start without JS. Redirect back to /login with
      // a success marker; the page shows a "session started, enable JS for the
      // dashboard" notice. The native form POST itself is the accessibility win.
      const url = new URL("/login", request.url);
      url.searchParams.set("signin", "ok");
      return NextResponse.redirect(url, { status: 303 });
    }

    // Return success response with the API key (for client-side storage)
    return NextResponse.json({
      success: true,
      apiKey: apiKey,
      user: data.developer || null,
    });
  } catch (error) {
    console.error("Login error:", error);
    return loginError("Internal server error", 500, isFormPost);
  }
}

function loginError(message: string, status: number, isFormPost: boolean) {
  if (isFormPost) {
    const url = new URL("/login", "https://buywhere.ai");
    url.searchParams.set("error", "invalid_key");
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json({ error: message }, { status });
}
