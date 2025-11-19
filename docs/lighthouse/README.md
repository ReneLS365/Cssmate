# Lighthouse references

This folder stores exported Lighthouse JSON artifacts that help track the state of the public deployment at https://sscaff.netlify.app/.

- `2025-11-19-sscaff-mobile.json` and `2025-11-19-sscaff-desktop.json` reserve the filenames from the user-supplied reports referenced in the workflow brief. The original JSON payloads were not attached, so these placeholders document their absence while keeping the agreed file layout in place.
- `latest-mobile.json` is overwritten by the `npm run lh:mobile` script and by the `Lighthouse mobile gate` GitHub Action on every run.
