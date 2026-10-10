"""The partial-collapse alarm.

Until this existed the only check was `found == 0`, so a listing that fell from hundreds to a handful was
recorded as a healthy run. The cases below are the ones that decide whether the alarm is useful or merely
noisy, and the noisy failure mode is the one to fear: an alarm that cries wolf gets ignored, which costs more
than having none.

`COLLAPSE_FRACTION` is 0.4 and `COLLAPSE_MIN_MEDIAN` is 10; the numbers here are written against those rather
than recomputed from them, so that changing either is a deliberate act that fails these tests.
"""
from __future__ import annotations

from amendments.pipeline import COLLAPSE_FRACTION, COLLAPSE_MIN_MEDIAN, collapse_reason

# Any day comfortably clear of the New Year window.
MID_YEAR = 200


def _reason(**kw):
    args = dict(found=0, median=100.0, samples=30, previous=0, day_of_year=MID_YEAR)
    args.update(kw)
    return collapse_reason(**args)


def test_a_cliff_over_two_runs_is_reported():
    """The case this exists for: 1,283 normally, 5 twice."""
    reason = _reason(found=5, median=1283.0, previous=5)
    assert reason is not None
    assert "listed 5 documents" in reason
    assert "5 on the run before" in reason
    assert "median of 1283" in reason


def test_a_single_bad_day_is_not_reported():
    """One dip is usually the source rate-limiting or timing out. Fails only if the next run agrees."""
    assert _reason(found=5, median=1283.0, previous=1283) is None


def test_a_normal_listing_is_not_reported():
    assert _reason(found=1283, median=1283.0, previous=1283) is None


def test_a_listing_just_above_the_floor_is_not_reported():
    """0.4 of 100 is 40, and 40 is not a collapse."""
    assert _reason(found=40, median=100.0, previous=40) is None
    assert _reason(found=39, median=100.0, previous=39) is not None


def test_small_listings_are_left_to_the_zero_check():
    """CBIC's daily GST run lists 5 of 5, correctly. Proportions mean nothing at that size."""
    assert _reason(found=1, median=5.0, previous=1) is None
    assert _reason(found=1, median=float(COLLAPSE_MIN_MEDIAN) - 1, previous=1) is None
    # At the threshold the rule starts applying.
    assert _reason(found=1, median=float(COLLAPSE_MIN_MEDIAN), previous=1) is not None


def test_a_new_adapter_has_no_normal_yet():
    """Three runs is not a baseline; a newly added adapter must not fail for lacking history."""
    assert _reason(found=1, median=100.0, samples=3, previous=1) is None
    assert _reason(found=1, median=100.0, samples=4, previous=1) is not None


def test_no_previous_run_is_not_a_collapse():
    assert _reason(found=1, median=100.0, previous=None) is None


def test_the_new_year_window_is_suppressed():
    """Adapters scoped to the current year legitimately list almost nothing in early January.

    A documented blind spot. On 1 January the median still describes December, so the comparison is between
    two different years and would fire on every such adapter.
    """
    assert _reason(found=1, median=100.0, previous=1, day_of_year=1) is None
    assert _reason(found=1, median=100.0, previous=1, day_of_year=30) is None
    # Day 31 is the first on which a 30-day window no longer reaches back into last year.
    assert _reason(found=1, median=100.0, previous=1, day_of_year=31) is not None


def test_the_window_tracks_the_days_argument():
    """Suppression is derived from the window length, not hard-coded to January."""
    assert _reason(found=1, median=100.0, previous=1, day_of_year=60, days=90) is None
    assert _reason(found=1, median=100.0, previous=1, day_of_year=91, days=90) is not None


def test_the_reason_names_what_to_go_and_look_at():
    """The message is the whole value of the alarm: it fires once a day until someone acts on it."""
    reason = _reason(found=5, median=1283.0, previous=5, samples=28)
    assert "28 successful runs" in reason
    assert f"under {COLLAPSE_FRACTION:.0%}" in reason
    assert "listing API" in reason
