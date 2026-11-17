// ─────────────────────────────────────────────
// 테스트 도우미
// ─────────────────────────────────────────────
// - freshDb(): 파일 없이 메모리에만 만든 새 데이터베이스 (진짜 data/lab.db 는 건드리지 않음)
// - at('2026-11-14 18:01'): "지금은 한국 시간으로 이때다"라고 정함 (clock.js 의 setNow 사용)

const { openDb } = require('../src/db');
const clock = require('../src/clock');

// queue: 대기 기능 켜기 (실제 기본값은 꺼짐. 대기 규칙을 시험하는 예전 테스트를 위해 기본으로 켜 둠)
function freshDb({ queue = true } = {}) {
  const db = openDb(':memory:');
  if (queue) db.prepare("UPDATE settings SET value = '1' WHERE key = 'queue_enabled'").run();
  return db;
}

// 한국 시간 글자 → 가짜 현재 시각으로 정함
function at(kstText) {
  clock.setNow(new Date(kstText.replace(' ', 'T') + ':00+09:00'));
}

// 분 단위로 시간 흘려보내기
function after(minutes) {
  clock.advanceMinutes(minutes);
}

// 테스트가 끝나면 진짜 시각으로 되돌림
function resetClock() {
  clock.setNow(null);
}

// 자주 쓰는 학생 정보
const student = (id, name = '테스트') => ({ studentId: id, studentName: name });

// 예시 데이터의 번호 (seed.js 순서)
const REAGENT = { 염산: 1, 황산: 2, 에탄올: 6, 아세톤: 7, 염화나트륨: 8 };
const EQUIP = { 멸균기: 1, 배양기1: 2, 배양기2: 3, 원심분리기: 4, 건조기: 5 };
const ALL_CHECKED = { 1: [0, 1, 2, 3, 4], 2: [0, 1, 2], 3: [0, 1, 2], 4: [0, 1, 2], 5: [0, 1, 2], 6: [0, 1, 2] };

module.exports = { freshDb, at, after, resetClock, student, REAGENT, EQUIP, ALL_CHECKED };
