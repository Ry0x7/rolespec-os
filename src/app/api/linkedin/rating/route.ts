import { NextResponse } from "next/server"

export async function POST(_req?: Request) {
  void _req
  return NextResponse.json(
    { error: "LinkedIn rating is disabled in this edition.", code: "FEATURE_DISABLED" },
    { status: 404 }
  )
}
