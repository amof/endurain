"""CRUD operations for activity stream data."""

import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

import core.logger as core_logger
import modules.activities.activity.schema as activity_schema
import modules.activities.activity_streams.constants as activity_streams_constants
import modules.activities.activity_streams.contracts as activity_streams_contracts
import modules.activities.activity_streams.models as activity_streams_models
import modules.activities.activity_streams.schema as activity_streams_schema
import modules.activities.activity_streams.serializers as activity_streams_serializers
import modules.activities.activity_streams.track_overview as activity_streams_track_overview

logger = core_logger.get_logger(__name__)


def get_activity_streams(
    activity_id: uuid.UUID,
    db: Session,
) -> list[activity_streams_schema.ActivityStreamsRead]:
    """Get every stream belonging to an activity.

    Performs no access check and no per-type masking: both are decided by
    :mod:`modules.activities.activity_streams.service`.

    Args:
        activity_id: The activity identifier.
        db: Database session.

    Returns:
        The activity's streams, empty when it has none.
    """
    stmt = select(activity_streams_models.ActivityStreams).where(
        activity_streams_models.ActivityStreams.activity_id == activity_id,
    )
    activity_streams: list[activity_streams_models.ActivityStreams] = list(db.scalars(stmt).all())

    return activity_streams_serializers.to_read_schemas(activity_streams)


def get_activities_streams(
    activity_ids: list[uuid.UUID],
    db: Session,
) -> list[activity_streams_schema.ActivityStreamsRead]:
    """Get streams for multiple activities.

    Performs no access check: which activities the caller may read is decided
    before this is reached, by the activities integration service that owns them.

    Args:
        activity_ids: The activities to read, already scoped to the caller.
        db: Database session.

    Returns:
        List of activity streams.
    """
    if not activity_ids:
        return []
    stmt = select(activity_streams_models.ActivityStreams).where(
        activity_streams_models.ActivityStreams.activity_id.in_(activity_ids)
    )
    all_streams: list[activity_streams_models.ActivityStreams] = list(db.scalars(stmt).all())

    if not all_streams:
        return []

    return activity_streams_serializers.to_read_schemas(all_streams)


def get_activity_stream_by_type(
    activity_id: uuid.UUID,
    stream_type: int,
    db: Session,
) -> activity_streams_schema.ActivityStreamsRead | None:
    """Get a specific stream type for an activity.

    Performs no access check and no masking: both are decided by
    :mod:`modules.activities.activity_streams.service`.

    Args:
        activity_id: The activity identifier.
        stream_type: The stream type constant.
        db: Database session.

    Returns:
        The activity stream, or ``None`` when the activity has no such stream.
    """
    stmt = select(activity_streams_models.ActivityStreams).where(
        activity_streams_models.ActivityStreams.activity_id == activity_id,
        activity_streams_models.ActivityStreams.stream_type == stream_type,
    )
    activity_stream: activity_streams_models.ActivityStreams | None = db.scalars(stmt).first()

    if not activity_stream:
        return None

    return activity_streams_serializers.to_read_schema(activity_stream)


def get_gps_stream_waypoints_for_activities(
    activity_ids: list[uuid.UUID],
    db: Session,
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """Return each activity's GPS (map) stream waypoints, keyed by activity id.

    Batch helper for the reverse-geocoding backfill: it fetches only the
    ``STREAM_TYPE_MAP`` waypoints for the given activities in one query and keeps
    the ORM confined to this module (returning plain lists, not ORM rows).
    Activities without a GPS stream are simply absent from the result.

    Args:
        activity_ids: Activity ids to fetch GPS waypoints for.
        db: Database session.

    Returns:
        Mapping of ``activity_id -> waypoints`` (empty when ``activity_ids`` is
        empty).
    """
    if not activity_ids:
        return {}
    stmt = select(
        activity_streams_models.ActivityStreams.activity_id,
        activity_streams_models.ActivityStreams.stream_waypoints,
    ).where(
        activity_streams_models.ActivityStreams.activity_id.in_(activity_ids),
        activity_streams_models.ActivityStreams.stream_type == activity_streams_constants.STREAM_TYPE_MAP,
    )
    return {activity_id: (waypoints or []) for activity_id, waypoints in db.execute(stmt).all()}


def create_activity_streams(
    activity_streams: list[activity_streams_contracts.ActivityStreamsCreate],
    activity: activity_schema.ActivityRead,
    db: Session,
) -> None:
    """Stage activity streams (flushed, not committed).

    Args:
        activity_streams: List of stream schemas.
        activity: Activity schema to associate streams with.
        db: Database session.
    """
    if activity.user_id is None:
        logger.warning(
            "Failed to create activity streams: activity has no user_id",
            extra=core_logger.context(activity_id=str(activity.id)),
        )
        return

    streams = [
        activity_streams_models.ActivityStreams(
            activity_id=stream.activity_id,
            stream_type=stream.stream_type,
            stream_waypoints=stream.stream_waypoints,
            strava_activity_stream_id=stream.strava_activity_stream_id,
            track_overview=(
                activity_streams_track_overview.overview_of(stream.stream_waypoints)
                if stream.stream_type == activity_streams_constants.STREAM_TYPE_MAP
                else None
            ),
        )
        for stream in activity_streams
    ]

    if streams:
        db.add_all(streams)
        db.flush()


def get_track_overviews(activity_ids: list[uuid.UUID], db: Session) -> list[activity_streams_contracts.TrackOverview]:
    """Return the drawable track overviews of the given activities.

    Performs no access check: which activities the caller may read is decided before this is reached. A map stream
    whose overview is not computed yet, or has no line to draw, is left out.

    Args:
        activity_ids: The activities to read, one slice already scoped to the caller.
        db: Database session.

    Returns:
        One overview per activity that has one, in no particular order.
    """
    if not activity_ids:
        return []
    stream = activity_streams_models.ActivityStreams
    stmt = select(stream.activity_id, stream.track_overview).where(
        stream.activity_id.in_(activity_ids),
        stream.stream_type == activity_streams_constants.STREAM_TYPE_MAP,
        stream.track_overview.is_not(None),
        stream.track_overview != "",
    )
    return [
        activity_streams_contracts.TrackOverview(activity_id=activity_id, track=track)
        for activity_id, track in db.execute(stmt).all()
        if track
    ]


def get_map_streams_without_overview(db: Session, *, limit: int) -> list[activity_streams_contracts.MapStreamSamples]:
    """Return a bounded batch of the map streams whose track overview is not computed yet, ordered by id.

    Args:
        db: Database session.
        limit: Maximum number of streams to return.

    Returns:
        The streams with their stored samples.
    """
    stream = activity_streams_models.ActivityStreams
    stmt = (
        select(stream.id, stream.stream_waypoints)
        .where(
            stream.stream_type == activity_streams_constants.STREAM_TYPE_MAP,
            stream.track_overview.is_(None),
        )
        .order_by(stream.id)
        .limit(limit)
    )
    return [
        activity_streams_contracts.MapStreamSamples(id=stream_id, stream_waypoints=waypoints or [])
        for stream_id, waypoints in db.execute(stmt).all()
    ]


def set_track_overviews(streams: list[activity_streams_contracts.MapStreamSamples], db: Session) -> None:
    """Compute and stage the track overview of each map stream (flushed, not committed).

    The overview is computed as :func:`create_activity_streams` computes it for a new stream, so a stream it finds no
    line in gets the empty overview and is not read again.

    Args:
        streams: The map streams, with their stored samples.
        db: Database session.
    """
    stream_model = activity_streams_models.ActivityStreams
    for stream in streams:
        db.execute(
            update(stream_model)
            .where(stream_model.id == stream.id)
            .values(track_overview=activity_streams_track_overview.overview_of(stream.stream_waypoints))
        )
    db.flush()
