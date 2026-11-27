"""Scheduled work owned by the activity-streams package."""

import core.database as core_database
import core.scheduler as core_scheduler
import modules.activities.activity_streams.service as activity_streams_service

TRACK_OVERVIEW_BACKFILL_LOCK_NAME = "track_overview_backfill"


def fill_missing_track_overviews() -> None:
    """Compute the track overviews the map streams stored before them still lack.

    Scheduler-invoked, with no request to carry a session, so this entry point opens it.
    """
    with core_database.SessionLocal() as db:
        activity_streams_service.fill_missing_track_overviews(db)


def recurring_jobs() -> tuple[core_scheduler.ScheduledJob, ...]:
    """Return the activity-streams reconciliation jobs.

    Returns:
        The jobs to schedule.
    """
    return (
        core_scheduler.ScheduledJob(
            fill_missing_track_overviews,
            60,
            "compute track overviews for map streams missing one",
            lock_name=TRACK_OVERVIEW_BACKFILL_LOCK_NAME,
        ),
    )


def schedule_missing_track_overviews() -> None:
    """Queue one track overview backfill pass, so the global map fills soon after an upgrade."""
    core_scheduler.run_once(
        fill_missing_track_overviews,
        job_id="endurain_fill_missing_track_overviews_oneshot",
        description="missing track overview computation",
        lock_name=TRACK_OVERVIEW_BACKFILL_LOCK_NAME,
    )
