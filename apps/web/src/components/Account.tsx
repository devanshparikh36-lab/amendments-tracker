"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  type Reader,
  clearReader,
  clearSeen,
  displayName,
  looksLikeEmail,
  normaliseEmail,
  onReaderChange,
  readReader,
  readSeen,
  type Seen,
  writeReader,
} from "@/lib/reader";

/* The greeting in the masthead, and the panel it opens.
 *
 * Both live in one component because they share a single piece of state and sit in different corners of
 * the page -- splitting them would mean lifting that state into the layout, which is a server component.
 *
 * Everything here runs after the page has painted. The HTML is identical for every reader and is served
 * from a prerender or an edge cache; the name arrives a beat later. That ordering is what lets the site
 * stay cached and free, and it is why there is a deliberate "not yet known" state rather than a spinner:
 * a reader who is not signed in should see "Sign in" immediately, not a flicker of someone else's name.
 */

type State = {
  watching: number;
  bookmarks: number;
  notes: number;
  searches: number;
  alertsOn: boolean;
  /* Always "daily" since 0017. Kept on the wire so an older cached client does not read undefined, and
   * because re-admitting a second cadence should not mean re-deriving this type. */
  alertFreq: "daily";
  alertsConfirmed: boolean;
  since: { id: number; title: string; about: string | null; regulator_code: string }[];
};

export function Account() {
  const [reader, setReader] = useState<Reader | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [seen, setSeen] = useState<Seen[]>([]);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Identify on arrival. This is also what moves the "last seen" clock, so it must run once per visit and
   * not once per drawer opening -- otherwise the "since you were last here" window closes the first time
   * someone looks at it. */
  const identify = useCallback(async (r: Reader) => {
    try {
      const res = await fetch("/api/reader", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "identify", email: r.email, name: r.name ?? "" }),
      });
      if (!res.ok) return;
      const d = await res.json();
      setState({
        watching: d.watching ?? 0,
        bookmarks: d.bookmarks ?? 0,
        notes: d.notes ?? 0,
        searches: d.searches ?? 0,
        alertsOn: !!d.alertsOn,
        alertFreq: "daily",
        alertsConfirmed: !!d.alertsConfirmed,
        since: Array.isArray(d.since) ? d.since : [],
      });
      // The server is the authority on the name: another device may have changed it.
      if (d.name && d.name !== r.name) writeReader({ email: r.email, name: d.name });
    } catch {
      /* the site works without any of this */
    }
  }, []);

  useEffect(() => {
    const load = () => {
      const r = readReader();
      setReader(r);
      setDraftName(r?.name ?? "");
      setReady(true);
    };
    load();
    setSeen(readSeen());
    return onReaderChange(load);
  }, []);

  useEffect(() => {
    if (reader) void identify(reader);
    else setState(null);
  }, [reader, identify]);

  // Escape closes, and the panel takes focus when it opens so a keyboard reader is not left behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    setSeen(readSeen());
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/reader", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    const email = normaliseEmail(draftEmail);
    if (!looksLikeEmail(email)) return;
    writeReader({ email, name: draftName.trim() || undefined });
    setDraftEmail("");
    setSwitching(false);
  }

  async function saveName() {
    if (!reader) return;
    const name = draftName.trim().slice(0, 60);
    await post({ action: "rename", email: reader.email, name });
    writeReader({ email: reader.email, name: name || undefined });
  }

  async function setAlerts(on: boolean) {
    if (!reader || !state) return;
    setState({ ...state, alertsOn: on, alertFreq: "daily" });
    const d = await post({ action: "alerts", email: reader.email, on });
    if (d) {
      setState((s) =>
        s ? { ...s, alertsOn: !!d.alertsOn, alertFreq: "daily", alertsConfirmed: !!d.alertsConfirmed } : s,
      );
    }
  }

  /* Built in the browser rather than linked, because the address must travel in a body and not a URL --
   * a reader's email in a query string ends up in history, in a Referer header and in a server log. */
  async function exportData() {
    if (!reader) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reader/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: reader.email }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "as-amended-my-data.csv";
      /* In the document, and revoked on a later tick. A detached anchor does not reliably fire a
       * download in every browser, and revoking the object URL in the same tick as the click can cancel
       * the download that click just started -- the file silently never arrives. */
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
    } catch {
      /* nothing downloaded; the button stays */
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (!reader) return;
    await post({ action: "forget", email: reader.email });
    clearReader();
    clearSeen();
    setSeen([]);
    setOpen(false);
  }

  const name = displayName(reader);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print shrink-0 rounded px-2.5 py-1.5 text-[13px] text-[var(--ink-3)] hover:bg-[var(--tint)] hover:text-[var(--ink)]"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Nothing until localStorage has been read: the server cannot know, and rendering "Sign in"
            before checking would flash it at someone who is already signed in. */}
        {!ready ? <span className="opacity-0">Account</span> : reader ? <>Hi, {name}</> : "Sign in"}
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-[60]">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[var(--scrim)]"
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Your account"
            className="drawer absolute left-0 top-0 flex h-full w-[min(360px,88vw)] flex-col overflow-y-auto border-r border-[var(--rule)] bg-[var(--paper)] p-5 shadow-xl outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{reader ? "Signed in as" : "Your account"}</p>
                <p className="serif mt-0.5 text-[18px] font-semibold text-[var(--ink)]">
                  {reader ? `Hi, ${name}` : "Follow what matters"}
                </p>
                {reader && <p className="mt-0.5 break-all text-[12px] text-[var(--ink-3)]">{reader.email}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-[13px] text-[var(--ink-3)] hover:bg-[var(--tint)] hover:text-[var(--ink)]"
              >
                Close
              </button>
            </div>

            {(!reader || switching) && (
              <form onSubmit={signIn} className="mt-5">
                <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">
                  An email address is all it takes. No password, and nothing is sent unless you ask for it.
                  Type the same address on another device and your list follows you.
                </p>
                <label className="eyebrow mt-4 block" htmlFor="acct-email">
                  Email
                </label>
                <input
                  id="acct-email"
                  type="email"
                  autoComplete="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 text-[14px] text-[var(--ink)]"
                />
                <label className="eyebrow mt-3 block" htmlFor="acct-name">
                  Name <span className="font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="acct-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="What should we call you?"
                  className="mt-1 w-full rounded border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 text-[14px] text-[var(--ink)]"
                />
                <button type="submit" className="btn btn-primary mt-3 w-full" disabled={!looksLikeEmail(draftEmail)}>
                  Continue
                </button>
                {switching && (
                  <button type="button" onClick={() => setSwitching(false)} className="mt-2 w-full text-[12px] text-[var(--ink-3)] hover:underline">
                    Cancel
                  </button>
                )}
              </form>
            )}

            {reader && !switching && (
              <>
                {state && state.since.length > 0 && (
                  <div className="panel panel-body mt-5">
                    <p className="eyebrow">Since you were last here</p>
                    <ul className="mt-2 space-y-1.5">
                      {state.since.slice(0, 6).map((d) => (
                        <li key={d.id} className="text-[12.5px] leading-snug">
                          <Link href={`/documents/${d.id}`} className="text-[var(--link)] hover:underline">
                            {d.title.length > 90 ? `${d.title.slice(0, 90)}…` : d.title}
                          </Link>
                          {d.about && <span className="num ml-1 text-[var(--ink-4)]">· {d.about}</span>}
                        </li>
                      ))}
                    </ul>
                    {state.since.length > 6 && (
                      <p className="mt-2 text-[12px] text-[var(--ink-3)]">and {state.since.length - 6} more</p>
                    )}
                  </div>
                )}

                <div className="mt-5 space-y-1.5 border-t border-[var(--rule)] pt-4">
                  {([
                    ["Following", state?.watching ?? 0, "/you"],
                    ["Bookmarks", state?.bookmarks ?? 0, "/you#bookmarks"],
                    ["Notes", state?.notes ?? 0, "/you#notes"],
                    ["Saved searches", state?.searches ?? 0, "/you#searches"],
                  ] as const).map(([label, n, href]) => (
                    <Link
                      key={label}
                      href={href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between text-[13.5px] text-[var(--ink)] hover:underline"
                    >
                      <span>{label}</span>
                      <span className="num text-[var(--ink-3)]">{n}</span>
                    </Link>
                  ))}
                </div>

                <div className="mt-4 border-t border-[var(--rule)] pt-4">
                  <label className="eyebrow block" htmlFor="acct-name2">
                    Your name
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      id="acct-name2"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-1.5 text-[13.5px] text-[var(--ink)]"
                    />
                    <button type="button" onClick={saveName} disabled={busy} className="btn shrink-0">
                      Save
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-[var(--rule)] pt-4">
                  <label className="flex items-start gap-2.5 text-[13.5px] text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={!!state?.alertsOn}
                      onChange={(e) => setAlerts(e.currentTarget.checked)}
                      disabled={busy || !state}
                      className="mt-0.5"
                    />
                    <span>
                      Email me when something lands
                      <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ink-3)]">
                        {state?.alertsOn && !state?.alertsConfirmed
                          ? "We will send one note to confirm the address before anything else — nothing is sent until you click it."
                          : "One message when a notification touches something you follow. Never more than one a day."}
                      </span>
                    </span>
                  </label>

                  {/* The daily/weekly pair used to sit here. Removed in 0017: one cadence, so a choice
                      between it and nothing is a control that cannot be wrong, which is a control worth
                      not drawing. The copy above already says at most one a day. */}
                </div>

                {seen.length > 0 && (
                  <div className="mt-4 border-t border-[var(--rule)] pt-4">
                    <p className="eyebrow">Recently viewed</p>
                    <ul className="mt-2 space-y-1">
                      {seen.slice(0, 6).map((s) => (
                        <li key={s.href} className="truncate text-[12.5px]">
                          <Link href={s.href} onClick={() => setOpen(false)} className="text-[var(--link)] hover:underline">
                            {s.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        clearSeen();
                        setSeen([]);
                      }}
                      className="mt-2 text-[12px] text-[var(--ink-3)] hover:underline"
                    >
                      Clear this list
                    </button>
                  </div>
                )}

                <div className="mt-auto space-y-2 border-t border-[var(--rule)] pt-4 text-[12.5px]">
                  <button type="button" onClick={exportData} disabled={busy} className="block text-[var(--ink-2)] hover:underline">
                    Export everything as a spreadsheet
                  </button>
                  <button type="button" onClick={() => { setSwitching(true); setDraftEmail(""); }} className="block text-[var(--ink-2)] hover:underline">
                    Use a different email
                  </button>
                  <button type="button" onClick={forget} disabled={busy} className="block text-[var(--bad)] hover:underline">
                    Delete my account and everything in it
                  </button>
                  <p className="pt-1 text-[11.5px] leading-snug text-[var(--ink-4)]">
                    What this stores, and for how long, is set out in the{" "}
                    <Link href="/privacy" onClick={() => setOpen(false)} className="text-[var(--link)] hover:underline">
                      privacy notice
                    </Link>
                    .
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
