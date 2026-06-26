import { NextRequest, NextResponse } from "next/server";
import { db } from "@platform/db";
import { user } from "@platform/db";
import { eq, count, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // Only allow setup when no privileged user (ADMIN or SUPERADMIN) exists
    const rows = await db
      .select({ adminCount: count() })
      .from(user)
      .where(inArray(user.role, ["ADMIN", "SUPERADMIN"]));

    const adminCount = rows[0]?.adminCount ?? 0;

    if (Number(adminCount) > 0) {
      return NextResponse.json(
        { error: "An admin already exists. Contact your administrator." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, name } = body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "email, password, and name are required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // Create the user via Better Auth so the password is hashed correctly
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    });

    if (!result || !result.user) {
      return NextResponse.json(
        { error: "Failed to create user." },
        { status: 500 }
      );
    }

    // Promote to ADMIN
    await db
      .update(user)
      .set({ role: "ADMIN" })
      .where(eq(user.id, result.user.id));

    return NextResponse.json({
      message: "First admin created successfully.",
      userId: result.user.id,
    });
  } catch (err) {
    console.error("[setup] error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
