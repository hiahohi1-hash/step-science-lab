// ─────────────────────────────────────────────
// 기구 인식 (11-2 ~ 11-4) — 서버 쪽
// ─────────────────────────────────────────────
// - 판정 규칙(2초·80%·후보 3개·기구 아님)은 화면과 같은 파일 public/js/recognition-core.js 를 그대로 씀
// - 모델 분류 이름 ↔ 기구 연결 표 읽기
// - 인식 기록 저장 (탐구 보고서용 정확도 자료)

const { createJudge, DEFAULTS } = require('../../public/js/recognition-core.js');
const { now } = require('../clock');
const { getSetting, getNumber } = require('../settings');
const { RuleError, checkId } = require('./common');
const { displayName } = require('./equipmentRules');
const { photoUrl } = require('./photo');

// 화면이 인식할 때 필요한 정보: 설정값 + 분류 이름별 기구 목록
// labId 를 주면 그 실험실 기구만 연결 표에 넣음 (13단계: 태블릿은 자기 실험실 기구만 인식)
function recognitionConfig(db, labId = null) {
  const rows = db.prepare(`SELECT m.class_name, e.id, e.name, e.unit_label, e.status, e.photo FROM model_class_map m
                           JOIN equipment e ON e.id = m.equipment_id
                           WHERE e.archived = 0 AND (? IS NULL OR e.lab_id = ?) ORDER BY e.unit_label, e.id`).all(labId, labId);
  const classes = {};
  for (const r of rows) {
    (classes[r.class_name] ||= []).push({ id: r.id, name: r.name, unitLabel: r.unit_label, displayName: displayName(r), status: r.status, photoUrl: photoUrl(r.photo) });
  }
  // 15단계: 이 실험실 모델 파일이 있는 주소 (없으면 null → 태블릿이 연습 모드)
  const { modelInfo } = require('./recognitionAdmin');
  const model = modelInfo(db, labId);
  return {
    modelBase: model.base,
    modelFolder: model.folder,
    modelVersion: model.version,
    threshold: getNumber(db, 'recognition_threshold'),
    holdSeconds: getNumber(db, 'recognition_hold_seconds'),
    candidateSeconds: getNumber(db, 'recognition_candidate_seconds'),
    notEquipmentClass: getSetting(db, 'not_equipment_class'),
    classes, // { autoclave: [{ id, displayName, … }], incubator: [ 1번, 2번 ] … }
  };
}

const DECIDED_BY = ['자동 결정', '후보에서 선택', '직접 찾기'];

// 인식 기록 저장 (11-4): 모델이 예측한 것 + 사용자가 최종 확인한 기구
function saveLog(db, data) {
  const decidedBy = DECIDED_BY.includes(data.decidedBy) ? data.decidedBy : null;
  if (!decidedBy) throw new RuleError('인식 기록 형식이 올바르지 않아요.');
  const equipmentId = checkId(data.confirmedEquipmentId, '기구');
  const eq = db.prepare('SELECT id FROM equipment WHERE id = ?').get(equipmentId);
  if (!eq) throw new RuleError('그 기구를 찾을 수 없어요.', '', 404);
  // 사용자가 확인한 기구의 분류 이름은 연결 표에서 찾음 (화면이 보낸 값을 믿지 않음)
  const map = db.prepare('SELECT class_name FROM model_class_map WHERE equipment_id = ? LIMIT 1').get(equipmentId);
  const labId = (db.prepare('SELECT lab_id FROM equipment WHERE id = ?').get(equipmentId) || {}).lab_id || null;
  const clip = (s, n) => (s === null || s === undefined ? null : String(s).slice(0, n));
  const conf = Number(data.confidence);
  const top3 = (Array.isArray(data.top3) ? data.top3 : []).slice(0, 3).map((p) => ({
    className: clip(p && p.className, 60), probability: Math.max(0, Math.min(1, Number(p && p.probability) || 0)),
  }));
  db.prepare(`INSERT INTO recognition_logs (created_at, predicted_class, confidence, top3, decided_by, confirmed_class, confirmed_equipment_id, model_version, lab_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    now().toISOString(), clip(data.predictedClass, 60), Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
    JSON.stringify(top3), decidedBy, map ? map.class_name : null, equipmentId, clip(data.modelVersion, 80), labId,
  );
}

module.exports = { createJudge, DEFAULTS, recognitionConfig, saveLog };
