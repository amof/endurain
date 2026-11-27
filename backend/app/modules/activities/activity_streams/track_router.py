"""Authenticated route for the caller's simplified tracks, which the global map draws."""

from typing import Annotated

from fastapi import APIRouter, Query, Security

import core.dependencies as core_dependencies
import core.pagination as core_pagination
import modules.activities.activity_streams.schema as activity_streams_schema
import modules.activities.activity_streams.service as activity_streams_service
import modules.auth.dependencies as auth_dependencies

router = APIRouter()


@router.get(
    "",
    response_model=activity_streams_schema.TrackOverviewPage,
    dependencies=[
        Security(
            auth_dependencies.check_scopes,
            scopes=["activities:read"],
        )
    ],
)
def list_activity_tracks(
    token_user_id: auth_dependencies.CurrentUserId,
    db: core_dependencies.DbSession,
    cursor: Annotated[str | None, Query()] = None,
    num_records: Annotated[int | None, Query(ge=1, le=core_pagination.MAX_NUM_RECORDS)] = None,
) -> activity_streams_schema.TrackOverviewPage:
    """List a keyset slice of the caller's own activity tracks, newest first, simplified for drawing many on one map.

    Each track is the activity's GPS route simplified to within 10 metres, as an encoded polyline, with the
    activity's type, its start and end instants and its local start and end dates. Hidden and virtual activities,
    and activities without GPS, have no track. A track that is still being computed after an upgrade appears once it
    is ready.

    Pass the `next_cursor` of a slice as `cursor` to get the following one; it is `null` on the last slice. A slice
    covers `num_records` activities and an activity without a track has no item in it, so a slice can hold fewer
    tracks than that, even none, before the last one.
    """
    return activity_streams_service.list_track_overviews(
        token_user_id,
        db,
        cursor=cursor,
        num_records=num_records or core_pagination.DEFAULT_NUM_RECORDS,
    )
