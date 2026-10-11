import { SkeletonLine, SkeletonScreen } from "@/components/Skeleton";

/* A list of notifications, before it arrives: filters, then rows of roughly equal height. */
export default function Loading() {
  return (
    <SkeletonScreen label="Loading notifications">
      <div className="space-y-6">
        <div className="border-b border-[var(--rule)] pb-3">
          <SkeletonLine w="w-32" h="h-3" />
          <div className="mt-2">
            <SkeletonLine w="w-80" h="h-7" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["w-24", "w-20", "w-28", "w-24", "w-32"].map((w, i) => (
            <SkeletonLine key={i} w={w} h="h-7" />
          ))}
        </div>
        <div className="panel divide-y divide-[var(--rule)]">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="space-y-2 px-4 py-3">
              <SkeletonLine w={i % 2 ? "w-3/4" : "w-5/6"} h="h-4" />
              <SkeletonLine w="w-2/5" h="h-3" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
