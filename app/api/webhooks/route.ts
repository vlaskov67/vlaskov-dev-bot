import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("📩 Webhook received:", body);

  return NextResponse.json({ ok: true });
}
