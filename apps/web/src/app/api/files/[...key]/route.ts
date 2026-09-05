import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

// Serves stored files. In production R2_PUBLIC_BASE_URL is set and links go straight to R2, so this route only
// matters for local development where the worker writes to LOCAL_STORAGE_DIR.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const rel = key.join("/");
  if (rel.includes("..")) return new NextResponse("bad key", { status: 400 });
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) return NextResponse.redirect(`${base.replace(/\/$/, "")}/${rel}`);
  const dir = process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), "../../services/pipeline/storage_dev");
  try {
    const data = await readFile(path.join(dir, rel));
    const mime = rel.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
    return new NextResponse(data, { headers: { "content-type": mime, "content-disposition": `inline; filename="${path.basename(rel)}"` } });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
