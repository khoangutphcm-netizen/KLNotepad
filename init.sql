CREATE DATABASE IF NOT EXISTS notepad_final;
USE notepad_final;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  profile_image LONGTEXT,
  is_verified TINYINT(1) DEFAULT 0,
  activation_token VARCHAR(255),
  reset_token VARCHAR(255),
  reset_token_expires DATETIME
);

CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  title VARCHAR(255),
  content TEXT,
  attachments LONGTEXT,
  note_color VARCHAR(10) DEFAULT '#ffffff',
  password_hash VARCHAR(255),
  pinned TINYINT(1) DEFAULT 0,
  pinned_at DATETIME,
  updated_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS labels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  name VARCHAR(100),
  color VARCHAR(10) DEFAULT '#6b7280',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_labels (
  note_id INT,
  label_id INT,
  PRIMARY KEY (note_id, label_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_shares (
  note_id INT,
  shared_with_user_id INT,
  permission ENUM('read', 'edit') DEFAULT 'read',
  shared_at DATETIME,
  PRIMARY KEY (note_id, shared_with_user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT PRIMARY KEY,
  font_size INT DEFAULT 16,
  theme VARCHAR(10) DEFAULT 'light',
  note_bg_color VARCHAR(10) DEFAULT '#ffffff',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);