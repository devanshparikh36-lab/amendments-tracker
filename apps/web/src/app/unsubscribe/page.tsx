import Link from "next/link";
import { UnsubscribeBox } from "@/components/UnsubscribeBox";

/* Where the unsubscribe link in the digest footer lands.
 *
 * noindex for the same reason /confirm is: the URL carries a token, and a crawler that indexed it would
 * publish a link that switches off somebody's mail -- and then fetch it.
 */
export const metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;

  if (!t) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="panel panel-body">
          <p className="eyebrow">Unsubscribe</p>
          <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Nothing to unsubscribe</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            This page needs the token from the link at the bottom of a digest. If you have one to hand, open
            it from there &mdash; or untick <em>Email me when something lands</em> in the account panel on
            any page, which does exactly the same thing.
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
      <UnsubscribeBox token={t} />
    </div>
  );
}
