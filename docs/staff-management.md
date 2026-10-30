# Staff management and history

Open **Manage support staff** beside the queue to create, rename, deactivate, or reactivate directory records. Names are 1–120 characters; duplicate names are allowed and IDs distinguish records. These are not authenticated users. Use **Load more staff** for additional directory records and selector options. **Search staff** matches names or IDs across the directory by fetching remaining cursor pages (25 records per request); the API has no server-side staff search. A full search therefore loads the directory into browser memory.

The dashboard owns shared staff options and assignment state. Its React staff-management component reports loaded pages and saved records to update queue filters and assignment options. Session loss unmounts the directory and clears its drafts. Loading, empty, validation and error states are explicit; failed writes require a manual retry.

Choose active staff or **Unassigned** on a request. Deactivation preserves existing assignments but blocks new ones; reassignment and unassignment remain available. The staff filter includes inactive records and combines with search and pagination. Totals remain global. Expand **Change history** to load older changes or refresh.

Staff API: `POST /api/staff` and `PUT /api/staff/{id}` accept `{"name":"Alex Support"}`; `PATCH /api/staff/{id}/active` accepts `{"active":false}` (or true). `GET /api/staff` uses `limit`/`cursor` pagination, ordered by UUID. There is no delete endpoint. Assignment now accepts `{"staffId":"UUID"}` or `{"unassign":true}` instead of a free-text name. Queue filters use `staffId=UUID` or `unassigned=true`, not both.

Migration V5 copies every non-null legacy assignment exactly into a separate inactive staff record, linked to its request. Even equal names are not merged; review and reactivate, rename, or reassign them. Blank legacy names must be renamed before activation. The old text column is replaced only after copying its values; history rows are untouched. New assignment history captures name and staff ID at change time, in the same transaction. Renaming staff updates the current display without rewriting historical values. No-op/rejected updates add no history. History starts at V3. V6 adds authenticated actor snapshots for new API changes; older changes remain unattributed. It is not a tamper-proof audit log.

V5 requires the matching backend and dashboard; the previous free-text-assignment backend cannot run against the new schema.
