import { SkeletonLine, SkeletonParagraph, SkeletonScreen } from "@/components/Skeleton";

/* The fallback for any route without a loading screen of its own.
 *
 * Deliberately generic -- a title, a row of controls, a panel -- because it stands in for pages of several
 * different shapes. Routes whose shape is distinctive enough to be worth matching have their own file
 * beside them; this is what the rest get, and it is still far better than the blank screen it replaces.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading">
      <div className="space-y-6">
        <div className="border-b border-[var(--rule)] pb-3">
          <SkeletonLine w="w-40" h="h-3" />
          <div className="mt-2">
            <SkeletonLine w="w-2/5" h="h-7" />
          </div>
          <div className="mt-2">
            <SkeletonLine w="w-3/5" h="h-4" />
          </div>
        </div>
        <div className="panel panel-body">
          <SkeletonParagraph lines={5} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
