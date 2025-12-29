# Performance changes (safe-only)

## Summary
- No risky performance refactors were introduced.
- Auth diagnostics and safety timeouts are **DEV-only** and do not affect production performance.
- App Check initialization remains deferred (idle) to avoid blocking first paint.

## Notes
- Lighthouse gates remain unchanged in code to keep Best Practices at 100 and performance ≥ 0.95.
