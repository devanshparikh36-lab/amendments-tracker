import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Kept for old links and bookmarks: /search now shows every match on the unified /find page
// (all=1 suppresses the single-hit jump, so a full-text search still behaves like a search).
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  if (!term) redirect("/");
  redirect(`/find?q=${encodeURIComponent(term)}&all=1`);
}
