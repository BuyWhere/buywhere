import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // Validate API key by checking if it starts with the expected prefix
    if (!apiKey.startsWith("bw_live_") && !apiKey.startsWith("bw_test_")) {
      return NextResponse.json(
        { error: "Invalid API key format" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    const data = await response.json();

    // Return success response with the API key (for client-side storage)
    return NextResponse.json({
      success: true,
      apiKey: apiKey,
      user: data.developer || null,
    });

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}