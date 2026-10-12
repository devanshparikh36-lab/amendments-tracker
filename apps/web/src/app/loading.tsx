import { TruckLoader } from "@/components/TruckLoader";

/* The fallback for any route without a loading screen of its own.
 *
 * This one stands in for pages of several different shapes -- /definitions, /find, /search, /status,
 * /quality, an instrument's overview -- so there is no outline worth drawing. That is exactly where a plain
 * "something is happening" indicator belongs, and it is why the truck lives here rather than everywhere.
 *
 * The three routes whose shape *is* known keep their skeletons (/browse, /documents and the reading view).
 * A skeleton reserves the space the content will occupy, so the page does not jump when it lands, and on
 * the reading view that is the difference between arriving at a section and being thrown down the page a
 * second after you started reading. The truck cannot do that, and a skeleton cannot be charming; each is
 * used where it is the better answer.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <TruckLoader label="Loading" />
    </div>
  );
}
