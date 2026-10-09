import { NextResponse } from "next/server";

import { backendUrl } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = await fetch(backendUrl("/api/auth/guest"), {
    method: "POST",
  });

  const payload = await response.text();

  return new NextResponse(payload, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}
