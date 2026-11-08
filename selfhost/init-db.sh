#!/bin/sh
# Runs once, as the database superuser, when the data volume is first created
# (the postgres image's /docker-entrypoint-initdb.d). It does what an
# administrator does by hand on a managed Postgres (docs/CONTROL-PLANE.md,
# "Database"): the two roles the schema's row-level security is written
# against, and an ordinary login role for the app that owns the database but
# is not a superuser. The app creates its tables itself at every start.
#
# The password is passed to psql as a variable and quoted by psql (:'name'),
# so no character in it can end the statement.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE ohsms_browser NOLOGIN;
CREATE ROLE ohsms_worker NOLOGIN BYPASSRLS;
CREATE ROLE ehs_app LOGIN PASSWORD :'app_password';
GRANT ohsms_browser, ohsms_worker TO ehs_app;
ALTER DATABASE ehs OWNER TO ehs_app;
ALTER SCHEMA public OWNER TO ehs_app;
SQL
