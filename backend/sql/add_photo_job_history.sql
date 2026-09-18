-- Run once on an existing Oracle database created before photo-job history.
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
