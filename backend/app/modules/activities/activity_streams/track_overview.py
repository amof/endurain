"""The simplified overview of a GPS track, for drawing many tracks on one map.

Ramer-Douglas-Peucker keeps only the points the track needs to stay within :data:`TOLERANCE_METRES`
of the recorded one, and the result is an encoded polyline (the Google format, five decimals): a
compact string a map client decodes in a few lines. Pure computation, no I/O.
"""

import math
from collections.abc import Mapping, Sequence
from typing import Any, TypeIs

#: How far the overview may stray from the recorded track, in metres. Enough for an overview from
#: world to neighbourhood zoom; the activity's own map draws the full track.
TOLERANCE_METRES = 10.0

_METRES_PER_DEGREE = 6_371_000.0 * math.pi / 180
_POLYLINE_PRECISION = 100_000

type Point = tuple[float, float]


def _is_coordinate(value: object) -> TypeIs[float]:
    """Tell whether a stored coordinate is a finite number; a flag is not one."""
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _positions(waypoints: Sequence[Mapping[str, Any]]) -> list[Point]:
    """Return the ``(lat, lon)`` of the samples that carry a position, both coordinates finite numbers."""
    positions = []
    for waypoint in waypoints:
        lat, lon = waypoint.get("lat"), waypoint.get("lon")
        if _is_coordinate(lat) and _is_coordinate(lon):
            positions.append((float(lat), float(lon)))
    return positions


def _distance_to_segment(point: Point, start: Point, end: Point) -> float:
    """Return the distance from a point to a segment, on a plane in metres."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.dist(point, start)
    along = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_squared))
    return math.dist(point, (start[0] + along * dx, start[1] + along * dy))


def _simplify(points: list[Point]) -> list[Point]:
    """Return the points Ramer-Douglas-Peucker keeps at :data:`TOLERANCE_METRES`.

    Distances are measured on an equirectangular projection around the first point, which is
    accurate to well under the tolerance over the extent of one activity. Iterative, so a long
    track cannot exhaust the recursion limit.
    """
    if len(points) < 3:
        return points
    cos_lat = math.cos(math.radians(points[0][0]))
    plane = [(lon * cos_lat * _METRES_PER_DEGREE, lat * _METRES_PER_DEGREE) for lat, lon in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    spans = [(0, len(points) - 1)]
    while spans:
        first, last = spans.pop()
        farthest, distance = first, 0.0
        for index in range(first + 1, last):
            candidate = _distance_to_segment(plane[index], plane[first], plane[last])
            if candidate > distance:
                farthest, distance = index, candidate
        if distance > TOLERANCE_METRES:
            keep[farthest] = True
            spans.append((first, farthest))
            spans.append((farthest, last))
    return [point for point, kept in zip(points, keep, strict=True) if kept]


def _encode_value(value: int) -> str:
    """Encode one signed delta of the polyline format."""
    shifted = ~(value << 1) if value < 0 else value << 1
    chunks = []
    while shifted >= 0x20:
        chunks.append(chr((0x20 | (shifted & 0x1F)) + 63))
        shifted >>= 5
    chunks.append(chr(shifted + 63))
    return "".join(chunks)


def _encode(points: list[Point]) -> str:
    """Encode points as a Google encoded polyline with five decimals."""
    encoded = []
    previous_lat = previous_lon = 0
    for lat, lon in points:
        scaled_lat, scaled_lon = round(lat * _POLYLINE_PRECISION), round(lon * _POLYLINE_PRECISION)
        encoded.append(_encode_value(scaled_lat - previous_lat))
        encoded.append(_encode_value(scaled_lon - previous_lon))
        previous_lat, previous_lon = scaled_lat, scaled_lon
    return "".join(encoded)


def overview_of(waypoints: Sequence[Mapping[str, Any]]) -> str:
    """Return the encoded overview of a map stream's samples.

    Args:
        waypoints: The map stream's samples; one whose ``lat`` and ``lon`` are not both finite numbers is skipped.

    Returns:
        The simplified track as an encoded polyline, or an empty string when fewer than two samples
        carry a position, so there is no line to draw.
    """
    points = _positions(waypoints)
    if len(points) < 2:
        return ""
    return _encode(_simplify(points))
