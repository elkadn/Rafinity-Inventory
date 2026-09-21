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

create table app_photo_jobs (
  id varchar2(32) primary key,
  admin_id varchar2(32) not null references app_users(id),
  inventory_date varchar2(10) not null,
  created_at number(20,6) not null,
  finished_at number(20,6) not null,
  status varchar2(20) not null,
  total_photos number(10) not null,
  processed_photos number(10) not null,
  codes_found number(10) not null,
  added number(10) not null,
  duplicates number(10) not null,
  skipped number(10) not null,
  error varchar2(4000),
  constraint ck_app_photo_jobs_status check (status = 'completed')
);

create table app_photo_job_users (
  id varchar2(32) primary key,
  job_id varchar2(32) not null references app_photo_jobs(id),
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  total_photos number(10) not null,
  processed_photos number(10) not null,
  codes_found number(10) not null,
  added number(10) not null,
  duplicates number(10) not null,
  skipped number(10) not null,
  constraint uq_app_photo_job_users unique (job_id, user_id)
);

create table app_photo_job_codes (
  id varchar2(32) primary key,
  job_id varchar2(32) not null references app_photo_jobs(id),
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  code varchar2(100) not null,
  constraint uq_app_photo_job_codes unique (job_id, user_id, code)
);

create index ix_app_photo_jobs_date on app_photo_jobs (inventory_date, finished_at);
create index ix_app_photo_job_users_job on app_photo_job_users (job_id);
create index ix_app_photo_job_codes_job on app_photo_job_codes (job_id);

