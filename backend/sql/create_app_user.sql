whenever sqlerror exit failure

begin
  if sys_context('USERENV', 'CON_NAME') <> 'XEPDB1' then
    raise_application_error(-20001, 'This script must run in XEPDB1, not the CDB');
  end if;
end;
/

declare
  user_count number;
begin
  select count(*) into user_count
  from dba_users
  where username = upper('&APP_USER');

  if user_count = 0 then
    execute immediate 'create user &APP_USER identified by "&APP_PASSWORD"';
  end if;
end;
/

alter user &APP_USER quota unlimited on users;
grant create session, create table to &APP_USER;