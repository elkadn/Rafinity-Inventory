-- Run once if app_video_jobs was created before grouped video history.
alter table app_video_jobs add (batch_id varchar2(32));
update app_video_jobs set batch_id = id where batch_id is null;
alter table app_video_jobs modify (batch_id varchar2(32) not null);
create index ix_app_video_jobs_batch on app_video_jobs (batch_id);