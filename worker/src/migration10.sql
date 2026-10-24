-- 倒计时组件共享事项池（所有倒计时组件实例共用一套事项）
ALTER TABLE user_preferences ADD COLUMN countdown_events TEXT NOT NULL DEFAULT '[]';
