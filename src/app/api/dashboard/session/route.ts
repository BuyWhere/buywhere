import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // Verify the API key by checking the account endpoint
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

    // If we get here, the API key is valid
    // In a real implementation, you might want to create a server-side session
    // For now, we'll just return success
    return NextResponse.json({
      success: true,
      message: "Session established successfully",
    });

  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  // This handles session cleanup
  return NextResponse.json({
    success: true,
    message: "Session cleared successfully",
  });
}