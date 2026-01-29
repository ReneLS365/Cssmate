# Test Matrix — Bundt 3 (P0 fixes)

> **Note:** Manual tests were not executed in this environment (no interactive browser). Run locally on device/desktop as described below.

## Manual smoke tests (run 3x: cold start / reload / after navigation)

| Test | Steps | Run A (cold) | Run B (reload) | Run C (nav) | Notes |
| --- | --- | --- | --- | --- | --- |
| Login/logout + org/rolle | Invite → login → verify membership list/access | Not run | Not run | Not run | Requires interactive Auth0 session |
| Publish/export → Delt sager refresh | Export → open Delt sager → verify case appears instantly | Not run | Not run | Not run | Requires interactive app + backend |
| Filter/sort stability | Switch filters/sort 10x, counts never 0 incorrectly | Not run | Not run | Not run | Requires interactive UI |
| Import montage → demontage | Status transition updates counts correctly | Not run | Not run | Not run | Requires import file + UI |
| Offline/online | Offline shows cached data; online refresh updates counts | Not run | Not run | Not run | Requires service worker + network toggling |

## Automated checks
- `npm run lint --if-present`
- `npm test`
- `npm run build`
