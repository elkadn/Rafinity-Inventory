#!/bin/bash
set -euo pipefail

sqlplus -s "sys/${ORACLE_PASSWORD}@//localhost:1521/XEPDB1 as sysdba" <<SQL
whenever sqlerror exit failure
define APP_USER = '${APP_USER}'
define APP_PASSWORD = '${APP_USER_PASSWORD}'
@/opt/app-init/create_app_user.sql
exit
SQL

sqlplus -s "${APP_USER}/${APP_USER_PASSWORD}@//localhost:1521/XEPDB1" <<SQL
whenever sqlerror exit failure
@/opt/app-init/oracle_schema.sql
@/opt/app-init/create_initial_users.sql
exit
SQL
