# Health data and activity streams

How to write health records, how to read the health lists and charts for a date range, and what an activity stream carries. All paths are under `/api/v1`. The exact schemas are in the [API reference](api-reference.md).

## Writing health records

Weight, steps, sleep, water, poop and fasting are written the same way. All paths are under `/health/{metric}`.

- **One record per day** for weight, steps, sleep and water. A `POST` for a day that already has one is `409`, and the day's record is changed with `PATCH /health/{metric}/{id}`. Water does not add to the day: send the new total.
- **A date is not in the future.** A record dated after the athlete's own today is `400`, on create and on a `PATCH` that moves it. A poop or fasting time counts as the day it falls on in the athlete's time zone.
- **`date` may be left out** on weight, steps, sleep and water: the record is for the athlete's today.
- **`source` is read-only.** Every record answers it: `manual` for what a person entered, `garmin` for what the Garmin sync wrote. A request cannot set it.
- **The unit is in the name** of a measurement: mass `_kg`, duration `_seconds`, volume `_ml` and a percentage `_percent`. Counts, scores and rates keep a plain name.

| Metric | Fields with a unit |
| ------ | ------------------ |
| Weight | `weight_kg`, `bone_mass_kg`, `muscle_mass_kg`, `body_fat_percent`, `body_water_percent` |
| Sleep | `total_sleep_seconds` and the other `*_seconds` durations, `avg_spo2_percent`, `lowest_spo2_percent`, `highest_spo2_percent` |
| Water | `amount_ml` |
| Fasting | `target_duration_seconds`, `actual_duration_seconds` |
| Targets (`/health/targets`) | `weight_kg`, `sleep_seconds`, `fasting_seconds`, `water_ml`; `steps` and `poop_count` are counts |

A profile export writes these names.

## Health lists and charts

Weight, steps, sleep, water, poop and fasting each have a list (`GET /health/{metric}`) and, except for fasting, a chart (`GET /health/{metric}/chart`; sleep also has `GET /health/sleep/chart/resting-heart-rate`). They take the same window parameters.

| Parameter | Meaning |
| --------- | ------- |
| `interval` | A window that looks back from today: `last_7_days`, `last_30_days`, `last_90_days`, `last_year` or `all_time`. A list without it returns every record. A chart without it uses `last_7_days`. |
| `start_date` | The first day to include, as `YYYY-MM-DD`. |
| `end_date` | The last day to include, as `YYYY-MM-DD`. |

- **Both dates are inclusive.** `start_date=2025-03-01&end_date=2025-03-01` is that one day.
- **One date leaves the other side open.** With only `start_date` the window runs to the newest record, and with only `end_date` it starts at the oldest.
- **A date replaces `interval`.** When either date is given, `interval` is ignored: it always looks back from today, so combining it with a past range would leave nothing.
- **A start after the end is refused** with `422`, whose `errors` name `end_date`.
- **Without any of the three parameters nothing changes.** A list returns every record and a chart covers the last 7 days.
- **Days are the athlete's own.** Poop records belong to the day they happened in the user's time zone. Fasting sessions belong to the UTC day they started on.
- **A list's `total` counts the window**, not only the records on the page.
- **The sleep list leaves out the sleep stages.** A night in `GET /health/sleep` has every field of the record except `sleep_stages`, and `has_sleep_stages` says whether it has any. `GET /health/sleep/{health_sleep_id}` returns the night with its stages; read it before editing them.
- **The sleep list can keep only the nights with a resting heart rate.** `GET /health/sleep?has_resting_heart_rate=true` returns those nights, and `false` the nights without one; the `total` counts the same nights.
- **A chart is aggregated.** It answers with a `bucket` (`day`, `week` or `month`, the finest that keeps it to 366 points) and one point per bucket that holds a value, so a long range stays small.

## Activity streams

`GET /activities/{activity_id}/streams` returns a page of the activity's streams and `GET /activities/{activity_id}/streams/{stream_type}` returns one; the public activity has the same two routes under `/public`. Each stream has a `stream_type`, a string, and a list of `stream_waypoints`, whose shape follows the type. `{stream_type}` in the path takes the same string.

| `stream_type` | Stream | Waypoint value keys |
| ------------- | ------ | ------------------- |
| `heart_rate` | Heart rate | `hr` (bpm) |
| `power` | Power | `power` (watts) |
| `cadence` | Cadence | `cad` (rpm, spm for running) |
| `elevation` | Elevation | `ele` (meters) |
| `speed` | Speed | `vel` (m/s) |
| `pace` | Pace | `pace` (s/m, 0 at a standstill) |
| `map` | Map | `lat`, `lon` (decimal degrees) |
| `temperature` | Temperature | `temp` (degrees Celsius) |

- **Every waypoint has a `time`**: a UTC `YYYY-MM-DDTHH:MM:SS` string, or the seconds from the start as a number for a stream imported from Strava. When the owner hides the start time of the activity, `time` is missing from the waypoints other viewers get.
- **Values are numbers as stored**, so an integer such as `120` stays `120` and is not turned into `120.0`. A value can be `null` where the source recorded none.
- **A stream is served whole.** There is no downsampling, and a long activity has many waypoints; the page parameters count streams, not waypoints.
- The heart-rate stream also carries `zone_percentages`, computed from the owner's current thresholds. Streams of other types have `null` there.

## Activity tracks

`GET /activities/tracks` lists the caller's own activity tracks, newest first, simplified for drawing many on one map, as `{"items": [...], "num_records": <int>, "next_cursor": <string or null>}`. Send the `next_cursor` of a slice as `cursor` to get the following one, and read on until it is `null` to draw them all. The cursor is opaque and names the last activity a slice covered, so a track computed or an activity recorded between two requests does not shift or repeat any track, and the response has no total. Each item has:

| Field | Meaning |
| ----- | ------- |
| `activity_id` | The activity the track belongs to. |
| `activity_type` | The activity's type, as in [Supported types](supported-types.md). |
| `started_at`, `ended_at` | When the activity started and ended, UTC instants. |
| `start_date`, `end_date` | The local dates it started and ended on, in the activity's own timezone. |
| `track` | The GPS route as an [encoded polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) with five decimals. |

- **Only your own activities.** The route needs `activities:read`, and no other user's track is ever listed.
- **Simplified to within 10 metres.** The track keeps only the points it needs to stay within 10 metres of the recorded route, so it suits an overview, not a measurement. Read the `map` stream for every recorded position.
- **Some activities have no track.** An activity without GPS, a virtual activity (its positions describe a platform's synthetic route) and a hidden activity are left out.
- **A slice counts activities, not tracks.** `num_records` (1 to 200, default 25) is how many of your activities a slice covers, and one without a track has no item, so a slice can hold fewer tracks than that, even none, and still carry a `next_cursor`. Keep following it.
- **Existing activities fill in after an upgrade.** The tracks of activities stored before this route existed are computed in the background, so they can appear over the first minutes after an upgrade.
