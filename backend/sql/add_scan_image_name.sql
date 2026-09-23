-- Run once on an existing database to keep the original uploaded image name
-- on scans created by bulk photo imports.
alter table app_scans add image_name varchar2(255);