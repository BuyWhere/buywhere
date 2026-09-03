import { NextRequest, NextResponse } from "next/server";

// Prevent Next.js from trying to pre-render this route at build time.
// It uses request.headers (dynamic), so must always be rendered at runtime.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Get API key from Authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the API key and get developer profile
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
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      developer: data.developer || null,
    });

  } catch (error) {
    console.error("Account fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}