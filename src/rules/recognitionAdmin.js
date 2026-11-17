// ─────────────────────────────────────────────
// 관리자: 모델과 기구 연결 (11-3) + 인식 정확도 (11-4)
// ─────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { getSetting, getNumber, setSetting } = require('../settings');
const { RuleError, checkId } = require('./common');
const { displayName } = require('./equipmentRules');

let MODEL_DIR = path.join(__dirname, '..', '..', 'public', 'model');
// (테스트 전용) 모델 폴더 위치를 임시 폴더로 바꿈 → 테스트가 진짜 public/model 을 건드리지 않게
function setModelDirForTest(dir) { MODEL_DIR = dir; }
const CLASS_NAME = /^[\p{L}\p{N} _.\-()]{1,60}$/u; // 분류 이름: 글자·숫자·공백·_ . - ( ) 만, 60글자까지

// ── 15단계: 실험실마다 모델 폴더 ──
// public/model/<실험실 영어 코드>/ 에 model.json, metadata.json, weights.bin
// 예전 방식(public/model/ 바로 아래)에 넣은 모델은 첫 번째 실험실(생물실) 모델로 계속 인정
const FILES = ['model.json', 'metadata.json', 'weights.bin'];
const CODE = /^[a-z][a-z0-9_-]{1,19}$/; // labs.js 와 같은 규칙 (폴더 이름으로 안전한 글자만)

function readModelDir(dir) {
  const files = FILES.map((f) => ({ name: f, exists: fs.existsSync(path.join(dir, f)) }));
  const metaPath = path.join(dir, 'metadata.json');
  let labels = null;
  let version = null;
  let error = null;
  if (fs.existsSync(metaPath)) {
    try {
      if (fs.statSync(metaPath).size > 1024 * 1024) throw new Error('too big');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!Array.isArray(meta.labels)) throw new Error('no labels');
      labels = meta.labels.map((l) => String(l));
      version = `${meta.modelName || 'model'} ${meta.timeStamp || ''}`.trim();
    } catch (e) {
      error = 'metadata.json 을 읽지 못했어요. 티처블 머신에서 내보낸 파일인지 확인해 주세요.';
    }
  }
  return { files, labels, version, error, complete: files.every((x) => x.exists) && !!labels };
}

// 실험실 하나의 모델 정보 (labId 가 없으면 첫 번째 실험실)
function modelInfo(db, labId) {
  const lab = labId
    ? db.prepare('SELECT id, name, code FROM labs WHERE id = ?').get(labId)
    : db.prepare('SELECT id, name, code FROM labs ORDER BY sort, id LIMIT 1').get();
  if (!lab || !CODE.test(lab.code)) return { kind: 'fake', files: [], labels: null, missingFiles: FILES, folder: null, base: null };
  const first = db.prepare('SELECT id FROM labs ORDER BY sort, id LIMIT 1').get();
  const dir = path.join(MODEL_DIR, lab.code);
  let info = readModelDir(dir);
  let base = `/model/${lab.code}/`;
  let legacy = false;
  // 실험실 폴더에 모델이 없고 첫 번째 실험실이면 → 예전 위치(public/model/) 확인
  if (!info.complete && first && first.id === lab.id) {
    const old = readModelDir(MODEL_DIR);
    if (old.complete) { info = old; base = '/model/'; legacy = true; }
  }
  return {
    kind: info.complete ? 'real' : 'fake',
    labId: lab.id, labName: lab.name,
    folder: legacy ? 'public/model/' : `public/model/${lab.code}/`,
    base: info.complete ? base : null, // 태블릿이 모델을 불러올 주소 (없으면 연습 모드)
    legacy,
    files: info.files, labels: info.labels, version: info.version, error: info.error,
    missingFiles: info.files.filter((x) => !x.exists).map((x) => x.name),
  };
}

// 서버가 켜질 때 실험실마다 모델 폴더를 만들어 둠 (어디에 넣을지 헷갈리지 않게)
function ensureModelFolders(db) {
  for (const l of db.prepare('SELECT code FROM labs').all()) {
    if (CODE.test(l.code)) fs.mkdirSync(path.join(MODEL_DIR, l.code), { recursive: true });
  }
}

// ── 연결 표 화면에 필요한 모든 것 (실험실 하나 기준) ──
function classMapView(db, labId) {
  const model = modelInfo(db, labId);
  const lab = model.labId;
  const notEq = getSetting(db, 'not_equipment_class');
  const equipment = db.prepare('SELECT id, name, unit_label, kind FROM equipment WHERE archived = 0 AND lab_id = ? ORDER BY name, unit_label, id').all(lab)
    .map((e) => ({ id: e.id, displayName: displayName(e) + (e.kind === '안내' ? ' 📘' : '') }));
  const rows = db.prepare(`SELECT m.class_name, m.equipment_id FROM model_class_map m JOIN equipment e ON e.id = m.equipment_id
                           WHERE e.archived = 0 AND e.lab_id = ?`).all(lab);
  const map = {};
  for (const r of rows) (map[r.class_name] ||= []).push(r.equipment_id);

  // 화면에 보여 줄 분류 이름: 모델에 있는 것 + 연결 표에만 있는 것
  const names = [...new Set([...(model.labels || []), ...Object.keys(map)])].filter((c) => c !== notEq);
  const classes = names.map((c) => ({
    className: c,
    inModel: model.labels ? model.labels.includes(c) : null,
    equipmentIds: map[c] || [],
  }));

  // ⚠ 경고 (11-3: 새 모델의 분류 이름 중 연결 표에 없는 것)
  const warnings = [];
  const tag = `[${model.labName}] `;
  if (model.labels) {
    const unmapped = model.labels.filter((l) => l !== notEq && !(map[l] && map[l].length));
    if (unmapped.length) warnings.push({ type: 'unmapped', text: `${tag}모델에 있지만 기구와 연결되지 않은 분류 이름: ${unmapped.join(', ')}`, hint: '아래 표에서 기구를 연결해 주세요. 연결하지 않으면 그 분류는 "기구 아님"처럼 무시돼요.' });
    if (!model.labels.includes(notEq)) warnings.push({ type: 'noNotEq', text: `${tag}모델에 "기구 아님" 분류(${notEq})가 없어요.`, hint: '티처블 머신에 기구가 아닌 사진(책상, 벽, 사람 손 등) 분류를 만들거나, 아래에서 "기구 아님" 분류 이름을 모델에 맞게 바꿔 주세요.' });
    const stale = Object.keys(map).filter((c) => !model.labels.includes(c));
    if (stale.length) warnings.push({ type: 'stale', text: `${tag}연결 표에는 있지만 지금 모델에는 없는 분류 이름: ${stale.join(', ')}`, hint: '모델에서 이름을 바꿨다면 새 이름으로 다시 연결하고, 옛 이름은 연결을 모두 풀어 주세요.' });
  }
  const mappedIds = new Set(rows.map((r) => r.equipment_id));
  const notRecognizable = equipment.filter((e) => !mappedIds.has(e.id));
  if (notRecognizable.length) warnings.push({ type: 'noClass', text: `카메라로 인식할 수 없는 기구: ${notRecognizable.map((e) => e.displayName).join(', ')}`, hint: '이 기구는 "기구 직접 찾기"로만 고를 수 있어요. 인식하려면 모델에 분류를 만들고 여기서 연결하세요.' });

  return {
    labId: lab, model, notEquipmentClass: notEq, equipment, classes, warnings,
    settings: {
      recognition_threshold: getNumber(db, 'recognition_threshold'),
      recognition_hold_seconds: getNumber(db, 'recognition_hold_seconds'),
      recognition_candidate_seconds: getNumber(db, 'recognition_candidate_seconds'),
    },
  };
}

// 연결 경고 개수 — 모든 실험실을 합쳐서 (관리자 요약 화면에 띄우는 용도)
function classMapWarningCount(db) {
  return db.prepare('SELECT id FROM labs').all()
    .reduce((n, l) => n + classMapView(db, l.id).warnings.filter((w) => w.type !== 'noClass').length, 0);
}

// ── 분류 이름 하나의 연결 바꾸기 (기구 여러 대 가능) ──
function saveClassMap(db, className, equipmentIds, labId) {
  const lab = labId ? checkId(labId, '실험실') : (db.prepare('SELECT id FROM labs ORDER BY sort, id LIMIT 1').get() || {}).id;
  const c = String(className ?? '').trim();
  if (!CLASS_NAME.test(c)) throw new RuleError('분류 이름이 올바르지 않아요.', '티처블 머신의 분류 이름과 똑같이, 60글자 이하로 써 주세요. (예: autoclave)');
  if (c === getSetting(db, 'not_equipment_class')) throw new RuleError('"기구 아님" 분류에는 기구를 연결할 수 없어요.');
  const ids = [...new Set((Array.isArray(equipmentIds) ? equipmentIds : []).map((x) => checkId(x, '기구')))];
  const exists = db.prepare('SELECT id FROM equipment WHERE id = ? AND archived = 0 AND lab_id = ?');
  for (const id of ids) if (!exists.get(id, lab)) throw new RuleError('이 실험실에 없는 기구가 들어 있어요.', '화면을 새로 고쳐 주세요.');
  db.transaction(() => {
    // 이 실험실 기구의 연결만 지우고 다시 넣음 (다른 실험실의 같은 분류 이름은 그대로)
    db.prepare('DELETE FROM model_class_map WHERE class_name = ? AND equipment_id IN (SELECT id FROM equipment WHERE lab_id = ?)').run(c, lab);
    const add = db.prepare('INSERT INTO model_class_map (class_name, equipment_id) VALUES (?, ?)');
    for (const id of ids) add.run(c, id);
  })();
  return { className: c, equipmentIds: ids };
}

// ── 인식 설정 저장 ("기구 아님" 이름, 확신도 기준, 시간) ──
function saveRecognitionSettings(db, data) {
  const notEq = String(data.not_equipment_class ?? '').trim();
  if (!CLASS_NAME.test(notEq)) throw new RuleError('"기구 아님" 분류 이름이 올바르지 않아요.', '티처블 머신의 분류 이름과 똑같이 써 주세요.');
  if (db.prepare('SELECT 1 FROM model_class_map WHERE class_name = ?').get(notEq)) {
    throw new RuleError(`"${notEq}"에는 기구가 연결되어 있어서 "기구 아님"으로 정할 수 없어요.`, '먼저 연결을 풀어 주세요.');
  }
  const th = Number(data.recognition_threshold);
  const hold = Number(data.recognition_hold_seconds);
  const cand = Number(data.recognition_candidate_seconds);
  if (!(th >= 0.5 && th <= 0.99)) throw new RuleError('확신도 기준은 50% ~ 99% 사이로 정해 주세요.');
  if (!(hold >= 1 && hold <= 10)) throw new RuleError('연속 인식 시간은 1 ~ 10초로 정해 주세요.');
  if (!(cand > hold && cand <= 30)) throw new RuleError('후보를 보여 줄 시간은 연속 인식 시간보다 길고 30초 이하여야 해요.');
  db.transaction(() => {
    setSetting(db, 'not_equipment_class', notEq);
    setSetting(db, 'recognition_threshold', String(Math.round(th * 100) / 100));
    setSetting(db, 'recognition_hold_seconds', String(hold));
    setSetting(db, 'recognition_candidate_seconds', String(cand));
  })();
}

// ═════════════════ 인식 정확도 (11-4) ═════════════════
const LOW_ACCURACY = 0.8; // 이보다 낮으면 "사진을 더 찍어 다시 학습시키세요"
const MIN_SAMPLES = 5;    // 기록이 이보다 적으면 정확도를 믿기 어려움

function accuracy(db, modelVersion, labId = null) {
  const versions = db.prepare('SELECT model_version AS v, COUNT(*) AS n, MAX(created_at) AS last FROM recognition_logs WHERE (? IS NULL OR lab_id = ?) GROUP BY model_version ORDER BY last DESC').all(labId, labId);
  const v = modelVersion && versions.some((x) => x.v === modelVersion) ? modelVersion : null;
  const logs = db.prepare(`SELECT * FROM recognition_logs WHERE confirmed_class IS NOT NULL AND (? IS NULL OR lab_id = ?) ${v ? 'AND model_version = ?' : ''}`).all(labId, labId, ...(v ? [v] : []));

  // 분류 이름 → 기구 이름 (보기 좋게)
  const nameOf = {};
  for (const r of db.prepare('SELECT m.class_name, e.name FROM model_class_map m JOIN equipment e ON e.id = m.equipment_id').all()) nameOf[r.class_name] ||= r.name;
  const label = (c) => (c ? (nameOf[c] ? `${nameOf[c]}` : c) : '(없음)');

  // 기구별 (사용자가 최종 확인한 기구 기준)
  const per = new Map();
  for (const l of logs) {
    const p = per.get(l.confirmed_class) || { className: l.confirmed_class, total: 0, correct: 0, confSum: 0, confCount: 0 };
    p.total += 1;
    if (l.predicted_class === l.confirmed_class) p.correct += 1;
    if (typeof l.confidence === 'number') { p.confSum += l.confidence; p.confCount += 1; }
    per.set(l.confirmed_class, p);
  }
  const perClass = [...per.values()].map((p) => {
    const acc = p.correct / p.total;
    let advice = '';
    if (p.total < MIN_SAMPLES) advice = `기록이 아직 ${p.total}개뿐이에요. ${MIN_SAMPLES}개 이상 모이면 더 믿을 수 있어요.`;
    else if (acc < LOW_ACCURACY) advice = '사진을 더 찍어 다시 학습시키세요.';
    return {
      className: p.className, name: label(p.className), total: p.total, correct: p.correct,
      accuracy: acc, avgConfidence: p.confCount ? p.confSum / p.confCount : null,
      low: p.total >= MIN_SAMPLES && acc < LOW_ACCURACY, advice,
    };
  }).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);

  // 자주 헷갈린 기구 짝 (예: 배양기 ↔ 건조기) — 방향과 상관없이 합침
  const pairs = new Map();
  for (const l of logs) {
    if (!l.predicted_class || l.predicted_class === l.confirmed_class) continue;
    const [a, b] = [l.predicted_class, l.confirmed_class].sort();
    const key = `${a}|${b}`;
    const p = pairs.get(key) || { a, b, count: 0, detail: {} };
    p.count += 1;
    const dir = `${label(l.confirmed_class)}를 ${label(l.predicted_class)}로`;
    p.detail[dir] = (p.detail[dir] || 0) + 1;
    pairs.set(key, p);
  }
  const confusedPairs = [...pairs.values()].sort((x, y) => y.count - x.count).slice(0, 10)
    .map((p) => ({ pair: `${label(p.a)} ↔ ${label(p.b)}`, count: p.count, detail: Object.entries(p.detail).map(([k, n]) => `${k} ${n}번`).join(', ') }));

  const total = logs.length;
  const correct = logs.filter((l) => l.predicted_class === l.confirmed_class).length;
  const confs = logs.filter((l) => typeof l.confidence === 'number').map((l) => l.confidence);
  const byMethod = {};
  for (const l of logs) byMethod[l.decided_by] = (byMethod[l.decided_by] || 0) + 1;

  return {
    versions: versions.map((x) => ({ version: x.v || '(알 수 없음)', count: x.n })),
    selectedVersion: v,
    overall: { total, correct, accuracy: total ? correct / total : null, avgConfidence: confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : null, byMethod },
    perClass, confusedPairs,
    thresholds: { lowAccuracy: LOW_ACCURACY, minSamples: MIN_SAMPLES },
  };
}

// 탐구 보고서용 CSV (인식 기록 전체)
function accuracyCsv(db, csvCell) {
  const rows = db.prepare('SELECT * FROM recognition_logs ORDER BY id').all();
  const head = ['번호', '시각(UTC)', '모델', '모델 예측', '확신도(%)', '상위 3개', '결정 방식', '최종 확인', '맞음'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const top3 = JSON.parse(r.top3 || '[]').map((p) => `${p.className} ${Math.round(p.probability * 100)}%`).join(' / ');
    lines.push([r.id, r.created_at, r.model_version, r.predicted_class, r.confidence === null ? '' : Math.round(r.confidence * 1000) / 10,
      top3, r.decided_by, r.confirmed_class, r.predicted_class === r.confirmed_class ? '예' : '아니오'].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

module.exports = { setModelDirForTest, ensureModelFolders, modelInfo, classMapView, classMapWarningCount, saveClassMap, saveRecognitionSettings, accuracy, accuracyCsv };
