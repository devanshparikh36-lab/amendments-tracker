"""Command line entry point for the worker.

  python cli.py migrate                      apply SQL migrations
  python cli.py seed [slug ...]              seed / self-check instruments from the regulator's consolidated text
  python cli.py discover [--since-year Y]    list documents on every adapter and queue new ones
  python cli.py work [--limit N]             process queued jobs (fetch, tag, merge, selfcheck)
  python cli.py digest                       send the daily email digest
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
    sub.add_parser("digest")
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
        print("processed", pipeline.process_jobs(limit=args.limit))
        return 0

    if args.cmd == "digest":
        print("sent" if pipeline.send_daily_digest() else "not sent (check RESEND_API_KEY / DIGEST_TO)")
        return 0

    if args.cmd == "run":
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
            pipeline.enqueue_unseeded_instruments(conn)
        print(pipeline.run_discovery())
        print("processed", pipeline.process_jobs(limit=args.limit))
        return 0

    if args.cmd == "backfill":
        with db.transaction() as conn:
            pipeline.ensure_instruments(conn)
        print(pipeline.run_discovery(since_year=args.since_year))
        print("processed", pipeline.process_jobs(limit=args.limit))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
