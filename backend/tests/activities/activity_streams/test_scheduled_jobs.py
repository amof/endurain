"""Tests for the activity-streams scheduled jobs."""

from unittest.mock import MagicMock, patch

import modules.activities.activity_streams.scheduled_jobs as scheduled_jobs

MODULE = "modules.activities.activity_streams.scheduled_jobs"


class TestFillMissingTrackOverviews:
    @patch(f"{MODULE}.activity_streams_service")
    @patch(f"{MODULE}.core_database.SessionLocal")
    def test_fills_them_in_a_session_of_its_own(self, mock_session, mock_service):
        db = MagicMock()
        mock_session.return_value.__enter__.return_value = db

        scheduled_jobs.fill_missing_track_overviews()

        mock_service.fill_missing_track_overviews.assert_called_once_with(db)


class TestScheduling:
    def test_the_backfill_recurs_hourly_under_its_lock(self):
        (job,) = scheduled_jobs.recurring_jobs()

        assert (job.func, job.minutes, job.lock_name) == (
            scheduled_jobs.fill_missing_track_overviews,
            60,
            scheduled_jobs.TRACK_OVERVIEW_BACKFILL_LOCK_NAME,
        )

    @patch(f"{MODULE}.core_scheduler.run_once")
    def test_startup_queues_one_pass_under_the_same_lock(self, mock_run_once):
        scheduled_jobs.schedule_missing_track_overviews()

        mock_run_once.assert_called_once_with(
            scheduled_jobs.fill_missing_track_overviews,
            job_id="endurain_fill_missing_track_overviews_oneshot",
            description="missing track overview computation",
            lock_name=scheduled_jobs.TRACK_OVERVIEW_BACKFILL_LOCK_NAME,
        )
