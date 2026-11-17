// ─────────────────────────────────────────────
// 기자재 자료집 → 실험실에 골라 넣기
// ─────────────────────────────────────────────
// - 자료집(src/catalog/equipmentCatalog.js)은 "보기만" 하는 목록입니다. 넣기 전에는 추천에 쓰이지 않습니다.
// - 관리자가 우리 학교에 있는 것만 체크해서 넣으면:
//     그 실험실에 같은 이름 기구가 없으면 → 새 기구로 추가 (키워드 포함, 사용법은 비어 있음)
//     이미 있으면 → 키워드만 합침 (사용법·사진 등은 그대로)
const { SOURCES, ITEMS, NO_HOWTO_NOTICE } = require('../catalog/equipmentCatalog');
const { RuleError } = require('./common');

// 자료집 목록 + 각 항목이 이미 그 실험실에 있는지
function listCatalog(db) {
  const labs = db.prepare('SELECT id, name, code FROM labs').all();
  return {
    sources: SOURCES,
    items: ITEMS.map((it) => {
      const lab = labs.find((l) => l.code === it.lab);
      const existing = lab ? db.prepare('SELECT id FROM equipment WHERE lab_id = ? AND name = ? AND archived = 0').get(lab.id, it.name) : null;
      return { ...it, labId: lab ? lab.id : null, labName: lab ? lab.name : `(${it.lab} 실험실 없음)`, exists: !!existing };
    }),
  };
}

// 고른 항목들을 넣기. targetLabId 를 주면 모두 그 실험실로, 없으면 자료집에 적힌 실험실로
function addFromCatalog(db, ids, targetLabId = null) {
  const picked = (Array.isArray(ids) ? ids : []).map(String);
  if (!picked.length) throw new RuleError('넣을 기자재를 골라 주세요.');
  if (picked.length > ITEMS.length) throw new RuleError('너무 많이 골랐어요.');
  const items = picked.map((id) => ITEMS.find((it) => it.id === id));
  if (items.some((it) => !it)) throw new RuleError('자료집에 없는 항목이 들어 있어요.', '화면을 새로 고쳐 주세요.');

  const result = { added: [], merged: [] };
  db.transaction(() => {
    for (const it of items) {
      const lab = targetLabId
        ? db.prepare('SELECT id, name FROM labs WHERE id = ?').get(targetLabId)
        : db.prepare('SELECT id, name FROM labs WHERE code = ?').get(it.lab);
      if (!lab) throw new RuleError(`"${it.name}"을(를) 넣을 실험실이 없어요.`, '실험실 탭에서 그 실험실(영어 코드)을 만들거나, 넣을 실험실을 골라 주세요.');
      const same = db.prepare('SELECT id, keywords FROM equipment WHERE lab_id = ? AND name = ? AND archived = 0').all(lab.id, it.name);
      if (same.length) {
        // 이미 있음 → 키워드만 합침 (같은 이름 여러 대면 모두에)
        for (const s of same) {
          const list = JSON.parse(s.keywords || '[]');
          for (const k of it.keywords) if (list.length < 30 && !list.includes(k)) list.push(k);
          db.prepare('UPDATE equipment SET keywords = ? WHERE id = ?').run(JSON.stringify(list), s.id);
        }
        result.merged.push(`${lab.name} ${it.name}`);
      } else {
        // 새로 추가 (사용법은 선생님이 적도록 안내 문구만)
        db.prepare(`INSERT INTO equipment (name, unit_label, location, howto, checklist, cautions, time_options, max_minutes, is_dangerous, sample_notice, kind, lab_id, keywords)
                    VALUES (?, '', '', ?, '[]', '[]', ?, ?, 0, 1, ?, ?, ?)`).run(
          it.name, JSON.stringify([NO_HOWTO_NOTICE]),
          // 예약 기구는 기본 사용 시간 선택지를 넣어 둠 (선생님이 기구 관리에서 고치면 됨)
          it.kind === '예약' ? JSON.stringify([{ label: '30분', minutes: 30 }, { label: '1시간', minutes: 60 }, { label: '2시간', minutes: 120 }]) : '[]',
          it.kind === '예약' ? 180 : 60,
          it.kind, lab.id, JSON.stringify(it.keywords),
        );
        result.added.push(`${lab.name} ${it.name}`);
      }
    }
  })();
  return result;
}

module.exports = { listCatalog, addFromCatalog };
