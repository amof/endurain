"""Application-layer orchestration for activity streams.

Sits between the thin route and :mod:`crud`, matching the layering the activities
core uses, and owns the access decision so ``crud`` is left with nothing but
persistence.

Streams mask differently from the other child resources: there is no single
``hide_streams`` flag, because each stream *type* is gated by its own parent flag
(``hide_hr``, ``hide_power``, ``hide_cadence``, ...). So instead of the boolean
gate the siblings use, this module resolves the parent activity through
:mod:`modules.activities.activity.child_access_service` and decides per stream
itself: an activity can hide its heart rate while still publishing its route.

They are also the one child resource whose page is not cut in SQL, deliberately.
Laps, sets and workout steps have no domain ceiling on their row count, so a read
of "all of them" is unbounded work that has to be bounded by a ``LIMIT``. A stream
row count is bounded by the closed ``stream_type`` enum (one row per type,
validated on the way in), and the per-type mask is applied *after* the read, so a
SQL window would page rows the caller may not see. They are therefore read whole,
masked, and then cut in Python — the same
:class:`~core.pagination.Page` envelope the siblings answer with, so a client has
one list contract rather than one per child resource, over a total that already
reflects the mask. What is large here is ``stream_waypoints`` — the samples inside
one row — which page numbers cannot bound; reducing that is a downsampling
question, not a pagination one, and is deliberately left alone rather than
answered with a control that looks like a fix without being one.
"""

import uuid

from sqlalchemy.orm import Session

import core.exceptions as core_exceptions
import core.logger as core_logger
import core.pagination as core_pagination
import modules.activities.activity.constants as activity_constants
import modules.activities.activity.integration_service as activity_integration
import modules.activities.activity.schema as activity_schema
import modules.activities.activity_streams.constants as activity_streams_constants
import modules.activities.activity_streams.crud as activity_streams_crud
import modules.activities.activity_streams.hr_zones as activity_streams_hr_zones
import modules.activities.activity_streams.schema as activity_streams_schema
import modules.users.users.integration_service as users_integration

logger = core_logger.get_logger(__name__)

#: Map streams read per backfill batch. Far below the maintenance batch size: each row carries every GPS sample of
#: its activity, so one batch holds up to a few million samples in memory.
TRACK_OVERVIEW_BACKFILL_BATCH_SIZE = 50

#: The parent ``hide_*`` flag that withholds each stored stream type from a non-owner, or ``None`` for a
#: type no flag covers. A type missing here is withheld, so a new stream type stays owner-only until it is
#: given a rule.
_STREAM_HIDE_MAP: dict[int, str | None] = {
    activity_streams_constants.STREAM_TYPE_HR: "hide_hr",
    activity_streams_constants.STREAM_TYPE_POWER: "hide_power",
    activity_streams_constants.STREAM_TYPE_CADENCE: "hide_cadence",
    activity_streams_constants.STREAM_TYPE_ELEVATION: "hide_elevation",
    activity_streams_constants.STREAM_TYPE_SPEED: "hide_speed",
    activity_streams_constants.STREAM_TYPE_PACE: "hide_pace",
    activity_streams_constants.STREAM_TYPE_MAP: "hide_map",
    # Ambient temperature is none of the data a flag covers; its sample times follow hide_start_time.
    activity_streams_constants.STREAM_TYPE_TEMPERATURE: None,
}


def _is_stream_hidden(activity: activity_schema.ActivityRead, stream_type: int) -> bool:
    """Return whether the activity hides a stream type from other viewers.

    Args:
        activity: The parent activity.
        stream_type: The stream type code.

    Returns:
        True when the parent's hide flag for this stream type is set, or when the type has no rule.
    """
    if stream_type not in _STREAM_HIDE_MAP:
        return True
    attr = _STREAM_HIDE_MAP[stream_type]
    return attr is not None and bool(getattr(activity, attr))


def _filter_visible_streams(
    streams: list[activity_streams_schema.ActivityStreamsRead],
    activity: activity_schema.ActivityRead,
) -> list[activity_streams_schema.ActivityStreamsRead]:
    """Drop the streams the activity hides from other viewers.

    Args:
        streams: The activity's streams, as read schemas.
        activity: The parent activity.

    Returns:
        The streams that are not hidden.
    """
    return [stream for stream in streams if not _is_stream_hidden(activity, stream.stream_type)]


def _without_sample_times(
    streams: list[activity_streams_schema.ActivityStreamsRead],
    activity: activity_schema.ActivityRead,
) -> list[activity_streams_schema.ActivityStreamsRead]:
    """Drop each sample's absolute ``time`` when the activity hides its start from other viewers.

    The first sample's instant is the start, so ``hide_start_time`` covers every sample's.

    Args:
        streams: The streams a non-owner is about to be served.
        activity: The parent activity.

    Returns:
        The streams, their waypoints without ``time`` when the start is hidden.
    """
    if not activity.hide_start_time:
        return streams
    return [
        stream.model_copy(
            update={
                "stream_waypoints": [
                    {key: value for key, value in waypoint.items() if key != "time"}
                    for waypoint in stream.stream_waypoints
                ]
            }
        )
        for stream in streams
    ]


def _page_of(
    streams: list[activity_streams_schema.ActivityStreamsRead],
    page_number: int,
    num_records: int,
) -> activity_streams_schema.ActivityStreamsPage:
    """Cut an already-masked stream list into the shared page envelope.

    Args:
        streams: The streams the caller may see, in read order.
        page_number: 1-based page number.
        num_records: Page size.

    Returns:
        The page envelope, whose ``total`` counts only the visible streams.
    """
    start = (page_number - 1) * num_records
    return activity_streams_schema.ActivityStreamsPage.build(
        streams[start : start + num_records],
        len(streams),
        page_number,
        num_records,
    )


def _max_heart_rate_of(user_id: uuid.UUID, db: Session) -> int | None:
    """Resolve a user's max heart rate, or ``None`` when it cannot be derived.

    Args:
        user_id: ID of the stream's owner.
        db: Database session.

    Returns:
        The max heart rate, or None when it cannot be derived.
    """
    user = users_integration.get_user(user_id, db)
    if user is None:
        return None
    return activity_streams_hr_zones.resolve_max_heart_rate(user.max_heart_rate, user.birthdate, user.timezone)


def _with_zones(
    streams: list[activity_streams_schema.ActivityStreamsRead],
    activity: activity_schema.ActivityRead,
    db: Session,
) -> list[activity_streams_schema.ActivityStreamsRead]:
    """Attach the heart-rate zone breakdown to the HR streams being served.

    Zones are a function of the samples, the activity's timer time and the
    owner's *current* max heart rate (which itself follows their age), so they are
    computed here, per read, rather than stored: a stored value is stale the
    moment the owner edits their profile or has a birthday, and keeping it
    fresh costs a pass over every stream the user owns. The pass over one
    stream's samples is cheap next to serializing them.

    Only streams the caller may see reach this, and the owner is looked up once,
    only when one of them is an HR stream.

    Args:
        streams: The streams about to be served, already masked.
        activity: The parent activity, for its owner and timer time.
        db: Database session.

    Returns:
        The streams, the HR one carrying ``zone_percentages`` when the owner's
        max heart rate is known and the stream has samples.
    """
    if not any(stream.stream_type == activity_streams_constants.STREAM_TYPE_HR for stream in streams):
        return streams
    if activity.user_id is None:
        return streams
    max_heart_rate = _max_heart_rate_of(activity.user_id, db)
    if not max_heart_rate:
        return streams

    with_zones: list[activity_streams_schema.ActivityStreamsRead] = []
    for stream in streams:
        if stream.stream_type == activity_streams_constants.STREAM_TYPE_HR:
            breakdown = activity_streams_hr_zones.compute_hr_zone_breakdown_sync(
                stream.stream_waypoints,
                max_heart_rate,
                activity.total_timer_time,
            )
            if breakdown:
                stream = stream.model_copy(
                    update={"zone_percentages": activity_streams_schema.ActivityStreamZones(hr=breakdown)}
                )
        with_zones.append(stream)
    return with_zones


def list_activity_streams(
    activity_id: uuid.UUID,
    requester_user_id: uuid.UUID,
    db: Session,
    *,
    page_number: int = 1,
    num_records: int = core_pagination.DEFAULT_CHILD_NUM_RECORDS,
) -> activity_streams_schema.ActivityStreamsPage:
    """Return an activity's streams for an authenticated caller, masked per type.

    Args:
        activity_id: The parent activity.
        requester_user_id: The authenticated caller.
        db: Database session.
        page_number: 1-based page number.
        num_records: Page size.

    Returns:
        The page envelope. An empty page when the activity is not visible to the
        caller or has none.
    """
    activity = activity_integration.resolve_readable_parent(activity_id, requester_user_id, db)
    if activity is None:
        logger.debug(
            "Refused a streams read; answering with an empty page",
            extra=core_logger.context(activity_id=str(activity_id), requester_user_id=requester_user_id),
        )
        return _page_of([], page_number, num_records)

    streams = activity_streams_crud.get_activity_streams(activity_id, db)
    if requester_user_id != activity.user_id:
        streams = _without_sample_times(_filter_visible_streams(streams, activity), activity)

    return _page_of(_with_zones(streams, activity, db), page_number, num_records)


def get_activity_stream(
    activity_id: uuid.UUID,
    stream_type: int,
    requester_user_id: uuid.UUID,
    db: Session,
) -> activity_streams_schema.ActivityStreamsRead:
    """Return one stream type of an activity for an authenticated caller.

    Args:
        activity_id: The parent activity.
        stream_type: The stream type code.
        requester_user_id: The authenticated caller.
        db: Database session.

    Returns:
        The stream.

    Raises:
        NotFoundError: When the activity is not visible, has no such
        stream, or the stream is hidden from this caller — indistinguishable on purpose, so the
            endpoint cannot be used to probe which activities exist.
    """
    activity = activity_integration.resolve_readable_parent(activity_id, requester_user_id, db)
    if activity is None:
        raise core_exceptions.NotFoundError("Activity stream not found")

    stream = activity_streams_crud.get_activity_stream_by_type(activity_id, stream_type, db)
    if stream is None:
        raise core_exceptions.NotFoundError("Activity stream not found")

    if requester_user_id != activity.user_id:
        if _is_stream_hidden(activity, stream.stream_type):
            raise core_exceptions.NotFoundError("Activity stream not found")
        [stream] = _without_sample_times([stream], activity)

    return _with_zones([stream], activity, db)[0]


def list_public_activity_streams(
    activity_id: uuid.UUID,
    db: Session,
    *,
    page_number: int = 1,
    num_records: int = core_pagination.DEFAULT_CHILD_NUM_RECORDS,
) -> activity_streams_schema.ActivityStreamsPage:
    """Return a publicly shared activity's streams, masked per type.

    Args:
        activity_id: The parent activity.
        db: Database session.
        page_number: 1-based page number.
        num_records: Page size.

    Returns:
        The page envelope, empty when the activity is not publicly shareable.
    """
    activity = activity_integration.resolve_public_parent(activity_id, db)
    if activity is None:
        logger.debug(
            "Refused a public streams read; answering with an empty page",
            extra=core_logger.context(activity_id=str(activity_id)),
        )
        return _page_of([], page_number, num_records)

    streams = activity_streams_crud.get_activity_streams(activity_id, db)
    return _page_of(
        _with_zones(_without_sample_times(_filter_visible_streams(streams, activity), activity), activity, db),
        page_number,
        num_records,
    )


def get_public_activity_stream(
    activity_id: uuid.UUID,
    stream_type: int,
    db: Session,
) -> activity_streams_schema.ActivityStreamsRead:
    """Return one stream type of a publicly shared activity.

    Args:
        activity_id: The parent activity.
        stream_type: The stream type code.
        db: Database session.

    Returns:
        The stream.

    Raises:
        NotFoundError: When the activity is not publicly shareable, has
        no such stream, or the stream is hidden — indistinguishable on purpose, so the
            endpoint cannot be used to probe which activities exist.
    """
    activity = activity_integration.resolve_public_parent(activity_id, db)
    if activity is None:
        raise core_exceptions.NotFoundError("Activity stream not found")

    stream = activity_streams_crud.get_activity_stream_by_type(activity_id, stream_type, db)
    if stream is None:
        raise core_exceptions.NotFoundError("Activity stream not found")

    if _is_stream_hidden(activity, stream.stream_type):
        raise core_exceptions.NotFoundError("Activity stream not found")

    return _with_zones(_without_sample_times([stream], activity), activity, db)[0]


def list_track_overviews(
    user_id: uuid.UUID,
    db: Session,
    *,
    cursor: str | None,
    num_records: int,
) -> activity_streams_schema.TrackOverviewPage:
    """Return one keyset slice of the caller's own simplified tracks, newest first, for the global map.

    The owner reads their own activities, so no visibility mask applies. Hidden and virtual activities have no track
    on the map, and neither has an activity without a GPS stream. A slice covers ``num_records`` activities, and one
    without a track has no item, so a slice can hold fewer tracks than that, even none, and still name a next one.

    Args:
        user_id: The caller, whose activities are read.
        db: Database session.
        cursor: Opaque cursor from the previous slice, or ``None`` to start.
        num_records: Slice size, in activities.

    Returns:
        The slice of tracks and the cursor for the next one.

    Raises:
        InvalidInputError: When the cursor is not one this server issued.
    """
    after = core_pagination.decode_uuid_cursor(cursor) if cursor else None
    # Over-fetch by one: the extra reference proves another slice exists without a second query, and its track is
    # not looked up.
    refs = activity_integration.list_track_refs_after(user_id, after, num_records + 1, db)
    has_more = len(refs) > num_records
    refs = refs[:num_records]
    tracks = {
        overview.activity_id: overview.track
        for overview in activity_streams_crud.get_track_overviews([ref.id for ref in refs], db)
    }
    items = [
        activity_streams_schema.TrackOverviewRead(
            activity_id=ref.id,
            activity_type=activity_constants.ActivityType.from_stored(ref.activity_type),
            started_at=ref.start_time,
            ended_at=ref.end_time,
            start_date=ref.start_date,
            end_date=ref.end_date,
            track=track,
        )
        for ref in refs
        if (track := tracks.get(ref.id)) is not None
    ]
    next_cursor = core_pagination.encode_cursor(refs[-1].start_time, refs[-1].id) if has_more else None
    return activity_streams_schema.TrackOverviewPage(items=items, num_records=num_records, next_cursor=next_cursor)


def fill_missing_track_overviews(db: Session) -> None:
    """Compute the track overview of every map stream that has none yet, one committed batch at a time.

    Streams written since the overview exists get it when they are created; this pass fills the ones stored before.
    Every stream of a batch gets an overview, the empty one when it has no line to draw, so the next batch starts
    after it.

    Args:
        db: Database session.
    """
    filled = 0
    while batch := activity_streams_crud.get_map_streams_without_overview(db, limit=TRACK_OVERVIEW_BACKFILL_BATCH_SIZE):
        activity_streams_crud.set_track_overviews(batch, db)
        db.commit()
        filled += len(batch)
    if filled:
        logger.info("Filled missing track overviews", extra=core_logger.context(count=filled))
