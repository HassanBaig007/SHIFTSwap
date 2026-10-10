# ShiftSwap

ShiftSwap is a full-stack staff shift exchange application for CityCare Clinic. Staff can post shifts for colleagues, eligible staff can claim open listings, and managers can approve or reject claims. The backend enforces all permissions, labour rules, listing transitions, persistence, and audit history.

The application is designed to run locally without MongoDB, paid services, API keys, or an external database.

For a detailed explanation of the modules, data flow, state machine, API boundaries, and persistence model, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Features

- Select any seeded staff member or manager as the current acting person.
- View assigned shifts, shift times, certifications, owners, and listing status.
- Staff can post their own assigned shifts for exchange.
- Staff can withdraw their own open listings.
- Staff can view open listings from other staff.
- Claim eligibility displays every applicable refusal reason and rule number.
- Eligible staff can claim a shift and later unclaim it before approval.
- Managers have a dedicated approval queue for claimed listings.
- Managers can approve or reject claimed listings.
- Approval rechecks the current labour rules before changing ownership.
- Persistent action history is visible to staff and managers.
- State survives backend restarts through a local JSON store.
- The supplied seed is initialized only when no saved state exists.

## Technology

- Frontend: React 19, TypeScript, Vite
- Backend: Node.js, Express
- Persistence: atomic local JSON file storage
- Tests: Node's built-in test runner and Supertest
- Styling: application CSS with responsive layouts

The repository still contains the original Mongoose dependency from the starter project, but the implemented ShiftSwap persistence path uses the local JSON store and does not require MongoDB.

## Project structure

```text
.
├── client/
│   └── src/
│       ├── App.tsx       React application and workflows
│       ├── App.css       ShiftSwap interface styling
│       ├── index.css     Global CSS reset/settings
│       └── main.tsx      React entry point
├── server/
│   ├── app.js            Express routes and workflow state machine
│   ├── dateTime.js       Deterministic clinic-time arithmetic
│   ├── db.js             Local store connection adapter
│   ├── index.js          HTTP server startup and shutdown
│   ├── rules.js          Authoritative claim validation engine
│   ├── seed.json         Supplied staff and 61-shift seed
│   ├── store.js          Durable JSON persistence
│   └── test/
│       ├── app.test.js   Starter API regression tests
│       ├── rules.test.js Claim-rule unit tests
│       └── deep.test.js  Independent oracle and adversarial tests
├── AI_USAGE.md
├── package.json
└── README.md
```

## Requirements

- Node.js 20 or newer
- npm

No MongoDB installation is required.

## Installation

From the repository root:

```powershell
npm install
```

## Run the application

Start the backend in one terminal:

```powershell
npm run dev:server
```

The API runs on `http://localhost:5000` by default.

Start the frontend in a second terminal:

```powershell
npm run dev:client
```

Open the Vite URL printed in the terminal, normally:

```text
http://localhost:5173
```

If port 5173 is already in use, Vite selects another port, such as `http://localhost:5174`. The frontend proxies `/api` requests to the backend.

To start the backend without file watching:

```powershell
npm run start --workspace server
```

To preview a production frontend build:

```powershell
npm run build
npm run preview --workspace client
```

## First-run initialization and persistence

The first backend start checks for the configured state file. If it does not exist, the application:

1. Loads the exact records from `server/seed.json`.
2. Validates shift references and timestamps.
3. Creates the initial state with all staff and shifts.
4. Creates empty `listings` and `history` collections.
5. Writes the state to `server/data/state.json`.

Later backend starts load the existing state and do not reseed it. Successful mutations are written through a temporary file and renamed into place. The in-memory state is replaced only after the durable write succeeds.

The default state file is:

```text
server/data/state.json
```

To use a different state file, set `SHIFTSWAP_DATA_FILE` before starting the server:

```powershell
$env:SHIFTSWAP_DATA_FILE = "$env:TEMP\shiftswap-demo.json"
npm run dev:server
```

### Reset the local dataset

Reset only when you intentionally want to return to the supplied seed. Stop the backend first:

```powershell
Remove-Item server/data/state.json
```

Start the backend again. The seed will be loaded once into a new state file.

Do not delete the state file if you need to preserve current local listings, ownership changes, or history.

## Seed data

The supplied seed contains:

- 10 people
- 8 `STAFF` members
- 2 `MANAGER` members
- 61 shifts
- ICU and PEDS certification requirements

The seeded actors are:

| ID | Name | Role | Certifications |
| --- | --- | --- | --- |
| S1 | Asha | STAFF | ICU |
| S2 | Ben | STAFF | None |
| S3 | Priya | STAFF | PEDS |
| S4 | Rohan | STAFF | ICU, PEDS |
| S5 | Sana | STAFF | None |
| S6 | Tarun | STAFF | ICU |
| S7 | Uma | STAFF | None |
| S8 | Vikram | STAFF | PEDS |
| M1 | Meera | MANAGER | None |
| M2 | Nikhil | MANAGER | None |

All seed timestamps are treated as upcoming clinic schedule data. The real current date and time never affects eligibility.

## Labour rules

A claim is evaluated by `server/rules.js` using deterministic wall-clock arithmetic from `server/dateTime.js`.

### Rule 1: different owner

The claimant cannot be the current owner of the target shift. If a person attempts to claim their own shift, the response contains Rule 1 only and does not evaluate Rules 2-5.

### Rule 2: certification

If the target shift has a required certification, the claimant must have that exact certification. A shift with no certification requirement passes this rule.

### Rule 3: no overlap

Two shifts overlap when:

```text
A.start < B.end && B.start < A.end
```

Endpoint contact is not overlap. For example, a shift ending at 15:00 and another starting at 15:00 do not violate Rule 3.

### Rule 4: minimum rest

Every non-overlapping assigned shift must leave at least 11 hours, or 660 minutes, between the earlier shift's end and the later shift's start.

- Exactly 11 hours passes.
- 10 hours 59 minutes fails.
- Adjacent shifts have zero rest and fail Rule 4, but not Rule 3.
- Overnight shifts are supported.
- Overlapping shifts produce Rule 3, not an additional Rule 4 error for that same pair.

### Rule 5: weekly hours

The relevant week runs from Monday 00:00 through the following Monday 00:00. A shift belongs to the week in which it starts, even if it ends in the next week.

The calculation is:

```text
full duration of all current assignments in the target week
+ full duration of the target shift
<= 40 hours
```

Pending claims are not assignments. Existing assignments still count while their own listing is `OPEN` or `CLAIMED`.

### Approval revalidation

A claim is checked when submitted and Rules 2-5 are checked again when a manager approves it. If the claimant's current assignments or certifications make the approval invalid:

- Approval is refused.
- All current applicable reasons are returned.
- The listing remains `CLAIMED`.
- The claimer remains recorded.
- The shift remains assigned to its original owner.

## Listing state machine

Active listing uniqueness is enforced per shift. A shift can have at most one `OPEN` or `CLAIMED` listing.

```text
New -> OPEN
OPEN -> WITHDRAWN       poster only
OPEN -> CLAIMED         eligible different staff member
CLAIMED -> OPEN         claimer unclaims or manager rejects
CLAIMED -> APPROVED     manager approves after revalidation
```

Historical `WITHDRAWN` and `APPROVED` listings do not block a new listing for the current owner.

Ownership rules:

- Posting does not change shift ownership.
- Claiming does not change shift ownership.
- Unclaiming does not change shift ownership.
- Rejection does not change shift ownership.
- Only successful manager approval changes `shift.assigned_to`.
- Managers are never assigned shifts by the workflow.

## Manual verification workflow

### Post a shift

1. Select a `STAFF` actor who owns a shift.
2. Click `Post for swap` on one of their assigned shifts.
3. Confirm the status becomes `OPEN`.
4. Confirm the shift owner does not change.
5. Try posting it again and confirm the duplicate is refused.

### Claim and unclaim

1. Select a different eligible `STAFF` actor.
2. Find the open listing under `Open listings`.
3. Confirm the UI displays `Eligible to claim`.
4. Click `Claim shift`.
5. Confirm the listing becomes `CLAIMED` and the original owner remains assigned.
6. Confirm `My pending claims` appears for the claimant.
7. Click `Unclaim shift`.
8. Confirm the listing returns to `OPEN` and the claimer is cleared.

A reliable seeded demonstration is:

- Ben posts `SH001`.
- Uma can claim it.
- The shift remains assigned to Ben until approval.

### Reject a claim

1. Have an eligible staff member claim an open listing.
2. Select Meera or Nikhil as the manager.
3. Confirm the listing appears in `Approval queue`.
4. Click `Reject`.
5. Confirm the listing returns to `OPEN`.
6. Confirm shift ownership does not change.

### Approve a claim

1. Have an eligible staff member claim an open listing.
2. Switch to a manager.
3. Click `Approve swap`.
4. Confirm the listing becomes `APPROVED`.
5. Confirm the shift is reassigned to the claimant.
6. Confirm the approval appears in history.
7. Refresh the page and confirm the new owner remains assigned.

### Test refusal reasons

For example, if Asha posts `SH004`, it requires ICU. Ben should not be able to claim it because:

- Ben does not have ICU certification.
- Ben's existing `SH007` leaves only 8 hours of rest around the target.

The UI should show both Rule 2 and Rule 4 reasons rather than only the first failure.

## API

All mutation requests include the acting person's ID as `actorId` in the JSON body.

### Read routes

```text
GET /api/health
GET /api/ready
GET /api/bootstrap?actorId=S1
GET /api/staff
GET /api/shifts
GET /api/listings
GET /api/history
```

`/api/bootstrap` returns the current staff, shifts, listings, history, and eligibility results for the selected staff actor.

### Mutation routes

```text
POST /api/listings
POST /api/listings/:id/withdraw
POST /api/listings/:id/claim
POST /api/listings/:id/unclaim
POST /api/listings/:id/approve
POST /api/listings/:id/reject
```

Post body example:

```json
{
  "actorId": "S2",
  "shiftId": "SH001"
}
```

Action body example:

```json
{
  "actorId": "S7"
}
```

Successful mutation responses include a message and refreshed application state. Refusals include an `error` string and, where applicable, a structured `reasons` array:

```json
{
  "error": "Claim is not permitted.",
  "reasons": [
    {
      "rule": 2,
      "message": "Requires ICU; Ben does not hold that certification.",
      "shiftId": "SH004"
    }
  ]
}
```

A claim against a listing that is no longer `OPEN` returns the exact required message:

```text
no longer available
```

## Action history

History is persisted in the state file and displayed to all actors. Entries include:

- Acting person and role
- Action attempted
- Shift ID
- Listing ID when applicable
- Success or refusal outcome
- Explanation and rule reasons when applicable
- Timestamp for display and audit ordering

History is not deleted when listings are reopened or shifts are reassigned.

## Testing

Run the complete backend suite from the repository root:

```powershell
npm test
```

Run the frontend production build:

```powershell
npm run build
```

Run frontend linting:

```powershell
npm run lint
```

The backend suite includes:

- Existing health and API tests
- Seed integrity checks
- Independent overlap, rest, and week calculations
- Claim-rule aggregation and Rule 1 short-circuiting
- Stale-listing behavior
- Listing state transitions
- Role permissions
- Approval-time revalidation
- Persistence across state reload
- Atomic write failure behavior
- Same-process concurrent claim requests
- 100 deterministic generated fixtures compared with an independent oracle

Expected verified results at the time of writing:

```text
npm test       20 passing
npm run build  successful
npm run lint   no errors
```

## Environment configuration

The optional `server/.env` file supports:

```text
PORT=5000
CORS_ORIGIN=http://localhost:5173
SHIFTSWAP_DATA_FILE=./data/state.json
```

`SHIFTSWAP_DATA_FILE` is optional. The default is `server/data/state.json`.

## Known limitations

- Actor selection is a deliberate substitute for authentication because the brief does not require login.
- The JSON persistence layer is appropriate for local demonstration and single-process use. A production deployment would use a transactional database with a cross-process concurrency mechanism.
- Audit timestamps use the server clock for display only. They never affect claim eligibility.
- Browser end-to-end checks were performed manually with the running Vite and Express applications; no browser test framework is included in the repository.

## AI usage

Implementation assistance and verification details are documented in [AI_USAGE.md](AI_USAGE.md).
