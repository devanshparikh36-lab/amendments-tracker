import { readFile } from "fs/promises";
import path from "path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Reading a stored object on the server. Three deployments to satisfy, same as the file-serving route:
// R2 with credentials, or local development against a directory on disk.
let s3: S3Client | null = null;

export function r2Client(): S3Client | null {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  s3 ??= new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return s3;
}

/** Bytes of a stored object, or null when it is not there. Never throws: callers degrade rather than fail. */
export async function readStoredObject(key: string): Promise<Buffer | null> {
  if (key.includes("..")) return null;

  // The public bucket URL first, because that is the only one of the three this app reliably has. The web
  // app is given R2_PUBLIC_BASE_URL so it can link to files, but not the R2 credentials -- it never needed
  // them to serve a link. Reaching for the S3 client first meant reading nothing at all in both development
  // and production while looking like the object was simply missing.
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/${key}`, { cache: "no-store" });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // fall through to the other routes
    }
  }

  const client = r2Client();
  if (client) {
    try {
      const obj = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
      return Buffer.from(await obj.Body!.transformToByteArray());
    } catch {
      return null;
    }
  }
  const dir = process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), "../../services/pipeline/storage_dev");
  try {
    return await readFile(path.join(dir, key));
  } catch {
    return null;
  }
}

/** Per-page text of a stored PDF, as written by `cli.py pageindex`. Page 1 is index 0. */
export async function readPageIndex(pageIndexKey: string | null | undefined): Promise<string[] | null> {
  if (!pageIndexKey) return null;
  const raw = await readStoredObject(pageIndexKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString("utf-8")) as { pages?: unknown };
    return Array.isArray(parsed.pages) ? (parsed.pages as string[]) : null;
  } catch {
    return null;
  }
}

/** 1-based page whose text best answers `q`, or null when nothing on any page matches.
 *
 * Scored rather than first-match: a term often appears in a contents list or a covering letter pages before
 * the provision that actually deals with it, and sending a reader there is worse than sending them to page 1,
 * because it looks like the search worked. The page carrying the most distinct query words wins, ties going
 * to the earlier page.
 */
export function bestPageFor(pages: string[], q: string): number | null {
  const words = Array.from(new Set(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));
  if (!words.length) return null;
  let bestPage: number | null = null;
  let bestScore = 0;
  pages.forEach((text, i) => {
    const lower = (text || "").toLowerCase();
    let score = 0;
    for (const w of words) if (lower.includes(w)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestPage = i + 1;
    }
  });
  return bestScore > 0 ? bestPage : null;
}
