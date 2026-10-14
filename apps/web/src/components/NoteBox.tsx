"use client";

import { useEffect, useRef, useState } from "react";
import { onReaderChange, readReader } from "@/lib/reader";
import { NoteIcon } from "@/components/icons";

/* A reader's own note against one provision.
 *
 * The warning under the textarea is not boilerplate and should not be softened. Every other thing a
 * reader stores here is a pointer at public law -- which sections interest them -- and the worst a leak
 * does is reveal an interest. A note is their own words, and the only thing guarding it is an email
 * address anyone can type. Telling them that where they are about to type is the only honest place for
 * it; a sentence in a privacy notice protects nobody.
 *
 * Collapsed until asked for. A reading page for a statutory provision should open as the provision, not
 * as a form -- the note is a thing a reader goes looking for, not a thing the page offers unprompted.
 */

const MAX = 2000;

export function NoteBox({ provisionId }: { provisionId: number }) {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = () => setEmail(readReader()?.email ?? null);
    load();
    return onReaderChange(load);
  }, []);

  // Fetched once the reader is known, whether or not the box is open: a note that exists should announce
  // itself on the button, otherwise it is invisible until someone happens to look.
  useEffect(() => {
    if (!email) {
      setSaved(null);
      setText("");
      setLoaded(true);
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/reader/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "get", email, provisionId }),
        });
        const d = res.ok ? await res.json() : null;
        if (!live) return;
        const body = d?.note?.body ?? "";
        setSaved(body || null);
        setText(body);
      } catch {
        /* leave it empty */
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [email, provisionId]);

  async function save() {
    if (!email) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reader/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", email, provisionId, body: text }),
      });
      if (res.ok) {
        const d = await res.json();
        setSaved(d?.note?.body ?? null);
        if (!d?.note) setOpen(false); // emptied is deleted
      }
    } catch {
      /* the button stays available to try again */
    } finally {
      setBusy(false);
    }
  }

  /* The button renders immediately and never waits for the fetch. Holding it back until the note had
     loaded meant it appeared a beat after the other glyphs and widened the cluster under the reader's
     cursor -- a layout shift on the one row of controls they were about to press. Only the filled state
     waits, which changes nothing about where anything sits. */
  const label = saved ? "Your note on this section" : "Keep a note against this section";

  /* The button is always rendered, open or shut. Swapping it out for the panel made the glyph vanish
     from the cluster the moment it was pressed -- the control a reader just used disappearing, and the
     four icons beside it sliding across to fill the gap. */
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!email) {
            document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
            return;
          }
          setOpen((v) => !v);
          setTimeout(() => area.current?.focus(), 0);
        }}
        className="icon-btn no-print"
        aria-pressed={open || (loaded && !!saved)}
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <NoteIcon filled={loaded && !!saved} />
      </button>

      {open && (
        /* Absolute, against the section header, and not simply full width. The button that opens this
           lives in a narrow cluster in the corner, so `w-full` would size the textarea to that cluster --
           a note box a few glyphs wide. Positioning against the header gives it the width of the
           section, and drops it directly beneath the heading it belongs to. */
        <div className="no-print absolute left-5 right-5 top-full z-20 mt-1 rounded border border-[var(--rule-strong)] bg-[var(--tint)] p-3 shadow-lg">
          <label className="eyebrow block" htmlFor={`note-${provisionId}`}>
            Your note on this section
          </label>
          <textarea
            id={`note-${provisionId}`}
            ref={area}
            value={text}
            maxLength={MAX}
            rows={4}
            onChange={(e) => setText(e.target.value)}
            className="mt-1.5 w-full resize-y rounded border border-[var(--rule-strong)] bg-[var(--paper)] p-2.5 text-[13.5px] leading-relaxed text-[var(--ink)]"
            placeholder="Why this section matters to you, what to check next time…"
          />
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-3)]">
            <strong className="text-[var(--bad)]">Anyone who knows your email address could read this.</strong>{" "}
            Signing in here takes an address and no password, so a note is private only in the sense that
            nobody has a reason to look. Keep client names and anything confidential out of it.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setText(saved ?? ""); setOpen(false); }} className="btn">
              Close
            </button>
            <span className="num ml-auto text-[11.5px] text-[var(--ink-4)]">
              {text.length}/{MAX}
            </span>
          </div>
          {saved && (
            <p className="mt-2 text-[11.5px] text-[var(--ink-4)]">
              Clearing the box and saving removes the note.
            </p>
          )}
        </div>
      )}
    </>
  );
}
