# BUY-7642: Atlas Read-Only Postgres User — Provisioning Runbook

## Overview

Atlas (schema completeness baseline tooling) needs a read-only Postgres user to run `SELECT` queries against the full schema without write access.

---

## 1. GCP Secret Manager — Create the Password Secret

Run once, in the **production** GCP project (`buywhere-production`):

```bash
# Create the secret (one-time)
gcloud secrets create atlas-readonly-db-password \
  --replication-policy=automatic \
  --project=buywhere-production

# Add a version with your generated password
PASSWORD=$(openssl rand -base64 32)
echo -n "$PASSWORD" | gcloud secrets versions add \
  atlas-readonly-db-password --data-file=- \
  --project=buywhere-production
```

> **Note:** If you need to rotate the password later, add a new version and update references.

---

## 2. Grant Cloud Run Service Account Access to the Secret

The `buywhere-api-sa` service account needs `roles/secretmanager.secretAccessor` on the new secret:

```bash
gcloud secrets add-iam-policy-binding atlas-readonly-db-password \
  --member="serviceAccount:buywhere-api-sa@buywhere-production.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=buywhere-production
```

This is analogous to the existing pattern for `buywhere-admin-api-key` etc. (see `fix-secret-manager-iam.yml`).

---

## 3. Provision the Database User (Cloud SQL Postgres)

Connect to the Cloud SQL instance as a superuser and run:

```sql
-- 1. Create the login role (run once per database)
CREATE USER atlas_readonly WITH PASSWORD '...';   -- use the password from Secret Manager

-- 2. Grant CONNECT on the target database
GRANT CONNECT ON DATABASE buywhere TO atlas_readonly;

-- 3. Grant USAGE on public schema (required to see tables)
GRANT USAGE ON SCHEMA public TO atlas_readonly;

-- 4. Grant SELECT on all existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO atlas_readonly;

-- 5. Grant SELECT on all future tables automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO atlas_readonly;
```

**Note:** `CREATE USER` is not available in the regular app migration (`migrate.sql`) because the app pool connects as `buywhere` (not a superuser). This step must be run manually with a superuser connection (e.g., via `psql` or Cloud SQL Auth Proxy).

**Which instance?**
- Production: `buywhere-production:asia-southeast1:buywhere-db`
- Staging: `buywhere-staging:asia-southeast1:buywhere-staging`

---

## 4. Consumption by Atlas Tooling

The Atlas tooling should connect using an env var e.g.:

```
ATLAS_DATABASE_URL=postgresql://atlas_readonly:<password>@/buywhere?host=/cloudsql/buywhere-production:asia-southeast1:buywhere-db
```

Or via Unix socket when running on Cloud Run (same pattern as `DATABASE_URL`):
```
ATLAS_DATABASE_URL=postgresql://atlas_readonly:<password>@localhost/buywhere
```
(with `run.googleapis.com/cloudsql-instances` annotation routing the connection through the Cloud SQL Auth Proxy)

---

## 5. Verify Read-Only Access

```sql
-- Should succeed (read)
SELECT count(*) FROM products;

-- Should fail (write)
DELETE FROM products WHERE id = 'any';  -- ERROR: must be owner of table "products"
```

---

## 6. Rotation Procedure

1. Add new secret version in GCP Secret Manager
2. Update Cloud SQL user password:
   ```sql
   ALTER USER atlas_readonly WITH PASSWORD 'new-password';
   ```
3. Update the secret version data:
   ```bash
   echo -n "new-password" | gcloud secrets versions add \
     atlas-readonly-db-password --data-file=- \
     --project=buywhere-production
   ```
4. Restart the Atlas tooling pod/job to pick up the new password

---

## References

- Existing GCP IAM secret pattern: `.github/workflows/fix-secret-manager-iam.yml`
- Cloud SQL connection: `deploy/gcp/api-service.yaml` (annotation `run.googleapis.com/cloudsql-instances`)
- Database config: `api/src/config.ts`
