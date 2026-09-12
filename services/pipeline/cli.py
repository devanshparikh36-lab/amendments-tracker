"""Command line entry point for the worker.

  python cli.py migrate                      apply SQL migrations
  python cli.py seed [slug ...]              seed / self-check instruments from the regulator's consolidated text
  python cli.py discover [--since-year Y]    list documents on every adapter and queue new ones
  python cli.py work [--limit N]             process queued jobs (fetch, tag, merge, selfcheck)
  python cli.py digest                       send the daily email digest
  python cli.py compact [--apply]            reclaim database space held by duplicated or never-read text
  python cli.py run                          discover + work (what the Railway cron runs)
  python cli.py backfill --since-year 2000   discover archive years then work through everything
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone

from amendments import db, pipeline
from amendments.instruments import PHASE1_INSTRUMENTS


def _exit_code_for_failed_adapters(started: datetime) -> int:
    """Non-zero if any adapter failed, so the workflow goes red and GitHub emails someone."""
    failed = pipeline.adapters_failed_since(started)
    if not failed:
        return 0
    print(f"FAILED adapters: {', '.join(failed)}")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="amendments")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("migrate")
    p_seed = sub.add_parser("seed")
    p_seed.add_argument("slugs", nargs="*")
    p_disc = sub.add_parser("discover")
    p_disc.add_argument("--adapter", action="append")
    p_disc.add_argument("--since-year", type=int)
    p_work = sub.add_parser("work")
    p_work.add_argument("--limit", type=int, default=500)
    p_work.add_argument("--adapter", action="append", help="only documents from this source (repeatable)")
    p_work.add_argument("--not-adapter", action="append", help="skip documents from this source (repeatable)")
    sub.add_parser("digest")
    sub.add_parser("retag", help="re-queue tagging for documents skipped while AI was disabled")
    sub.add_parser("prune", help="delete stored documents issued before MIN_DOCUMENT_YEAR (keeps base regulation texts)")
    p_mp = sub.add_parser("mergepreview", help="report what an AI-free deterministic merge would change (writes nothing)")
    p_mp.add_argument("--limit", type=int, default=500)
    p_mp.add_argument("--show", type=int, default=10, help="how many proposed substitutions to print")
    p_ocr = sub.add_parser("ocr", help="read scanned PDFs that carry no text layer, within a time budget")
    p_ocr.add_argument("--minutes", type=float, default=20.0, help="wall-clock budget for this pass")
    p_refetch = sub.add_parser("refetch", help="queue a re-fetch for documents whose attachment file is missing")
    p_refetch.add_argument("--limit", type=int, default=2000)
    p_pages = sub.add_parser("pageindex", help="write per-page text for stored PDFs to object storage, for in-PDF search")
    p_pages.add_argument("--limit", type=int, default=500, help="attachments to process this pass")
    p_retain = sub.add_parser("retain", help="drop the oldest ordinary documents per instrument, once storage is tight")
    p_retain.add_argument("--apply", action="store_true", help="actually delete; without this the command only reports")
    p_retain.add_argument("--force", action="store_true", help="evaluate the rule even below the trigger, to see what it would do")
    p_compact = sub.add_parser("compact", help="reclaim database space held by duplicated or never-read text")
    p_compact.add_argument("--apply", action="store_true", help="actually clear it; without this the command only reports")
    p_compact.add_argument("--full", action="store_true",
                           help="also rewrite the tables so the space returns to the file (locks them; never during a run)")
    sub.add_parser("storage", help="report R2 and database usage against the free limits, warning if either is filling up")
    sub.add_parser("sectionmap", help="load CBDT's official Income-tax Act 1961 <-> 2025 provision mapping")
    p_run = sub.add_parser("run")
    p_run.add_argument("--limit", type=int, default=500)
    p_back = sub.add_parser("backfill")
    p_back.add_argument("--since-year", type=int, required=True)
    p_back.add_argument("--limit", type=int, default=5000)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.cmd == "migrate":
        applied = db.migrate()
        print("applied:", applied or "nothing new")
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
        return 0

    if args.cmd == "seed":
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
        slugs = args.slugs or [i["slug"] for i in PHASE1_INSTRUMENTS]
        rc = 0
        for slug in slugs:
            try:
                print(slug, pipeline.seed_or_selfcheck_instrument(slug))
            except Exception as exc:
                logging.exception("seed failed for %s", slug)
                print(slug, "FAILED", exc)
                rc = 1
        return rc

    if args.cmd == "discover":
        started = datetime.now(timezone.utc)
        print(pipeline.run_discovery(args.adapter, since_year=args.since_year))
        return _exit_code_for_failed_adapters(started)

    if args.cmd == "work":
        requeued = pipeline.requeue_stale_jobs()
        if requeued:
            print(f"requeued {requeued} stale jobs")
        print("processed", pipeline.process_jobs(limit=args.limit, adapters=args.adapter, exclude_adapters=args.not_adapter))
        return 0

    if args.cmd == "digest":
        sent = pipeline.send_daily_digest()
        print("sent" if sent else "NOT SENT - set RESEND_API_KEY and DIGEST_TO")
        # Non-zero so the daily workflow goes red instead of passing while mailing nobody. It ran green for
        # days doing exactly that, which is the same silent failure the collectors had.
        return 0 if sent else 1

    if args.cmd == "sectionmap":
        print(pipeline.load_section_map())
        return 0

    if args.cmd == "storage":
        from amendments.storage import usage

        usages = usage.check()
        for u in usages:
            print(f"{u.human():55} {u.detail:22} [{u.level}]")
        # Exit non-zero when a limit is filling up, so the CI step fails and GitHub emails the repo owner.
        # That is the only alerting channel here that costs nothing and needs no secret configured.
        return 1 if any(u.level != "ok" for u in usages) else 0

    if args.cmd == "prune":
        print(pipeline.prune_before_cutoff())
        return 0

    if args.cmd == "mergepreview":
        r = pipeline.preview_mechanical_merges(limit=args.limit)
        c = r["counts"]
        print(f"considered {c['considered']} unapplied substitutions")
        print(f"  not mechanical (needs reading)      {c['not_mechanical']}")
        print(f"  provision has no stored text        {c['no_text']}")
        print(f"  old wording not found in provision  {c['not_found']}")
        print(f"  old wording appears more than once  {c['ambiguous']}")
        print(f"  APPLICABLE, unambiguous             {c['applicable']}")
        for a in r["applicable"][: args.show]:
            print(f"\n  {a['instrument']} {a['provision']}  (effect {a['effect_id']})")
            print(f"    replace : {a['old'][:90]}")
            print(f"    with    : {a['new'][:90]}")
            print(f"    context : …{a['context'][:120]}…")
        print("\nnothing was written; this command only reports")
        return 0

    if args.cmd == "ocr":
        r = pipeline.ocr_backlog(minutes=args.minutes)
        print(f"read {r['documents']} documents ({r['pages']} pages, {r['characters']:,} characters), "
              f"{r['failed']} failed")
        print(f"{r['remaining']} documents ({r['remaining_pages']} pages) still to read")
        return 0

    if args.cmd == "refetch":
        n = pipeline.requeue_missing_attachments(limit=args.limit)
        print(f"queued {n} documents for re-fetch; run 'work' to process")
        return 0

    if args.cmd == "pageindex":
        r = pipeline.index_attachment_pages(limit=args.limit)
        print(f"indexed {r['indexed']} PDFs ({r['pages']} pages), skipped {r['skipped']} non-PDFs, "
              f"re-queued {r['blocked']} that held an anti-bot page instead of a document")
        with db.transaction() as conn:
            left = db.fetch_one(
                conn,
                "SELECT count(*) AS n FROM attachment WHERE storage_key IS NOT NULL AND page_index_key IS NULL",
            )
        print(f"{left['n']} attachments still to index")
        return 0

    if args.cmd == "retain":
        r = pipeline.retain_documents(apply=args.apply, force=args.force)
        print(f"storage at {r['pressure'] * 100:.0f}%, retention triggers at {r['trigger'] * 100:.0f}%")
        if not r["armed"] and not args.force:
            print("idle - nothing deleted, and nothing will be until storage is tight")
            return 0
        print(f"deletable now: {r.get('candidates', 0)} documents"
              + (f" issued {r['oldest']} to {r['newest']}" if r.get("oldest") else ""))
        if r["applied"]:
            print(f"deleted {r['documents']} documents and {r['files']} files")
        else:
            print("dry run - pass --apply to delete")
        return 0

    if args.cmd == "compact":
        r = pipeline.compact_duplicated_text(apply=args.apply, full=args.full)
        mb = r["reclaimable_bytes"] / 1024**2
        dup, html = r["duplicate_attachment_text"], r["unread_raw_html"]
        print(f"attachment text duplicated on its document : {dup['rows']:>6} rows  {dup['bytes'] / 1024**2:8.1f} MB")
        print(f"raw_html that nothing ever reads           : {html['rows']:>6} rows  {html['bytes'] / 1024**2:8.1f} MB")
        print(f"{'cleared' if r['applied'] else 'reclaimable'}: {mb:.1f} MB")
        if r.get("rewritten"):
            print(f"rewrote: {', '.join(r['rewritten'])}")
        if r.get("database_bytes"):
            print(f"database now {r['database_bytes'] / 1024**2:.2f} MB")
        if not r["applied"]:
            print("dry run - pass --apply to clear it, --apply --full to also hand the space back")
        return 0

    if args.cmd == "retag":
        with db.transaction() as conn:
            rows = db.fetch_all(
                conn,
                "SELECT id FROM document WHERE tag_status IN ('skipped','failed') AND doc_type <> 'master_direction' ORDER BY id",
            )
            for r in rows:
                db.execute(conn, "UPDATE document SET tag_status = 'pending' WHERE id = %s", (r["id"],))
                pipeline.enqueue(conn, "tag_document", {"document_id": r["id"]})
        print(f"queued tagging for {len(rows)} documents; run 'work' to process")
        return 0

    if args.cmd == "run":
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
            pipeline.enqueue_unseeded_instruments(conn)
            stale = pipeline.enqueue_stale_instruments(conn)
            if stale:
                print(f"queued {stale} instruments for a re-read of the regulator's text")
        started = datetime.now(timezone.utc)
        print(pipeline.run_discovery())
        print("processed", pipeline.process_jobs(limit=args.limit))
        try:
            from amendments.storage import usage

            for u in usage.check():
                print(u.human())
        except Exception as exc:
            logging.warning("storage check failed: %s", exc)
        # Reported after the work step, so a broken adapter never costs us the fetching of everything else.
        return _exit_code_for_failed_adapters(started)

    if args.cmd == "backfill":
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
        print(pipeline.run_discovery(since_year=args.since_year))
        print("processed", pipeline.process_jobs(limit=args.limit))
        return 0
    return 2


if __name__ == "__main__":
    try:
        code = main()
    finally:
        # One Chromium is shared by every browser-backed adapter; shut it down before the process exits.
        from amendments.browser import close_all

        close_all()
    sys.exit(code)
