# Shared database: step-by-step guide for you and your colleague

You and your colleague use the **same database**. Everyone must use the **same Prisma schema and migrations** so no one applies a migration that drops data (e.g. Trend columns, StylingRule table, MicroStore.sections).

---

## Person who has the correct schema (e.g. main branch / B1.3)

Follow these steps **first**. This is usually the person who ran the migrations that created Trend (with `source`, `strength`), StylingRule, and the rest of the current schema.

### Step 1: Confirm your schema is the source of truth

- Open `prisma/schema.prisma` and verify:
  - **Trend** has `source`, `strength`, and `@@unique([trendName, parentId])`.
  - **StylingRule** model exists.
  - **MicroStore** has `sections` (e.g. `String?`).
- If any of these are missing, fix the schema first (or pull from the branch that has them).

### Step 2: Check migration status against the shared DB

In `backend2`:

```bash
cd backend2
npx prisma migrate status
```

- If it says **"Database schema is up to date"** → your DB and migrations match; go to Step 3.
- If it says **"X migration(s) pending"** → run:
  ```bash
  npx prisma migrate deploy
  ```
  Then run `npx prisma migrate status` again and confirm it’s up to date.

### Step 3: Never apply a destructive migration

- Do **not** run `npx prisma migrate dev` if the preview says it will:
  - Drop **Trend** columns (`source`, `strength`),
  - Drop the **StylingRule** table,
  - Drop/recreate **MicroStore.sections** in a way that loses data.
- If you need to add a new migration, create one that only **adds** or **safely alters** (e.g. add column, add index). Do not drop columns/tables that contain data unless you’ve agreed and have a backup.

### Step 4: Push schema and migrations for your colleague

- Commit and push:
  - `prisma/schema.prisma`
  - Entire `prisma/migrations/` folder
- Tell your colleague which branch to use (e.g. `main` or your feature branch).

---

## Colleague (joining the same DB)

Follow these steps **after** the other person has pushed the correct schema and migrations.

### Step 1: Use the same codebase and DB URL

- Pull the latest code from the agreed branch (the one with the correct `schema.prisma` and `prisma/migrations/`).
- Copy or configure `.env` so **`DATABASE_URL`** is the **same** as the other person’s (same host, database, user, password). You must point at the same database.

### Step 2: Do not use an old or different schema

- Open `prisma/schema.prisma` and confirm:
  - **Trend** has `source`, `strength`, and `@@unique([trendName, parentId])`.
  - **StylingRule** model exists.
- If your file looks different (e.g. no `source`/`strength`, or no StylingRule), **do not** run migrations. Pull again from the correct branch until your schema matches.

### Step 3: Apply existing migrations only (no new migration)

In `backend2`:

```bash
cd backend2
npx prisma migrate status
```

- If it says **"X migration(s) pending"**:
  ```bash
  npx prisma migrate deploy
  ```
  This applies migrations that already exist in `prisma/migrations/`; it does **not** create new ones.

- If it says something like **"Drift detected"** or **"Migration X was not applied"**:
  - Do **not** run `prisma migrate dev` if it wants to drop columns or tables.
  - Ask the other person: “Which migrations are already applied on the shared DB?” Then run:
    ```bash
    npx prisma migrate resolve --applied "MIGRATION_FOLDER_NAME"
    ```
    for each migration that was already applied (replace `MIGRATION_FOLDER_NAME` with the folder name under `prisma/migrations/`).
  - Then run `npx prisma migrate status` again; it should report the database as up to date.

### Step 4: Regenerate Prisma Client (no DB change)

```bash
npx prisma generate
```

This updates the generated client to match the schema. It does **not** change the database.

### Step 5: Never apply a destructive migration

- If at any point Prisma suggests:
  - Dropping **Trend** columns (`source`, `strength`),
  - Dropping the **StylingRule** table,
  - Or dropping/recreating **MicroStore.sections** with data loss,
- **Do not** apply that migration. Your schema or migration history is out of sync. Pull the latest schema and migrations again and repeat from Step 1.

---

## Colleague using a **different backend** (same database)

You work in a **different repo/backend** but connect to the **same database**. Your schema must match what's already in the DB, and you must **not** run migrations that drop or change shared tables/columns.

### Step 1: Get the same database URL

- Get **`DATABASE_URL`** from the person who owns the schema (same host, database, user, password). Put it in your backend's `.env`.
- You will run Prisma from **your** backend's folder (e.g. `cd your-backend`), not `backend2`.

### Step 2: Align your schema with the database (choose one)

**Option A – Copy schema and migrations from the other backend (recommended)**

- Get from the other person (or their repo):
  - **`prisma/schema.prisma`** (full file, or merge the models you need: at least Trend, StylingRule, MicroStore, and any table you use).
  - **`prisma/migrations/`** folder (entire folder).
- In **your** backend, replace (or merge into) your `prisma/schema.prisma` and add/copy the contents of `prisma/migrations/` so your project has the same migration history.
- Then go to Step 3.

**Option B – Introspect the existing database (schema only, no migrations)**

- In your backend folder:
  ```bash
  npx prisma db pull
  ```
  This overwrites your `schema.prisma` with the current DB structure. Use this if you don't want to use the other backend's migrations and only need a schema that matches the DB.
- Then run:
  ```bash
  npx prisma generate
  ```
  You're done; **do not** run `prisma migrate dev` or `deploy` for this DB. Your client will match the DB; you won't create or apply migrations for the shared DB.

### Step 3: If you use Option A (same migrations folder)

Run from **your** backend root (where `prisma/` lives):

```bash
npx prisma migrate status
```

- If it says **"X migration(s) pending"**:
  ```bash
  npx prisma migrate deploy
  ```
  If a migration **fails** with e.g. `relation "ModelConfig" already exists` or `relation "GeneratedImage" already exists`:
  1. Mark it as rolled back:
     ```bash
     npx prisma migrate resolve --rolled-back "MIGRATION_FOLDER_NAME"
     ```
  2. Mark it as applied (because the table already exists):
     ```bash
     npx prisma migrate resolve --applied "MIGRATION_FOLDER_NAME"
     ```
  3. Run `npx prisma migrate deploy` again for any next migration; repeat resolve if the next one also fails with "already exists".

- If it says **"Drift detected"** or migrations are out of sync:
  - **Do not** run `prisma migrate dev` if it would drop columns or tables.
  - Ask the other person which migrations are already applied. For each of those, run:
    ```bash
    npx prisma migrate resolve --applied "MIGRATION_FOLDER_NAME"
    ```

Then:

```bash
npx prisma generate
```

### Step 4: Never change the shared database in a breaking way

- **Do not** run `prisma migrate dev` if the preview would drop **Trend** columns (`source`, `strength`), drop the **StylingRule** table, or drop/recreate **MicroStore.sections**.
- If you need a **new** table or column only for your backend, coordinate with the other person. Ideally they add a migration in the canonical backend and you pull it, or you use a separate database for your-only tables.

### Summary for "different backend, same DB"

| Step | Action |
|------|--------|
| 1 | Use same **DATABASE_URL** in your `.env`. |
| 2 | Either **copy** schema (and migrations) from the other backend, or run **`prisma db pull`** so your schema matches the DB. |
| 3 | If you use their migrations: **`migrate deploy`**; if a migration fails with "already exists", use **`resolve --rolled-back`** then **`resolve --applied`** for that migration, then deploy again. |
| 4 | Run **`npx prisma generate`**. |
| 5 | **Never** apply a migration that drops shared columns/tables. |

---

## Quick reference

| Action                    | Person with correct schema | Colleague        |
|---------------------------|----------------------------|------------------|
| Use same branch           | Push schema + migrations   | Pull that branch |
| Same DATABASE_URL         | —                          | Use same .env    |
| Check status              | `prisma migrate status`    | Same             |
| Apply pending migrations  | `prisma migrate deploy`   | Same             |
| Fix “already applied”     | —                          | `migrate resolve --applied` |
| Update client only        | —                          | `prisma generate` |
| Create new migration      | Only if safe (no drops)    | Don’t            |
| Apply destructive migration | **Never**              | **Never**        |

---

## If you see “data loss” warnings

If Prisma shows warnings like:

- “The column source on the Trend table would be dropped”
- “You are about to drop the StylingRule table”
- “The sections column on the MicroStore table would be dropped and recreated”

Then **stop**. Do not run `prisma migrate dev` or apply that migration. Sync your `schema.prisma` and `prisma/migrations/` with the person who has the correct schema and follow the steps above again.
