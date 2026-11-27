"""Tests for the simplified track overview of a GPS stream."""

import itertools

import modules.activities.activity_streams.track_overview as track_overview


def _decode(encoded: str) -> list[tuple[float, float]]:
    """Decode a Google encoded polyline (five decimals), as a map client does."""
    points: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append((lat / 1e5, lon / 1e5))
    return points


class TestOverviewOf:
    def test_encodes_the_reference_polyline(self):
        # The worked example of the encoded polyline format.
        waypoints = [{"lat": 38.5, "lon": -120.2}, {"lat": 40.7, "lon": -120.95}, {"lat": 43.252, "lon": -126.453}]

        assert track_overview.overview_of(waypoints) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

    def test_drops_points_within_the_tolerance_of_a_straight_line(self):
        # Points every ~11 m along a meridian, each nudged ~1 m sideways: the line is straight within tolerance.
        waypoints = [{"lat": 45.0 + i * 0.0001, "lon": 6.0 + (0.00001 if i % 2 else 0.0)} for i in range(101)]

        assert _decode(track_overview.overview_of(waypoints)) == [(45.0, 6.0), (45.01, 6.0)]

    def test_keeps_a_corner_further_than_the_tolerance(self):
        # An L shape: 1 km north, then 1 km east. The corner is ~700 m off the start-end line.
        north = [{"lat": 45.0 + i * 0.0009, "lon": 6.0} for i in range(11)]
        east = [{"lat": 45.009, "lon": 6.0 + i * 0.00127} for i in range(1, 11)]

        assert _decode(track_overview.overview_of(north + east)) == [(45.0, 6.0), (45.009, 6.0), (45.009, 6.0127)]

    def test_keeps_the_corners_of_a_loop_that_ends_on_its_exact_start(self):
        # A square of ~1 km sides: the first and last points are the same, so the first span has no length.
        corners = [(45.0, 6.0), (45.009, 6.0), (45.009, 6.0127), (45.0, 6.0127), (45.0, 6.0)]
        waypoints = [
            {"lat": start[0] + (end[0] - start[0]) * i / 10, "lon": start[1] + (end[1] - start[1]) * i / 10}
            for start, end in itertools.pairwise(corners)
            for i in range(10)
        ] + [{"lat": 45.0, "lon": 6.0}]

        assert _decode(track_overview.overview_of(waypoints)) == corners

    def test_skips_samples_without_a_position(self):
        waypoints = [{"lat": 45.0, "lon": 6.0}, {"lat": None, "lon": None}, {"time": "x"}, {"lat": 45.1, "lon": 6.1}]

        assert _decode(track_overview.overview_of(waypoints)) == [(45.0, 6.0), (45.1, 6.1)]

    def test_skips_samples_whose_position_is_not_a_finite_number(self):
        waypoints = [
            {"lat": 45.0, "lon": 6.0},
            {"lat": "north", "lon": 6.05},
            {"lat": float("nan"), "lon": 6.05},
            {"lat": True, "lon": 6.05},
            {"lat": 45.1, "lon": 6.1},
        ]

        assert _decode(track_overview.overview_of(waypoints)) == [(45.0, 6.0), (45.1, 6.1)]

    def test_a_track_of_fewer_than_two_points_has_an_empty_overview(self):
        assert track_overview.overview_of([]) == ""
        assert track_overview.overview_of([{"lat": 45.0, "lon": 6.0}]) == ""
