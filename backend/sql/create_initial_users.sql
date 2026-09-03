

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
