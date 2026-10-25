-- PDF 上传记录补齐属主；历史数据在首次带 JWT 访问时自动认领
ALTER TABLE link_uploads ADD COLUMN owner TEXT;

