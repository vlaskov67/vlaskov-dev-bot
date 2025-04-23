export async function POST() {
  console.log("Webhook OK!");
  return NextResponse.json({ status: "ok" });
}

