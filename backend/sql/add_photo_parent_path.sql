-- Run once on an existing Oracle database to store the configured photo
-- parent folder path in APP_CONFIG.
alter table app_config add photo_parent_path varchar2(1000);