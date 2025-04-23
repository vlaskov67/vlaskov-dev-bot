import { NextRequest, NextResponse } from "next/server";

/**
 * GitHub webhook entry-point.
 * Пока просто подтверждаем получение — возвращаем 200 OK.
 * Когда решите, можно расширить логикой «фабрики кода».
 */
export async function POST(req: NextRequest) {
  // TODO: здесь позже проверять подпись и обрабатывать payload
  return NextResponse.json({ ok: true });
}
