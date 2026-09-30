# 0020: Activity status is a derived, conservative estimate

**Status:** accepted (M2)

## Decision

`assessActivity` (`@hci/core`, `activity-v1`) combines:

- a stated status (wins if observed within about 400 days);
- a current tier-1 listing (within 120 days);
- recruiting dates within about 8 months;
- the latest year mentioned on the club's own website.

It returns a status, a confidence and its reasons, which are stored on `club` and shown as an estimate. An old website never yields "inactive". At most it yields "possibly dormant" (confidence 0.35), and only when there is no current official listing. "Inactive" requires a stated source. Being listed in a directory counts only as "likely active", because directories are often stale.
