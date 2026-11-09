# CampusFind

Campus lost-and-found with ownership verification. Built with React, Vite and Tailwind on the frontend, Express on the backend and PostgreSQL 17 for data.

## Run locally

Set up the server first: in `server/.env`, fill in `PG_SUPERUSER_PASSWORD`. The other keys are already generated.

```bash
cd server && npm install && npm run db:setup   # creates roles, database, schema and demo data
npm start                                       # API on http://localhost:4000

cd ../client && npm install && npm run dev      # site on http://localhost:5173
```

Single-server mode: run `npm run build` in `client/`, then `npm start` in `server/`. The whole site is then served at http://localhost:4000.

## Demo accounts

| Role    | Email                                            | Password    |
|---------|--------------------------------------------------|-------------|
| Admin   | admin@campusfind.edu, desk@campusfind.edu        | Admin@123   |
| Student | aarav.mehta@college.edu (12 students, `@college.edu`) | Student@123 |

## Useful scripts (in `server/`)

- `npm run db:reset`: drops and rebuilds the database with fresh demo data.
- `npm run db:test`: runs 46 database tests (roles, RLS, triggers, matching and concurrency). Every test rolls back.
- `npm run test:api`: runs 40 HTTP tests against the real database roles. It resets the database before and after.
