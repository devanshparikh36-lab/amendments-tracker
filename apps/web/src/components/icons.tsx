/* The small set of icons the action row uses.
 *
 * Inline SVG rather than an icon package: six glyphs is not worth a dependency, a font request or a
 * sprite sheet, and inline marks inherit `currentColor` so they follow the theme without being told.
 *
 * Every one is drawn on a 24-unit grid with a 1.7 stroke, which is heavy enough to hold at 16px -- the
 * size they actually render at. Hairline icons are the usual mistake here: they look precise in a design
 * and disappear on a laptop screen.
 *
 * `filled` is how state is shown. A bell that is merely outlined versus one that is solid reads as
 * off/on at a glance and in a way colour alone does not, which matters for the eight percent of men who
 * will not reliably see a green button as different from a grey one.
 */

type IconProps = { filled?: boolean; className?: string };

const base = {
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function BellIcon({ filled, className }: IconProps) {
  return (
    <svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" fill="none" />
    </svg>
  );
}

export function BookmarkIcon({ filled, className }: IconProps) {
  return (
    <svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function NoteIcon({ filled, className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 20h9" />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

export function PrinterIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function QuoteIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 15a3 3 0 1 1 0-6c0-2 1-3.5 3-4.5" />
      <path d="M17 15a3 3 0 1 1 0-6c0-2 1-3.5 3-4.5" />
    </svg>
  );
}

export function TickIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={2.2}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
