import { TruckLoader } from "@/components/TruckLoader";

/* The only loading screen left on the site, and the only route that can safely have one.
 *
 * A loading.tsx opens a Suspense boundary, and a Suspense boundary starts the response streaming. Next
 * commits the HTTP status with that first flush, so a `notFound()` or a `redirect()` reached afterwards
 * renders the right page under the wrong status -- 200. That is what made /browse/<junk>, /documents/<junk>
 * and every bad provision slug answer 200 with "There is nothing at that address" in the body, which Google
 * reads as a soft 404 and will index, and it is what turned the legacy ?p= redirect into a 200 as well.
 * Measured, not assumed: with the four loading.tsx files in place all of those answered 200; with them gone
 * all of them answer 404, and the redirect answers 307.
 *
 * SO: NEVER ADD A loading.tsx OVER A ROUTE THAT CAN 404. In practice that means never above a dynamic
 * segment -- /browse/[slug], /browse/[slug]/text, /browse/[slug]/[prov]/history and /documents/[id] -- and
 * never at the app root, because the root covers all four.
 *
 * /definitions is the exception that is worth it. It has no dynamic segment beneath it, so nothing under it
 * can 404, and it is the slowest page on the site: 2.8 seconds to first byte against 0.1-0.6 for everything
 * else. Without this the reader sits on the previous page for nearly three seconds with no sign that
 * anything is happening.
 *
 * The reading view, /browse/[slug]/text, is the page that lost most here -- 1.7 seconds, and it used to
 * have a proper skeleton. Getting that back means moving the slow part into an explicit <Suspense> inside
 * the page, below the existence check, so the status is settled before any streaming begins. That is the
 * right shape for it; it is simply more than a loading.tsx.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <TruckLoader label="Loading" />
    </div>
  );
}
