-- migration14: 用户语言偏好（zh/en），空串表示未设置（跟随浏览器语言）
ALTER TABLE user_preferences ADD COLUMN lang TEXT NOT NULL DEFAULT '';
