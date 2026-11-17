// ─────────────────────────────────────────────
// 데이터베이스(SQLite) 파일을 열고, 필요한 표를 만드는 파일
// ─────────────────────────────────────────────
// - 데이터베이스 파일: data/lab.db (처음 실행할 때 자동으로 생김)
// - 시각은 모두 "2026-11-14T06:00:00.000Z" 같은 국제 표준 글자로 저장합니다.
//   (화면에 보여 줄 때만 한국 시간 "11월 14일 (토) 오후 3:00" 으로 바꿉니다)

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { seedIfEmpty, seedGuideExamples, seedKeywordExamples } = require('./seed');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'lab.db');

// 표를 만드는 SQL 문장들 (이미 있으면 건너뜀: IF NOT EXISTS)
const SCHEMA = `
-- ① 시약
CREATE TABLE IF NOT EXISTS reagents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,                       -- 시약 이름
  cas_number  TEXT,                                   -- 카스 번호 (예: 7647-01-0)
  barcode     TEXT,                                   -- 상품 바코드 번호 (없을 수 있음)
  hazard      TEXT    NOT NULL DEFAULT '일반'
              CHECK (hazard IN ('일반', '고위험')),    -- 위험 등급
  location    TEXT    NOT NULL DEFAULT '',            -- 보관 위치
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0), -- 남은 병 수
  memo        TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reagents_barcode ON reagents(barcode);
CREATE INDEX IF NOT EXISTS idx_reagents_cas     ON reagents(cas_number);

-- ② 시약 반출 기록
CREATE TABLE IF NOT EXISTS reagent_loans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reagent_id    INTEGER NOT NULL REFERENCES reagents(id),
  student_id    TEXT,                                 -- 학번 (1년 지나면 지울 수 있게 비울 수 있음)
  student_name  TEXT,                                 -- 이름
  purpose       TEXT    NOT NULL,                     -- 사용 목적
  status        TEXT    NOT NULL
                CHECK (status IN ('승인 대기','반출 중','연체','반납 완료','거절됨','자동 취소')),
  created_at    TEXT    NOT NULL,                     -- 신청한 시각
  approved_at   TEXT,                                 -- 승인된 시각 (일반 시약은 신청 시각과 같음)
  due_at        TEXT    NOT NULL,                     -- 반납 기한
  returned_at   TEXT,                                 -- 반납한 시각
  extended      INTEGER NOT NULL DEFAULT 0,           -- 연장했는지 (0: 안 함, 1: 함)
  reject_reason TEXT,                                 -- 거절 사유
  remaining_amount TEXT
                CHECK (remaining_amount IS NULL OR remaining_amount IN
                  ('가득','절반 이상','절반 미만','거의 없음','다 씀','기록 안 함')),
  due_soon_notified_at TEXT,                          -- "곧 반납 기한" 알림을 보낸 시각
  overdue_notified_at  TEXT,                          -- 연체 알림을 마지막으로 보낸 시각
  overdue_since        TEXT                           -- 연체가 시작된 시각 (경고음 중복 방지)
);
CREATE INDEX IF NOT EXISTS idx_loans_student ON reagent_loans(student_id);
CREATE INDEX IF NOT EXISTS idx_loans_status  ON reagent_loans(status);

-- ③ 재구매 목록
CREATE TABLE IF NOT EXISTS reorder_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reagent_id  INTEGER NOT NULL REFERENCES reagents(id),
  loan_id     INTEGER REFERENCES reagent_loans(id),  -- 어떤 반납 때문에 올라왔는지
  reason      TEXT    NOT NULL,                       -- 예: "반납 시 남은 양: 거의 없음"
  created_at  TEXT    NOT NULL,
  done_at     TEXT                                    -- "구매 완료"를 누른 시각 (비어 있으면 목록에 보임)
);

-- ④ 기구 (한 줄 = 기구 한 대)
CREATE TABLE IF NOT EXISTS equipment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,                     -- 기구 이름 (예: 배양기)
  unit_label    TEXT    NOT NULL DEFAULT '',          -- 같은 종류가 여러 대일 때 구분 (예: 1번(창가))
  location      TEXT    NOT NULL DEFAULT '',          -- 보관 위치
  photo         TEXT,                                 -- 사진 파일 이름 (선택)
  howto         TEXT    NOT NULL DEFAULT '[]',        -- 사용법: 단계별 글 목록 (JSON)
  checklist     TEXT    NOT NULL DEFAULT '[]',        -- 필수 확인 사항 목록 (JSON)
  cautions      TEXT    NOT NULL DEFAULT '[]',        -- 주의사항 목록 (JSON)
  time_options  TEXT    NOT NULL DEFAULT '[]',        -- 사용 시간 선택지: [{"label":"...","minutes":60}] (JSON)
  max_minutes   INTEGER NOT NULL CHECK (max_minutes > 0), -- 최대 사용 시간 (분)
  is_dangerous  INTEGER NOT NULL DEFAULT 0,           -- 위험 기구인지 (끝날 때 소리 + 안전 안내)
  status        TEXT    NOT NULL DEFAULT '사용 가능'
                CHECK (status IN ('사용 가능','사용 중','예약 대기','점검 중')),
  sample_notice INTEGER NOT NULL DEFAULT 0,           -- "교사 검토 필요 예시 내용" 표시를 보일지
  just_finished_at TEXT                               -- 방금 사용이 끝난 시각 (30분 안내용)
);

-- ⑤ 기구 사용 기록
CREATE TABLE IF NOT EXISTS equipment_uses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id),
  student_id    TEXT,
  student_name  TEXT,
  started_at    TEXT    NOT NULL,                     -- 사용 시작 시각
  ends_at       TEXT    NOT NULL,                     -- 끝나기로 한 시각
  ended_at      TEXT,                                 -- 실제로 끝난 시각 (사용 중이면 비어 있음)
  end_reason    TEXT CHECK (end_reason IS NULL OR end_reason IN ('시간 종료','일찍 종료','강제 종료')),
  extended      INTEGER NOT NULL DEFAULT 0,           -- 연장했는지
  ending_soon_notified INTEGER NOT NULL DEFAULT 0     -- "곧 사용 가능 (10분 남음)" 표시를 했는지
);
CREATE INDEX IF NOT EXISTS idx_uses_equipment ON equipment_uses(equipment_id, ended_at);

-- ⑥ 기구 대기열
CREATE TABLE IF NOT EXISTS equipment_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id   INTEGER NOT NULL REFERENCES equipment(id),
  student_id     TEXT,
  student_name   TEXT,
  joined_at      TEXT    NOT NULL,                    -- 대기 등록한 시각
  turn_started_at TEXT,                               -- 차례가 온 시각 (예약 대기 10분 계산용)
  status         TEXT    NOT NULL DEFAULT '대기'
                 CHECK (status IN ('대기','차례','사용 시작','넘어감','취소'))
);
CREATE INDEX IF NOT EXISTS idx_queue_equipment ON equipment_queue(equipment_id, status);

-- ⑦ 모델 분류 이름 ↔ 기구 연결 (11-3)
--    분류 이름 하나에 여러 줄 = 같은 종류 기구 여러 대
CREATE TABLE IF NOT EXISTS model_class_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name    TEXT    NOT NULL,                     -- 모델이 내놓는 분류 이름 (예: autoclave)
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  UNIQUE (class_name, equipment_id)
);

-- ⑧ 기구 인식 기록 (11-4, 탐구 보고서 자료)
CREATE TABLE IF NOT EXISTS recognition_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT    NOT NULL,
  predicted_class  TEXT,                              -- 모델이 1등으로 예측한 분류 이름
  confidence       REAL,                              -- 그 확신도 (0 ~ 1)
  top3             TEXT    NOT NULL DEFAULT '[]',     -- 상위 3개 후보 [{"className":"...","probability":0.62}] (JSON)
  decided_by       TEXT    NOT NULL
                   CHECK (decided_by IN ('자동 결정','후보에서 선택','직접 찾기')),
  confirmed_class  TEXT,                              -- 사용자가 최종 확인한 기구의 분류 이름
  confirmed_equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  model_version    TEXT                               -- 어떤 모델로 인식했는지 (가짜 모델이면 "연습용")
);

-- ⑨ 알림 기록 (관리자 화면 알림)
CREATE TABLE IF NOT EXISTS notifications (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT    NOT NULL,                         -- 예: 반출, 승인 요청, 연체, 재구매 필요
  message   TEXT    NOT NULL,
  sent_at   TEXT    NOT NULL,
  success   INTEGER NOT NULL DEFAULT 0,               -- 보내기 성공했는지
  error     TEXT                                      -- 실패했으면 이유
);

-- ⑩ 설정 (이름 = 값)
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- ⑫ 실험 주제 기록 (16단계) — 학생이 기구·기자재 화면에서 적은 "어떤 실험에 쓰나요?" (선택)
--    학번·이름은 저장하지 않음. 추천 기능이 "이 주제에 주로 사용한 기구"를 찾는 데 씀
CREATE TABLE IF NOT EXISTS topic_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL,
  lab_id       INTEGER,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  topic        TEXT    NOT NULL           -- 학생이 적은 주제 (100글자까지)
);
CREATE INDEX IF NOT EXISTS idx_topic_equipment ON topic_logs(equipment_id);

-- ⑪ 실험실 (13단계) — 생물실·물리실·화학실 …
CREATE TABLE IF NOT EXISTS labs (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,          -- 화면에 보이는 이름 (예: 생물실)
  code  TEXT NOT NULL UNIQUE,          -- 영어 짧은 이름 (예: bio) — 인식 모델 폴더 이름으로도 씀
  sort  INTEGER NOT NULL DEFAULT 0     -- 보여 주는 순서
);
`;

// 처음 넣는 실험실 3개 (관리자 화면에서 이름을 바꾸거나 더 만들 수 있음)
const DEFAULT_LABS = [['생물실', 'bio', 1], ['물리실', 'phys', 2], ['화학실', 'chem', 3]];

// 이미 만들어진 데이터베이스에 나중에 생긴 칸을 추가 (기존 데이터는 그대로 둠)
// - archived: 관리자가 "삭제"한 시약·기구. 지난 기록이 그 시약·기구를 가리키고 있어서
//   진짜로 지우지 않고 숨기기만 합니다. (기록·통계는 그대로 남음)
function migrate(db) {
  const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!hasColumn('reagents', 'archived')) db.exec('ALTER TABLE reagents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  if (!hasColumn('equipment', 'archived')) db.exec('ALTER TABLE equipment ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  // read_at: 관리자가 알림을 읽은 시각 (비어 있으면 안 읽음) — 8단계
  if (!hasColumn('notifications', 'read_at')) db.exec('ALTER TABLE notifications ADD COLUMN read_at TEXT');
  // lab_id: 어느 실험실 시약·기구인지 (13단계). 예전 데이터는 아래 fillLabIds 가 생물실로 채움
  if (!hasColumn('reagents', 'lab_id')) db.exec('ALTER TABLE reagents ADD COLUMN lab_id INTEGER REFERENCES labs(id)');
  if (!hasColumn('equipment', 'lab_id')) db.exec('ALTER TABLE equipment ADD COLUMN lab_id INTEGER REFERENCES labs(id)');
  if (!hasColumn('recognition_logs', 'lab_id')) db.exec('ALTER TABLE recognition_logs ADD COLUMN lab_id INTEGER');
  // kind: 기구 종류 (14단계) — '예약'(사용·대기·현황 관리) 또는 '안내'(사용법·주의사항만)
  if (!hasColumn('equipment', 'kind')) db.exec("ALTER TABLE equipment ADD COLUMN kind TEXT NOT NULL DEFAULT '예약'");
  // keywords: 이 기구가 쓰이는 실험·키워드 목록 (16단계, JSON 글 목록)
  if (!hasColumn('equipment', 'keywords')) db.exec("ALTER TABLE equipment ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'");
  // 실험실이 하나도 없으면 기본 3개를 넣음
  if (db.prepare('SELECT COUNT(*) n FROM labs').get().n === 0) {
    const add = db.prepare('INSERT INTO labs (name, code, sort) VALUES (?, ?, ?)');
    for (const l of DEFAULT_LABS) add.run(...l);
  }
}

// 실험실이 비어 있는 시약·기구는 첫 번째 실험실(생물실)로 정함
// (13단계 전에 만든 데이터와 예시 데이터가 여기에 해당)
function fillLabIds(db) {
  const first = db.prepare('SELECT id FROM labs ORDER BY sort, id LIMIT 1').get();
  if (!first) return;
  db.prepare('UPDATE reagents SET lab_id = ? WHERE lab_id IS NULL').run(first.id);
  db.prepare('UPDATE equipment SET lab_id = ? WHERE lab_id IS NULL').run(first.id);
}

// 데이터베이스를 열고 표와 예시 데이터를 준비해서 돌려줌
// file 에 ':memory:' 를 넣으면 파일 없이 메모리에만 만듦 (테스트용)
function openDb(file = DEFAULT_FILE) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // 여러 화면이 동시에 읽고 써도 안전하게
  db.pragma('foreign_keys = ON');  // 없는 시약·기구 번호를 기록에 넣지 못하게
  db.exec(SCHEMA);
  migrate(db);
  seedIfEmpty(db);
  fillLabIds(db);
  seedGuideExamples(db);
  seedKeywordExamples(db);
  return db;
}

// 서버 전체가 함께 쓰는 데이터베이스 하나 (처음 부를 때 열림)
let shared = null;
function getDb() {
  if (!shared) shared = openDb();
  return shared;
}

module.exports = { openDb, getDb, DEFAULT_FILE };
