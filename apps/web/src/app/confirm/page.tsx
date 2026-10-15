import Link from "next/link";
import { ConfirmBox } from "@/components/ConfirmBox";

/* Where the link in the verification mail lands.
 *
 * noindex, and not as a formality. The URL carries a single-use token, and a crawler that indexes it would
 * publish somebody's confirmation link -- and then search for it, which is a fetch, which is why the
 * confirming action is a button and not this page load. Both halves of that are needed.
 */
export const metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

// The token comes from the query string, so there is nothing to prerender.
export const dynamic = "force-dynamic";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="panel panel-body">
          <p className="eyebrow">Confirm</p>
          <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Nothing to confirm</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            This page is the destination of the link in a confirmation email, and it needs the token from
            that link. If you got here another way, open the account panel on any page and press{" "}
            <em>Send the confirmation again</em>.
          </p>
          <p className="mt-3 text-[13px]">
            <Link href="/" className="text-[var(--link)] hover:underline">
              Go to the site &rarr;
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <ConfirmBox token={token} />
    </div>
  );
}
