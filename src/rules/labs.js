// ─────────────────────────────────────────────
// 실험실 (13단계) — 생물실·물리실·화학실 …
// ─────────────────────────────────────────────
const { RuleError, checkId } = require('./common');

const CODE = /^[a-z][a-z0-9_-]{1,19}$/; // 영어 소문자로 시작, 2~20글자 (인식 모델 폴더 이름으로도 씀)

function listLabs(db) {
  return db.prepare(`SELECT l.id, l.name, l.code, l.sort,
      (SELECT COUNT(*) FROM equipment e WHERE e.lab_id = l.id AND e.archived = 0) AS equipmentCount,
      (SELECT COUNT(*) FROM reagents r WHERE r.lab_id = l.id AND r.archived = 0) AS reagentCount
    FROM labs l ORDER BY l.sort, l.id`).all();
}

// 화면에서 받은 실험실 번호 검사. 비어 있으면 null (= 모든 실험실)
function labFilter(db, value) {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  const id = checkId(value, '실험실');
  if (!db.prepare('SELECT 1 FROM labs WHERE id = ?').get(id)) throw new RuleError('그 실험실을 찾을 수 없어요.', '실험실을 다시 골라 주세요.', 404);
  return id;
}

// 시약·기구를 저장할 때 꼭 있어야 하는 실험실 번호
function requireLab(db, value) {
  const id = labFilter(db, value);
  if (!id) throw new RuleError('실험실을 골라 주세요.');
  return id;
}

function saveLab(db, data, id) {
  const name = String(data.name ?? '').trim();
  const code = String(data.code ?? '').trim().toLowerCase();
  if (name.length < 1 || name.length > 20) throw new RuleError('실험실 이름은 1~20글자로 써 주세요.');
  if (!CODE.test(code)) throw new RuleError('영어 코드가 올바르지 않아요.', '영어 소문자로 시작하는 2~20글자로 써 주세요. (예: bio, earth)');
  const sort = Number.isInteger(Number(data.sort)) ? Number(data.sort) : 0;
  const dup = db.prepare('SELECT id FROM labs WHERE (name = ? OR code = ?) AND id != ?').get(name, code, id || 0);
  if (dup) throw new RuleError('같은 이름이나 코드의 실험실이 이미 있어요.');
  if (id) {
    const changed = db.prepare('UPDATE labs SET name = ?, code = ?, sort = ? WHERE id = ?').run(name, code, sort, checkId(id, '실험실')).changes;
    if (!changed) throw new RuleError('그 실험실을 찾을 수 없어요.', '', 404);
    return { id: Number(id) };
  }
  return { id: Number(db.prepare('INSERT INTO labs (name, code, sort) VALUES (?, ?, ?)').run(name, code, sort).lastInsertRowid) };
}

// 시약·기구가 하나도 없을 때만 지울 수 있음 (지난 기록이 가리키는 것도 포함)
function deleteLab(db, id) {
  const labId = checkId(id, '실험실');
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM equipment WHERE lab_id = ?) + (SELECT COUNT(*) FROM reagents WHERE lab_id = ?) AS n').get(labId, labId).n;
  if (used) throw new RuleError('이 실험실에 시약이나 기구(삭제한 것 포함)가 있어서 지울 수 없어요.', '이름만 바꾸거나, 시약·기구를 다른 실험실로 옮긴 뒤 지워 주세요.');
  if (db.prepare('SELECT COUNT(*) n FROM labs').get().n <= 1) throw new RuleError('실험실은 하나 이상 있어야 해요.');
  db.prepare('DELETE FROM labs WHERE id = ?').run(labId);
}

module.exports = { listLabs, labFilter, requireLab, saveLab, deleteLab };
