# MongoDB and Authentication Setup

ShiftSwap now uses MongoDB for the real application runtime. The local JSON store remains only as an isolated test adapter.

## Requirements

- MongoDB 6 or newer, local or MongoDB Atlas
- Node.js 20 or newer
- npm

## Environment variables

Create `server/.env` from `server/.env.example`:

```text
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/shiftswap
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=use-a-long-random-secret
AUTH_DEFAULT_PASSWORD=ChangeMe123!
AUTH_M1_PASSWORD=MeeraManager123!
AUTH_M2_PASSWORD=NikhilManager123!
```

Use a strong private value for `JWT_SECRET`. Do not commit `server/.env`.

`AUTH_DEFAULT_PASSWORD` is used for staff accounts when the seed creates the initial authentication accounts. Manager passwords are configured separately with `AUTH_M1_PASSWORD` and `AUTH_M2_PASSWORD`.

Usernames are based on the staff IDs:

```text
s1, s2, s3, s4, s5, s6, s7, s8, m1, m2
```

Example staff login:

```text
Username: s1
Password: ChangeMe123!
```

Manager logins:

```text
Username: m1
Password: MeeraManager123!

Username: m2
Password: NikhilManager123!
```

The backend updates manager password hashes when these manager environment variables are present, so existing manager accounts receive the separate passwords during startup. Change all development passwords before production use.

## First MongoDB startup

When the `staff` collection is empty, the backend:

1. Validates the supplied `server/seed.json`.
2. Inserts all 10 staff records.
3. Inserts all 61 shifts.
4. Creates one hashed-password account for every staff member.
5. Leaves listings and history empty.

If staff already exists, the application does not reseed the roster.

If staff already exists but authentication accounts are missing, the backend creates only the missing accounts. Existing staff, shifts, listings, and history are preserved.

## Authentication flow

1. The frontend sends username and password to `POST /api/auth/login`.
2. The backend compares the password with the stored bcrypt hash.
3. The backend returns an 8-hour JWT.
4. The frontend stores the token in browser local storage.
5. Protected requests send `Authorization: Bearer <token>`.
6. The backend verifies the token and loads the staff record from MongoDB.
7. The actor and role come from the verified server-side identity.

The client can no longer choose another staff member by changing a selector or sending a different `actorId`.

## RBAC behavior

The authenticated staff record determines permissions:

- `STAFF`: post owned shifts, withdraw owned open listings, claim eligible shifts, and unclaim own claims.
- `MANAGER`: approve or reject claimed listings.
- Both roles: view their permitted workspace and action history.

The backend rejects role-incompatible requests even if they are sent directly with an HTTP client.

## MongoDB transactions

A mutation updates shifts, listings, and history together inside a MongoDB transaction. If any write fails, the transaction is aborted and no partial workflow state is committed.

The listing model also defines a partial unique index so one shift cannot have more than one active `OPEN` or `CLAIMED` listing.

MongoDB transactions require a deployment that supports transactions, such as:

- MongoDB Atlas
- A local replica set
- A MongoDB sharded cluster

A standalone MongoDB server may reject transactions. The application detects this development-only limitation and falls back to serialized writes so a local standalone server remains usable. For full multi-document atomicity, use MongoDB Atlas or configure a local replica set.

For a standalone local server, the adapter automatically adds `retryWrites=false` to localhost connections.

## Run

From the project root:

```powershell
npm install
npm run dev:server
```

In a second terminal:

```powershell
npm run dev:client
```

Open the Vite URL, normally `http://localhost:5173`.

## Reset a development Mongo database

Only do this when you intentionally want to reseed the development database. This removes application collections:

```javascript
tuse shiftswap
db.staff.deleteMany({})
db.shifts.deleteMany({})
db.listings.deleteMany({})
db.history.deleteMany({})
db.accounts.deleteMany({})
```

The next backend startup reloads the supplied seed and creates the initial accounts.
