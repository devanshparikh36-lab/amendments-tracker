import { SkeletonLine, SkeletonScreen } from "@/components/Skeleton";

/* The instrument index: subject chips, then cards in a grid. */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading the index">
      <div className="space-y-6">
        <div className="border-b border-[var(--rule)] pb-3">
          <SkeletonLine w="w-28" h="h-3" />
          <div className="mt-2">
            <SkeletonLine w="w-96" h="h-7" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["w-24", "w-28", "w-20", "w-32", "w-36"].map((w, i) => (
            <SkeletonLine key={i} w={w} h="h-7" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="panel space-y-2 p-4">
              <SkeletonLine w="w-4/5" h="h-5" />
              <SkeletonLine w="w-3/5" h="h-3" />
              <SkeletonLine w="w-2/5" h="h-3" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
