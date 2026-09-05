import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Serves stored files.
//  - R2_PUBLIC_BASE_URL set: redirect to the public bucket URL.
//  - R2_* credentials set (no public URL): stream the object from R2 privately.
//  - neither: local development, read from LOCAL_STORAGE_DIR.
let s3: S3Client | null = null;
function r2(): S3Client | null {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  s3 ??= new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return s3;
}

function mimeFor(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const rel = key.join("/");
  if (rel.includes("..")) return new NextResponse("bad key", { status: 400 });
  const name = path.basename(rel);

  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) return NextResponse.redirect(`${base.replace(/\/$/, "")}/${rel}`);

  const client = r2();
  if (client) {
    try {
      const obj = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: rel }));
      const bytes = await obj.Body!.transformToByteArray();
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "content-type": obj.ContentType ?? mimeFor(rel),
          "content-disposition": `inline; filename="${name}"`,
          "cache-control": "private, max-age=3600",
        },
      });
    } catch {
      return new NextResponse("not found", { status: 404 });
    }
  }

  const dir = process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), "../../services/pipeline/storage_dev");
  try {
    const data = await readFile(path.join(dir, rel));
    return new NextResponse(data, { headers: { "content-type": mimeFor(rel), "content-disposition": `inline; filename="${name}"` } });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
