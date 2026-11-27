-- Rule 4: a read-only role for the analysts. Roles are shared by every database on the server, so create it
-- only if it does not exist yet (another environment on the same server may have created it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyst') THEN
    CREATE ROLE analyst NOLOGIN;
  END IF;
END
$$;
GRANT SELECT ON customers, products, orders, daily_revenue TO analyst;
