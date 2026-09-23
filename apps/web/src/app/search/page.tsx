import { redirect } from "next/navigation";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

// Kept for old links and bookmarks: /search now shows every match on the unified /find page
// (all=1 suppresses the single-hit jump, so a full-text search still behaves like a search).
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  if (!term) redirect("/");
  redirect(`/find?q=${encodeURIComponent(term)}&all=1`);
}
