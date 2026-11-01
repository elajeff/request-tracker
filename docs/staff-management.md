# Staff and request history

## Staff

Support users manage a staff list: people that requests can be assigned to. Staff are not login accounts.

- Create, rename, deactivate and reactivate staff from the dashboard. There is no delete.
- Names are 1-120 characters. Duplicates are allowed; the API tells them apart by ID, and the dashboard adds the first 8 characters of the ID to the label only when two people share a name.
- Deactivating someone keeps their existing assignments but blocks new ones. Reassigning or unassigning still works.
- The staff search is a case-insensitive substring match on the name. `%`, `_` and `\` are matched literally.

API:

| Call | Body |
| --- | --- |
| `POST /api/staff` | `{"name": "Alex"}` |
| `PUT /api/staff/{id}` | `{"name": "Alex"}` |
| `PATCH /api/staff/{id}/active` | `{"active": false}` |
| `GET /api/staff?q=&limit=&cursor=` | |
| `PATCH /api/requests/{id}/assignment` | `{"staffId": "<uuid>"}` or `{"unassign": true}` |

Filter the request queue with `staffId=<uuid>` or `unassigned=true`, not both.

## History

Every change to a request (created, title, description, status, priority, assignee) adds a history entry in the same transaction as the change. The entry stores the old and new value and, since V6, who made the change. Entries from before V6 have no actor. Renaming a staff member does not rewrite old entries. This is a convenience log, not a tamper-proof audit trail.

Open **Change history** on a request to read it, newest first.

## Pagination

Requests, staff and history use cursors. Requests are ordered newest first and staff by ID. Pass `nextCursor` from one page as `cursor` in the next call. When you change a filter or search text, start again without a cursor.

## Migrations

V5 replaced the free-text assignee with the staff table. Every old assignee became its own inactive staff record, linked to its request, so nothing was merged by guesswork. A blank legacy name has to be renamed before it can be reactivated.
