// ─────────────────────────────────────────────
// 설정 읽기·저장
// ─────────────────────────────────────────────
const { DEFAULT_SETTINGS } = require('./seed');

// 설정값 하나를 글자로 읽음 (없으면 기본값)
function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

// 설정값 하나를 숫자로 읽음
function getNumber(db, key) {
  return Number(getSetting(db, key));
}

// 설정값 저장
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

module.exports = { getSetting, getNumber, setSetting };
