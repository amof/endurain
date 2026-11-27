"""Track overviews for the global map, against a real session.

The overview is computed when a map stream is written and backfilled for the streams stored before it; the list keeps
only the caller's own drawable tracks. Both are SQL filtering questions a mocked session cannot answer.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select, update
from tests._helpers.db import create_sqlite_session, create_sqlite_session_factory

import modules.activities.activity.constants as activity_constants
import modules.activities.activity.contracts as activity_contracts
import modules.activities.activity.crud as activity_crud
import modules.activities.activity.models as activity_models
import modules.activities.activity_streams.constants as activity_streams_constants
import modules.activities.activity_streams.contracts as activity_streams_contracts
import modules.activities.activity_streams.crud as activity_streams_crud
import modules.activities.activity_streams.models as activity_streams_models
import modules.activities.activity_streams.service as activity_streams_service

_OWNER = uuid.UUID(int=1)
_OTHER = uuid.UUID(int=2)
_PRIVACY_FLAGS = (
    "hide_start_time",
    "hide_location",
    "hide_map",
    "hide_hr",
    "hide_power",
    "hide_cadence",
    "hide_elevation",
    "hide_speed",
    "hide_pace",
    "hide_laps",
    "hide_workout_sets_steps",
    "hide_gear",
)
_TRACK = [{"lat": 45.0, "lon": 6.0, "time": "t"}, {"lat": 45.01, "lon": 6.01, "time": "t"}]
_ENCODED_TRACK = "_atqG_{rc@o}@o}@"


@pytest.fixture
def db():
    session = create_sqlite_session()
    yield session
    session.close()
    session.bind.dispose()


def _activity(db, *, user_id=_OWNER, activity_type=1, start="2026-07-28T09:00:00", end="2026-07-28T10:00:00", **extra):
    return activity_crud.create_activity(
        activity_contracts.ActivityCore(
            user_id=user_id,
            name="Run",
            distance=10000,
            activity_type=activity_type,
            start_time=start,
            end_time=end,
            timezone=extra.pop("timezone", "Europe/Paris"),
            total_elapsed_time=3600.0,
            total_timer_time=3600.0,
            visibility=2,
            **{flag: False for flag in _PRIVACY_FLAGS},
        ),
        db,
    )


def _streams(db, activity, *streams):
    activity_streams_crud.create_activity_streams(
        [
            activity_streams_contracts.ActivityStreamsCreate(
                activity_id=activity.id, stream_type=stream_type, stream_waypoints=waypoints
            )
            for stream_type, waypoints in streams
        ],
        activity,
        db,
    )


def _overview_of_type(db, activity_id, stream_type):
    return db.scalar(
        select(activity_streams_models.ActivityStreams.track_overview).where(
            activity_streams_models.ActivityStreams.activity_id == activity_id,
            activity_streams_models.ActivityStreams.stream_type == stream_type,
        )
    )


class TestOverviewIsStoredWithTheMapStream:
    def test_a_map_stream_gets_its_overview_and_other_streams_none(self, db):
        activity = _activity(db)
        _streams(db, activity, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK), (1, [{"hr": 140, "time": "t"}]))

        assert _overview_of_type(db, activity.id, activity_streams_constants.STREAM_TYPE_MAP) == _ENCODED_TRACK
        assert _overview_of_type(db, activity.id, 1) is None


def _walk(db, *, num_records):
    """Read every slice of the owner's tracks by following ``next_cursor``, as the global map does."""
    slices = []
    cursor = None
    while True:
        page = activity_streams_service.list_track_overviews(_OWNER, db, cursor=cursor, num_records=num_records)
        slices.append([item.activity_id for item in page.items])
        if page.next_cursor is None:
            return slices
        cursor = page.next_cursor


def _tracked_activities(db, *days):
    """Create one owner activity with a drawable track per day, from 09:00 to 10:00, and return their ids in order."""
    ids = []
    for day in days:
        activity = _activity(db, start=f"{day}T09:00:00", end=f"{day}T10:00:00")
        _streams(db, activity, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))
        ids.append(activity.id)
    return ids


class TestListTrackOverviews:
    def test_lists_only_the_callers_drawable_tracks_with_type_and_local_dates(self, db):
        # 23:30 UTC on 31 December is already 1 January in Paris.
        run = _activity(db, start="2025-12-31T23:30:00", end="2026-01-01T00:30:00")
        _streams(db, run, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))
        indoor = _activity(db, start="2026-07-01T09:00:00", end="2026-07-01T10:00:00")
        _streams(db, indoor, (1, [{"hr": 140, "time": "t"}]))
        single_point = _activity(db, start="2026-07-02T09:00:00", end="2026-07-02T10:00:00")
        _streams(db, single_point, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK[:1]))
        virtual = _activity(db, activity_type=7, start="2026-07-03T09:00:00", end="2026-07-03T10:00:00")
        _streams(db, virtual, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))
        hidden = _activity(db, start="2026-07-04T09:00:00", end="2026-07-04T10:00:00")
        _streams(db, hidden, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))
        db.execute(
            update(activity_models.Activity).where(activity_models.Activity.id == hidden.id).values(is_hidden=True)
        )
        foreign = _activity(db, user_id=_OTHER, start="2026-07-05T09:00:00", end="2026-07-05T10:00:00")
        _streams(db, foreign, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))

        page = activity_streams_service.list_track_overviews(_OWNER, db, cursor=None, num_records=25)

        assert page.next_cursor is None
        assert [
            (item.activity_id, item.activity_type, item.started_at, item.start_date, item.end_date)
            for item in page.items
        ] == [
            (
                run.id,
                activity_constants.ActivityType.RUN,
                datetime(2025, 12, 31, 23, 30, tzinfo=UTC),
                date(2026, 1, 1),
                date(2026, 1, 1),
            )
        ]

    def test_walks_every_track_once_newest_first(self, db):
        oldest, middle, newest = _tracked_activities(db, "2026-07-01", "2026-07-02", "2026-07-03")

        assert _walk(db, num_records=2) == [[newest, middle], [oldest]]

    def test_activities_that_start_together_are_each_listed_once(self, db):
        same_start = _tracked_activities(db, "2026-07-01", "2026-07-01", "2026-07-01")
        # A later activity at the same instant is stored hidden as a suspected duplicate; its owner shows it again.
        db.execute(update(activity_models.Activity).values(is_hidden=False))

        slices = _walk(db, num_records=1)

        assert sorted(activity_id for page in slices for activity_id in page) == sorted(same_start)

    def test_a_slice_without_tracks_still_leads_to_the_next(self, db):
        """A slice counts activities, so one of activities without GPS is empty and the walk goes on past it."""
        (newest,) = _tracked_activities(db, "2026-07-03")
        indoor = _activity(db, start="2026-07-02T09:00:00", end="2026-07-02T10:00:00")
        _streams(db, indoor, (1, [{"hr": 140, "time": "t"}]))
        (oldest,) = _tracked_activities(db, "2026-07-01")

        assert _walk(db, num_records=1) == [[newest], [], [oldest]]

    def test_a_track_filled_in_during_a_walk_is_not_listed_twice(self, db):
        """The backfill can fill a track between two slices; the cursor names a position, so nothing shifts."""
        (pending,) = _tracked_activities(db, "2026-07-03")
        db.execute(
            update(activity_streams_models.ActivityStreams)
            .where(activity_streams_models.ActivityStreams.activity_id == pending)
            .values(track_overview=None)
        )
        middle, oldest = _tracked_activities(db, "2026-07-02", "2026-07-01")

        first = activity_streams_service.list_track_overviews(_OWNER, db, cursor=None, num_records=2)
        activity_streams_service.fill_missing_track_overviews(db)
        second = activity_streams_service.list_track_overviews(_OWNER, db, cursor=first.next_cursor, num_records=2)

        # Filled behind the cursor, the track shows on the next load of the map.
        assert [item.activity_id for item in first.items + second.items] == [middle, oldest]
        assert second.next_cursor is None

    def test_looks_up_the_tracks_of_one_slice_only(self, db, monkeypatch):
        _tracked_activities(db, "2026-07-01", "2026-07-02", "2026-07-03")
        read_overviews = activity_streams_crud.get_track_overviews
        requested: list[list[uuid.UUID]] = []

        def spy(activity_ids, session):
            requested.append(list(activity_ids))
            return read_overviews(activity_ids, session)

        monkeypatch.setattr(activity_streams_crud, "get_track_overviews", spy)

        page = activity_streams_service.list_track_overviews(_OWNER, db, cursor=None, num_records=2)

        assert requested == [[item.activity_id for item in page.items]]
        assert page.next_cursor is not None

    def test_a_user_without_activities_gets_an_empty_slice(self, db):
        page = activity_streams_service.list_track_overviews(_OWNER, db, cursor=None, num_records=25)

        assert (page.items, page.next_cursor) == ([], None)


@pytest.fixture
def session_factory():
    factory = create_sqlite_session_factory()
    yield factory
    factory.kw["bind"].dispose()


class TestFillMissingTrackOverviews:
    """The backfill commits each batch, so what it fills is read back through a session of its own."""

    def test_fills_the_map_streams_stored_before_the_overview(self, session_factory):
        with session_factory() as db:
            activity = _activity(db)
            _streams(
                db, activity, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK), (1, [{"hr": 140, "time": "t"}])
            )
            db.execute(update(activity_streams_models.ActivityStreams).values(track_overview=None))
            db.commit()

        with session_factory() as db:
            activity_streams_service.fill_missing_track_overviews(db)

        with session_factory() as db:
            assert _overview_of_type(db, activity.id, activity_streams_constants.STREAM_TYPE_MAP) == _ENCODED_TRACK
            assert _overview_of_type(db, activity.id, 1) is None

    def test_a_stream_without_a_readable_position_is_filled_with_no_line(self, session_factory, monkeypatch):
        with session_factory() as db:
            unreadable = _activity(db, start="2026-07-01T09:00:00", end="2026-07-01T10:00:00")
            # Stored before the overview existed, so no write path ever read its samples.
            db.add(
                activity_streams_models.ActivityStreams(
                    activity_id=unreadable.id,
                    stream_type=activity_streams_constants.STREAM_TYPE_MAP,
                    stream_waypoints=[{"lat": "north", "lon": 6.0}] * 2,
                )
            )
            good = _activity(db, start="2026-07-02T09:00:00", end="2026-07-02T10:00:00")
            _streams(db, good, (activity_streams_constants.STREAM_TYPE_MAP, _TRACK))
            db.execute(update(activity_streams_models.ActivityStreams).values(track_overview=None))
            db.commit()
        monkeypatch.setattr(activity_streams_service, "TRACK_OVERVIEW_BACKFILL_BATCH_SIZE", 1)

        with session_factory() as db:
            activity_streams_service.fill_missing_track_overviews(db)

        with session_factory() as db:
            assert _overview_of_type(db, unreadable.id, activity_streams_constants.STREAM_TYPE_MAP) == ""
            assert _overview_of_type(db, good.id, activity_streams_constants.STREAM_TYPE_MAP) == _ENCODED_TRACK
