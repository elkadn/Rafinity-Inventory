-- Oracle 12c-compatible schema for the inventory scanner.
-- Run manually as the application schema user supplied by the company.
create table app_users (
  id varchar2(32) primary key,
  username varchar2(100) not null unique,
  password_hash varchar2(255) not null,
  nom varchar2(100) not null,
  prenom varchar2(100) not null,
  role varchar2(20) default 'scanner' not null,
  ip_poste varchar2(100),
  date_creation number(20,6) not null,
  statut varchar2(20) default 'actif' not null,
  constraint ck_app_users_role check (role in ('admin','scanner')),
  constraint ck_app_users_statut check (statut in ('actif','inactif'))
);

SELECT username, role,password_hash FROM app_users;

create table app_scans (
  id varchar2(32) primary key,
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  code varchar2(100) not null,
  method varchar2(20) not null,
  confidence number(10,6),
  scanned_at number(20,6) not null,
  scan_date varchar2(10) not null,
  inventory_date varchar2(10) not null,
  constraint ck_app_scans_method check (method in ('barcode','ocr','manuel')),
  constraint uq_app_scans_business unique (user_id, code, inventory_date)
);

create table app_config (
  id varchar2(100) primary key,
  inventory_date varchar2(10),
  label varchar2(255),
  set_at number(20,6),
  set_by_username varchar2(100)
);

create table app_deletions (
  id varchar2(32) primary key,
  scan_id varchar2(32) not null,
  code varchar2(100) not null,
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  inventory_date varchar2(10) not null,
  deleted_at number(20,6) not null,
  reason varchar2(1000),
  constraint uq_app_deletions_scan unique (scan_id)
);

create index ix_app_scans_inventory_user on app_scans (inventory_date, user_id);
create index ix_app_deletions_inventory_user on app_deletions (inventory_date, user_id);
create index ix_app_deletions_scan on app_deletions (scan_id);