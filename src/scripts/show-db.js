// ─────────────────────────────────────────────
// 데이터베이스 내용을 터미널에 표로 보여 주는 확인용 프로그램
// 실행: npm run db:show
// ─────────────────────────────────────────────
const { getDb } = require('../db');
const db = getDb();

// 표 이름과 각 표의 줄 수
console.log('\n■ 표 목록과 줄 수');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
console.table(tables.map((t) => ({ 표: t.name, 줄수: db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n })));

console.log('\n■ 시약');
console.table(db.prepare('SELECT id, name AS 이름, cas_number AS 카스번호, hazard AS 위험등급, location AS 위치, quantity AS 병수 FROM reagents').all());

console.log('\n■ 기구');
console.table(db.prepare(`SELECT id, name AS 이름, unit_label AS 구분, status AS 상태,
  max_minutes AS 최대분, is_dangerous AS 위험, time_options AS 시간선택지 FROM equipment`).all());

console.log('\n■ 모델 분류 이름 ↔ 기구 연결');
console.table(db.prepare(`SELECT m.class_name AS 분류이름, e.id AS 기구번호, e.name || ' ' || e.unit_label AS 기구
  FROM model_class_map m JOIN equipment e ON e.id = m.equipment_id ORDER BY m.class_name`).all());

console.log('\n■ 설정');
console.table(db.prepare('SELECT key AS 이름, value AS 값 FROM settings').all());

console.log('\n■ 고압 멸균기 사용법 (예시)');
console.log(JSON.parse(db.prepare("SELECT howto FROM equipment WHERE name LIKE '고압%'").get().howto).join('\n'));
