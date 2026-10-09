import { NextResponse } from "next/server";

import { backendUrl } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  const response = await fetch(backendUrl("/api/jobs"), {
    cache: "no-store",
    headers: authorization ? { authorization } : undefined,
  });
  const payload = await response.text();

  return new NextResponse(payload, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type") || "application/json";
  const body = await request.text();

  const response = await fetch(backendUrl("/api/jobs"), {
    method: "POST",
    body,
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": contentType,
    },
  });

  const payload = await response.text();

  return new NextResponse(payload, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}

export async function DELETE(request: Request) {
  const authorization = request.headers.get("authorization");

  const response = await fetch(backendUrl("/api/jobs"), {
    method: "DELETE",
    headers: authorization ? { authorization } : undefined,
  });
  const payload = await response.text();

  return new NextResponse(payload, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}
