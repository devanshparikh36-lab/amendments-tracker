import { SkeletonLine, SkeletonParagraph, SkeletonScreen } from "@/components/Skeleton";

/* The reading view, before it arrives.
 *
 * This is the page that most needs one. It is the heaviest query on the site -- an instrument, its whole
 * provision index and one provision's text and documents -- and it is the page people arrive at from a
 * link, which means a cold database and a blank screen for two seconds on the first impression.
 *
 * The outline matches the real layout: contents on the left, text on the right, collapsing to one column on
 * a phone exactly as the page does. So the content lands into the shape rather than shoving it.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading this instrument">
      <div className="space-y-3">
        <div className="border-b border-[var(--rule)] pb-3">
          <SkeletonLine w="w-56" h="h-3" />
          <div className="mt-2">
            <SkeletonLine w="w-1/2" h="h-7" />
          </div>
          <div className="mt-2">
            <SkeletonLine w="w-72" h="h-4" />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Contents. Hidden below lg, as the real one is. */}
          <div className="panel hidden p-3 lg:block">
            <SkeletonLine w="w-24" h="h-3" />
            <div className="mt-2">
              <SkeletonLine h="h-8" />
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: 14 }, (_, i) => (
                <SkeletonLine key={i} w={i % 3 === 0 ? "w-11/12" : "w-full"} h="h-3.5" />
              ))}
            </div>
          </div>

          {/* The provision. */}
          <div className="panel">
            <div className="border-b border-[var(--rule)] px-5 py-4">
              <SkeletonLine w="w-2/3" h="h-6" />
              <div className="mt-3 flex gap-2">
                <SkeletonLine w="w-32" h="h-7" />
                <SkeletonLine w="w-28" h="h-7" />
                <SkeletonLine w="w-24" h="h-7" />
              </div>
            </div>
            <div className="px-5 py-4">
              <SkeletonParagraph lines={9} />
            </div>
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
