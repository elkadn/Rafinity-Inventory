-- Create the initial application accounts in Oracle 12c.
-- Run this script as the schema owner that owns APP_USERS.
--
-- Initial passwords:
--   admin   : Admin123!
--   scanner1: Scanner123!
--   scanner2: Scanner456!
--
-- Change these passwords immediately after the first login.
-- The MERGE statements make this script safe to run again: existing
-- usernames are not overwritten.

merge into app_users target
using (
  select
    'admin' username,
    '$2b$12$7D7h2qKZex1/kyzG6pTJbe0h2e495ZL9FvkVv7rgt7BAkiDYKgkq6' password_hash,
    'Admin' nom,
    'Principal' prenom,
    'admin' role,
    cast(null as varchar2(100)) ip_poste
  from dual
) source
on (target.username = source.username)
when not matched then insert (
  id, username, password_hash, nom, prenom, role, ip_poste,
  date_creation, statut
) values (
  rawtohex(sys_guid()), source.username, source.password_hash, source.nom,
  source.prenom, source.role, source.ip_poste,
  (sysdate - date '1970-01-01') * 86400, 'actif'
);

merge into app_users target
using (
  select
    'scanner1' username,
    '$2b$12$GFpOVXzFt5Z/FUeRWIKfzevD0bb3HKjwt/3EPk8I5T9mnF54WKzDi' password_hash,
    'Scanner' nom,
    'Un' prenom,
    'scanner' role,
    cast(null as varchar2(100)) ip_poste
  from dual
) source
on (target.username = source.username)
when not matched then insert (
  id, username, password_hash, nom, prenom, role, ip_poste,
  date_creation, statut
) values (
  rawtohex(sys_guid()), source.username, source.password_hash, source.nom,
  source.prenom, source.role, source.ip_poste,
  (sysdate - date '1970-01-01') * 86400, 'actif'
);

merge into app_users target
using (
  select
    'scanner2' username,
    '$2b$12$YSQ/w.Clm4R5.WXzvAUhgugc15jXVK966YvW7by0.afUk/jpoRLO6' password_hash,
    'Scanner' nom,
    'Deux' prenom,
    'scanner' role,
    cast(null as varchar2(100)) ip_poste
  from dual
) source
on (target.username = source.username)
when not matched then insert (
  id, username, password_hash, nom, prenom, role, ip_poste,
  date_creation, statut
) values (
  rawtohex(sys_guid()), source.username, source.password_hash, source.nom,
  source.prenom, source.role, source.ip_poste,
  (sysdate - date '1970-01-01') * 86400, 'actif'
);

commit;

select username, role, statut
from app_users
where username in ('admin', 'scanner1', 'scanner2')
order by username;
