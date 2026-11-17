// ─────────────────────────────────────────────
// 실험 주제로 기구·기자재 추천 (16단계)
// ─────────────────────────────────────────────
// 학생이 "효모 발효 실험"처럼 주제를 입력하면:
//   1) 주제를 낱말로 나눔 (효모, 발효) — "실험", "관찰" 같은 흔한 말과 "의/을/를" 같은 조사는 뺌
//   2) 비슷한 말을 더함 (효모 → 이스트, 세균 → 박테리아·미생물 …)
//   3) 기구마다 점수를 매김
//      - 관리자가 적어 둔 키워드와 학생이 쓴 말이 그대로 맞으면 +3 (키워드마다)
//        비슷한 말로만 맞으면 +1 (예: "효소"를 썼는데 "단백질"과 맞음 → 덜 확실하니까)
//      - 주제 전체가 키워드와 통째로 같으면 +5 더 (예: "식물 조직 배양" = 클린벤치 키워드 "식물 조직 배양")
//      - 기구 이름과 맞으면 +2
//      - 학생들이 실제로 그 기구 화면에서 적은 주제와 비슷하면 +1 (기록마다, 최대 +10)
//   4) 점수가 같으면 실제로 많이 쓰인 기구가 먼저
//   5) "주로 사용하는 기구"(예약 기구) / "주로 사용하는 기자재"(안내 전용) 두 묶음으로 나눔
// ※ 무료·학교 안에서만 동작. 나중에 AI 방식으로 바꾸려면 이 파일의 recommend() 만 바꾸면 됨.

const { now } = require('../clock');
const { getSetting } = require('../settings');
const { RuleError, checkId } = require('./common');
const { equipmentView } = require('./equipmentRules');

// 주제에서 빼는 흔한 말 (점수에 도움이 안 됨)
const STOPWORDS = new Set(['실험', '탐구', '관찰', '측정', '조사', '알아보기', '하기', '연구', '과정', '방법', '변화', '영향', '비교', '결과', '수업', '동아리', '개인', '만들기', '속도', '이용', '사용', '실험하기',
  // 어느 기구에나 붙을 수 있는 말 (예: "유리 기구 건조"의 "기구"가 "실험 기구 멸균"과 맞아 멸균기가 끼어드는 것 방지)
  '기구', '기자재', '도구', '장치', '용액', '재료', '준비', '물질', '시료']);
// 혼자서는 뜻이 약한 말 — 빼지는 않지만 점수를 적게(+1) 줌
// (예: "불꽃 반응"의 "반응"이 "반응 속도" 키워드와 맞아 엉뚱한 기구가 끼는 것 방지)
const WEAK = new Set(['반응', '법칙', '원리', '현상', '분석', '관계', '분리', '확인', '효과']);
// 낱말 끝에 붙은 조사 (긴 것부터 떼어 냄)
const JOSA = ['에서의', '으로의', '에서', '으로', '에게', '까지', '부터', '이랑', '하고', '의', '을', '를', '이', '가', '은', '는', '에', '로', '와', '과', '도', '랑'];

// 비교용으로 다듬기: 소문자, 띄어쓰기·기호 없애기
const norm = (s) => String(s || '').toLowerCase().replace(/[\s·.,/()\-_'"!?~]+/g, '');

// 주제 글 → 낱말 목록
function tokenize(text) {
  const words = String(text || '').toLowerCase().split(/[\s,./·()\-_'"!?~:;]+/).filter(Boolean);
  const out = [];
  for (let w of words) {
    for (const j of JOSA) {
      if (w.length > j.length + 1 && w.endsWith(j)) { w = w.slice(0, -j.length); break; }
    }
    if (w.length >= 1 && !STOPWORDS.has(w)) out.push(w);
  }
  return [...new Set(out)];
}

// 비슷한 말 묶음 (설정: 한 줄에 "세균, 박테리아, 미생물")
function synonymGroups(db) {
  return String(getSetting(db, 'recommend_synonyms') || '').split('\n')
    .map((line) => line.split(',').map((x) => norm(x)).filter(Boolean))
    .filter((g) => g.length >= 2);
}

// 낱말에 비슷한 말을 더함
function expand(tokens, groups) {
  const set = new Set(tokens.map(norm));
  for (const t of [...set]) {
    for (const g of groups) if (g.some((x) => similar(x, t))) g.forEach((x) => set.add(x));
  }
  return [...set].filter(Boolean);
}

// 두 말이 맞는지: 똑같거나, 2글자 이상일 때 한쪽이 다른 쪽에 들어 있으면 맞음
// (1글자는 "균"이 "멸균"에 맞는 것처럼 엉뚱하게 맞기 쉬워서 똑같을 때만)
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

// ── 추천 ──
// labId 가 있으면 그 실험실 기구만. 결과가 하나도 없으면 다른 실험실까지 찾아봄 (otherLabs: true)
function recommend(db, query, labId = null) {
  const q = String(query ?? '').trim().slice(0, 100);
  if (q.length < 1) throw new RuleError('실험 주제를 입력해 주세요.', '예: 효모 발효, 효소 반응 속도, 세균 배양');
  const tokens = tokenize(q);
  if (!tokens.length) throw new RuleError('주제를 조금 더 자세히 써 주세요.', '예: "효모 발효", "DNA 추출"처럼 재료나 하는 일을 넣어 주세요.');
  const direct = tokens.map(norm).filter((w) => !WEAK.has(w));   // 학생이 실제로 쓴 뜻이 분명한 말
  const weak = tokens.map(norm).filter((w) => WEAK.has(w));      // 뜻이 약한 말 (반응, 법칙 …)
  const words = expand(tokens, synonymGroups(db));               // + 비슷한 말
  const extra = words.filter((w) => !direct.includes(w));        // 비슷한 말·약한 말
  // 주제 전체: 흔한 말을 뺀 것("식물조직배양")과 쓴 그대로("옴의법칙") 둘 다 비교
  const wholes = [norm(tokens.join('')), norm(q)].filter((w) => w.length >= 3);

  const run = (lab) => {
    const rows = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM equipment_uses u WHERE u.equipment_id = e.id) AS useCount
                             FROM equipment e WHERE e.archived = 0 AND (? IS NULL OR e.lab_id = ?)`).all(lab, lab);
    const topicRows = db.prepare(`SELECT t.equipment_id, t.topic FROM topic_logs t JOIN equipment e ON e.id = t.equipment_id
                                  WHERE e.archived = 0 AND (? IS NULL OR e.lab_id = ?)`).all(lab, lab);
    const results = [];
    for (const e of rows) {
      let score = 0;
      const matchedKeywords = [];
      for (const kw of JSON.parse(e.keywords || '[]')) {
        const k = norm(kw);
        if (direct.some((w) => similar(w, k))) { score += 3; matchedKeywords.push(kw); }      // 쓴 말 그대로 맞음
        else if (extra.some((w) => similar(w, k)) || weak.some((w) => similar(w, k))) { score += 1; matchedKeywords.push(kw); } // 비슷한 말·약한 말로만 맞음
        if (wholes.includes(k)) score += 5;                                                   // 주제가 키워드와 통째로 같음
      }
      if (words.some((w) => similar(w, norm(e.name)))) score += 2;
      // 학생들이 실제로 적은 주제와 비슷한 기록 수
      const topicHits = topicRows.filter((t) => t.equipment_id === e.id && tokenize(t.topic).map(norm).some((tt) => words.some((w) => similar(w, tt)))).length;
      score += Math.min(topicHits, 10);
      if (score > 0) results.push({ e, score, matchedKeywords, topicHits, useCount: e.useCount });
    }
    // 같은 종류 여러 대(배양기 1번·2번)는 한 번만 보여 줌 (이름이 같으면 첫 번째만, 대수 표시)
    results.sort((a, b) => b.score - a.score || b.useCount - a.useCount || a.e.id - b.e.id);
    const seen = new Map();
    const unique = [];
    for (const r of results) {
      const key = `${r.e.lab_id}|${r.e.name}`;
      if (seen.has(key)) { seen.get(key).units += 1; continue; }
      const item = { ...r, units: 1 };
      seen.set(key, item);
      unique.push(item);
    }
    return unique;
  };

  let list = run(labId);
  let otherLabs = false;
  if (!list.length && labId) { list = run(null); otherLabs = list.length > 0; }

  const toView = (r) => {
    const v = equipmentView(db, r.e);
    return {
      id: v.id, name: v.name, displayName: r.units > 1 ? v.name : v.displayName, units: r.units,
      labName: v.labName, status: v.status, isGuide: v.isGuide, photoUrl: v.photoUrl,
      score: r.score, matchedKeywords: r.matchedKeywords.slice(0, 4), topicHits: r.topicHits,
    };
  };
  // 묶음마다 1등 점수의 45%가 안 되는 것은 뺌 (조금만 겹쳐서 끼어든 기구가 꼬리처럼 붙지 않게)
  const trim = (group) => {
    const top = group.length ? group[0].score : 0;
    return group.filter((r) => r.score >= Math.max(1, top * 0.45)).slice(0, 8).map(toView);
  };
  return {
    query: q,
    words: tokens,
    otherLabs,
    equipment: trim(list.filter((r) => r.e.kind !== '안내')), // 주로 사용하는 기구
    tools: trim(list.filter((r) => r.e.kind === '안내')),     // 주로 사용하는 기자재
  };
}

// ── 주제 기록 저장 (학생이 기구·기자재 화면에서 적은 것, 선택) ──
// 학번·이름은 받지도 저장하지도 않음
function saveTopic(db, equipmentId, topicRaw) {
  const topic = String(topicRaw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!topic) return null; // 비워 두면 저장 안 함 (선택 사항)
  if (topic.length < 2 || topic.length > 100) throw new RuleError('주제는 2~100글자로 적어 주세요.', '비워 둬도 돼요.');
  if (/\d{5,}/.test(topic)) throw new RuleError('주제에 학번 같은 숫자는 쓰지 말아 주세요.', '예: "효모 발효"처럼 실험 내용만 적어 주세요.');
  const e = db.prepare('SELECT id, lab_id FROM equipment WHERE id = ? AND archived = 0').get(checkId(equipmentId, '기구'));
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '', 404);
  db.prepare('INSERT INTO topic_logs (created_at, lab_id, equipment_id, topic) VALUES (?, ?, ?, ?)')
    .run(now().toISOString(), e.lab_id, e.id, topic);
  return { saved: true };
}

// ── 관리자: 기구별로 많이 나온 주제 ──
function topicSummary(db, labId = null) {
  const rows = db.prepare(`SELECT t.equipment_id, e.name, e.unit_label, e.keywords, t.topic, COUNT(*) AS n, MAX(t.created_at) AS last
                           FROM topic_logs t JOIN equipment e ON e.id = t.equipment_id
                           WHERE (? IS NULL OR e.lab_id = ?)
                           GROUP BY t.equipment_id, t.topic ORDER BY e.name, n DESC, last DESC`).all(labId, labId);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.equipment_id)) {
      by.set(r.equipment_id, { equipmentId: r.equipment_id, name: r.unit_label ? `${r.name} ${r.unit_label}` : r.name, keywords: JSON.parse(r.keywords || '[]'), topics: [] });
    }
    by.get(r.equipment_id).topics.push({ topic: r.topic, count: r.n, last: r.last });
  }
  return [...by.values()];
}

function deleteTopic(db, equipmentId, topic) {
  const n = db.prepare('DELETE FROM topic_logs WHERE equipment_id = ? AND topic = ?').run(checkId(equipmentId, '기구'), String(topic ?? '')).changes;
  if (!n) throw new RuleError('그 주제 기록을 찾을 수 없어요.', '목록을 새로 고쳐 주세요.');
  return { removed: n };
}

// 주제를 그 기구 키워드에 추가 (같은 종류 여러 대면 모두에)
function addKeyword(db, equipmentId, keywordRaw) {
  const kw = String(keywordRaw ?? '').trim();
  if (kw.length < 1 || kw.length > 30) throw new RuleError('키워드는 1~30글자로 써 주세요.');
  const e = db.prepare('SELECT id, name, lab_id FROM equipment WHERE id = ? AND archived = 0').get(checkId(equipmentId, '기구'));
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '', 404);
  const same = db.prepare('SELECT id, keywords FROM equipment WHERE name = ? AND lab_id IS ? AND archived = 0').all(e.name, e.lab_id);
  db.transaction(() => {
    for (const s of same) {
      const list = JSON.parse(s.keywords || '[]');
      if (list.length >= 30 || list.some((x) => norm(x) === norm(kw))) continue;
      list.push(kw);
      db.prepare('UPDATE equipment SET keywords = ? WHERE id = ?').run(JSON.stringify(list), s.id);
    }
  })();
  return { keyword: kw };
}

// ── 비슷한 말 설정 ──
function saveSynonyms(db, text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 100) throw new RuleError('비슷한 말 묶음은 100줄까지만 쓸 수 있어요.');
  if (lines.some((l) => l.length > 200)) throw new RuleError('한 줄이 너무 길어요.', '200글자 이하로 나눠 주세요.');
  db.prepare("INSERT INTO settings (key, value) VALUES ('recommend_synonyms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(lines.join('\n'));
  return { lines: lines.length };
}

module.exports = { tokenize, expand, similar, recommend, saveTopic, topicSummary, deleteTopic, addKeyword, saveSynonyms, synonymGroups };
