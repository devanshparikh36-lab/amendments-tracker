"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/* Add an address to the list, take one off, or stop mail to one.
 *
 * A client island inside an otherwise server-rendered page, because these are the only three things on
 * /admin that write. The admin key is handed down as a prop: the page already has it from its own query
 * string, and the alternative -- reading it back off window.location in here -- would put the same secret
 * in two places and let them disagree.
 *
 * Every action refreshes the server component rather than patching a local copy of the table. The table is
 * the source of truth about who is on this list, and a mailing list that disagrees with the screen it is
 * administered from is the kind of bug that is only discovered by the person who gets mail they should not.
 */

type Result = { tone: "ok" | "warn" | "bad"; text: string };

export function AdminReaders({ adminKey }: { adminKey: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run(action: "add" | "delete" | "alerts-off", address: string): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/readers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: adminKey, action, email: address }),
      });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        setResult({ tone: "bad", text: String(d.error || "that did not work") });
        return;
      }

      if (action === "add") {
        if (d.created) {
          setResult({ tone: "ok", text: `${address} added, alerts on.` });
          setEmail("");
        } else {
          /* Already present, and the message says what state it is in rather than "done". An address whose
           * owner switched alerts off is the case worth being loud about: adding it again did not, and
           * deliberately does not, override that. */
          setResult({
            tone: "warn",
            text: d.alertsOn
              ? `${address} was already on the list, with alerts on. Nothing changed.`
              : `${address} already has an account and has alerts switched OFF. Left as it is — adding does not override a reader's own choice.`,
          });
        }
      } else if (action === "delete") {
        setResult(
          d.deleted
            ? { tone: "ok", text: `${address} deleted, along with everything they had saved.` }
            : { tone: "warn", text: `${address} was not on the list.` },
        );
        setEmail("");
      } else {
        setResult(
          d.changed
            ? { tone: "ok", text: `Alerts stopped for ${address}.` }
            : { tone: "warn", text: `${address} was not on the list.` },
        );
      }
      router.refresh();
    } catch {
      setResult({ tone: "bad", text: "could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (address) void run("add", address);
  }

  function onDelete() {
    const address = email.trim().toLowerCase();
    if (!address) return;
    // A real confirmation, naming what else goes. This cascades and cannot be undone.
    if (
      !window.confirm(
        `Delete ${address}?\n\nThis removes the account and every follow, bookmark, note and saved search ` +
          `belonging to it. It cannot be undone.`,
      )
    ) {
      return;
    }
    void run("delete", address);
  }

  const tone =
    result?.tone === "bad"
      ? "text-[var(--bad)]"
      : result?.tone === "warn"
        ? "text-[var(--ink-2)]"
        : "text-[var(--good,var(--link))]";

  return (
    <section className="mt-6 panel panel-body">
      <h2 className="eyebrow">Add or remove an address</h2>
      <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-3)]">
        An address added here is marked <code className="num">admin</code> in the Source column, because
        nobody asked its owner. That distinction is kept on purpose — see the note under the table.
      </p>

      <form onSubmit={onAdd} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="name@example.com"
          autoComplete="off"
          spellCheck={false}
          className="field min-w-[16rem] flex-1"
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
          Add
        </button>
        <button
          type="button"
          onClick={() => void run("alerts-off", email.trim().toLowerCase())}
          className="btn"
          disabled={busy || !email.trim()}
        >
          Stop alerts
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="btn text-[var(--bad)]"
          disabled={busy || !email.trim()}
        >
          Delete
        </button>
      </form>

      {result && <p className={`mt-2 text-[12.5px] ${tone}`}>{result.text}</p>}
    </section>
  );
}
