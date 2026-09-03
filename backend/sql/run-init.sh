#!/bin/bash
set -euo pipefail

sqlplus -s "${APP_USER}/${APP_USER_PASSWORD}@//localhost:1521/XEPDB1" <<SQL
whenever sqlerror exit failure
@/opt/app-init/oracle_schema.sql
@/opt/app-init/create_initial_users.sql
exit
SQL
