-- Ensure the shadow database used by `prisma migrate dev` exists.
-- Executed once at first container startup by the Postgres entrypoint.

SELECT 'CREATE DATABASE workpulse_shadow OWNER workpulse'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'workpulse_shadow')\gexec
