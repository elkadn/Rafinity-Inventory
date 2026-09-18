-- Run once on an existing Oracle database to enable admin video history.
create table app_video_jobs (
  id varchar2(32) primary key,
  batch_id varchar2(32) not null,
  admin_id varchar2(32) not null references app_users(id),
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  filename varchar2(255) not null,
  inventory_date varchar2(10) not null,
  created_at number(20,6) not null,
  started_at number(20,6) not null,
  finished_at number(20,6) not null,
  duration_seconds number(20,3) not null,
  total_frames_processed number(10) not null,
  total_frames_skipped_blur number(10) not null,
  total_added number(10) not null,
  total_duplicates number(10) not null
);

create table app_video_job_codes (
  id varchar2(32) primary key,
  job_id varchar2(32) not null references app_video_jobs(id),
  user_id varchar2(32) not null references app_users(id),
  username varchar2(100) not null,
  code varchar2(100) not null,
  frame_hits number(10) not null,
  added number(1) not null,
  constraint uq_app_video_job_codes unique (job_id, user_id, code)
);

create index ix_app_video_jobs_date on app_video_jobs (inventory_date, finished_at);
create index ix_app_video_jobs_batch on app_video_jobs (batch_id);
create index ix_app_video_job_codes_job on app_video_job_codes (job_id);