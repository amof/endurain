"""The global map's tracks route: the slice it asks the service for, and the parameters it refuses."""

import uuid
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.database as core_db
import core.exceptions as core_exceptions
import modules.activities.activity_streams.schema as activity_streams_schema
import modules.activities.activity_streams.track_router as track_router
import modules.auth.dependencies as auth_deps

_USER_ID = uuid.UUID(int=1)


def _build_app(mock_db):
    app = FastAPI()
    app.include_router(track_router.router, prefix="/activities/tracks")
    # Same domain-error boundary the real app registers, so these tests assert the status codes clients receive.
    core_exceptions.register_exception_handlers(app)
    app.dependency_overrides[auth_deps.check_scopes] = lambda: None
    app.dependency_overrides[auth_deps.get_current_user_id] = lambda: _USER_ID
    app.dependency_overrides[core_db.get_db] = lambda: mock_db
    return app


@patch("modules.activities.activity_streams.track_router.activity_streams_service.list_track_overviews")
class TestListActivityTracks:
    def test_reads_the_first_slice_at_the_default_size(self, list_tracks, mock_db):
        list_tracks.return_value = activity_streams_schema.TrackOverviewPage(items=[], num_records=25)

        response = TestClient(_build_app(mock_db)).get("/activities/tracks")

        assert response.status_code == 200
        assert response.json() == {"items": [], "num_records": 25, "next_cursor": None}
        list_tracks.assert_called_once_with(_USER_ID, mock_db, cursor=None, num_records=25)

    def test_continues_from_the_cursor_it_is_sent(self, list_tracks, mock_db):
        list_tracks.return_value = activity_streams_schema.TrackOverviewPage(items=[], num_records=200)

        response = TestClient(_build_app(mock_db)).get("/activities/tracks?cursor=abc&num_records=200")

        assert response.status_code == 200
        list_tracks.assert_called_once_with(_USER_ID, mock_db, cursor="abc", num_records=200)

    def test_refuses_a_slice_above_the_page_cap(self, list_tracks, mock_db):
        response = TestClient(_build_app(mock_db)).get("/activities/tracks?num_records=201")

        assert response.status_code == 422
        list_tracks.assert_not_called()


def test_refuses_a_cursor_the_server_did_not_issue(mock_db):
    response = TestClient(_build_app(mock_db)).get("/activities/tracks?cursor=not-a-cursor")

    assert response.status_code == 400
