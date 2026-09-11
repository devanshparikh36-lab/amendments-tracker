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

from amendments import db, pipeline
from amendments.instruments import PHASE1_INSTRUMENTS


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
        print(pipeline.run_discovery(args.adapter, since_year=args.since_year))
        return 0

    if args.cmd == "work":
        requeued = pipeline.requeue_stale_jobs()
        if requeued:
            print(f"requeued {requeued} stale jobs")
        print("processed", pipeline.process_jobs(limit=args.limit, adapters=args.adapter, exclude_adapters=args.not_adapter))
        return 0

    if args.cmd == "digest":
        print("sent" if pipeline.send_daily_digest() else "not sent (check RESEND_API_KEY / DIGEST_TO)")
        return 0

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
        print(pipeline.run_discovery())
        print("processed", pipeline.process_jobs(limit=args.limit))
        try:
            from amendments.storage import usage

            for u in usage.check():
                print(u.human())
        except Exception as exc:
            logging.warning("storage check failed: %s", exc)
        return 0

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
