// ─────────────────────────────────────────────
// 16단계: "추천하는 도구" 화면 (실험 주제로 기구·기자재 추천)
// ─────────────────────────────────────────────
// 결과를 두 묶음으로:
//   🔬 주로 사용하는 기구   (예약 기구 — 지금 상태도 함께)
//   🧪 주로 사용하는 기자재 (안내 전용 — 누르면 사용법)

async function showRecommend(q) {
  const input = h('input', { type: 'search', maxlength: 100, value: q || '', placeholder: '주제를 입력해주세요' });
  const box = h('div', {}, h('p', { class: 'muted' }, '찾는 중…'));
  show(
    topNav('추천하는 도구'),
    h('h2', {}, '🔎 추천하는 도구'),
    h('form', { onsubmit: (e) => { e.preventDefault(); showRecommend(input.value); } },
      h('div', { class: 'row' }, input, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
    box,
  );
  if (!String(q || '').trim()) {
    box.replaceChildren(h('p', { class: 'muted' }, '어떤 실험을 하려는지 적어 보세요. 예: "효모 발효", "효소 반응", "세균 배양", "DNA 추출"'));
    return;
  }
  try {
    const r = await api('/api/recommend?q=' + encodeURIComponent(q) + '&' + labParam());
    pendingTopic = r.query; // 기구를 고르면 "어떤 실험에 쓰시나요?" 칸에 미리 넣어 줌

    // 왜 추천했는지 한 줄 (키워드, 실제 기록 수)
    const reason = (it) => [
      it.matchedKeywords.length ? `키워드: ${it.matchedKeywords.join(', ')}` : '',
      it.topicHits ? `비슷한 주제로 실제 사용 ${it.topicHits}번` : '',
    ].filter(Boolean).join(' · ');
    const card = (it) => h('div', {
      class: 'card clickable rec-card', role: 'button',
      // 같은 종류 여러 대면 기구 찾기에서 1번/2번 고르기, 한 대면 바로 기구 화면
      onclick: () => (it.units > 1 ? searchEquipment(it.name) : openEquipment(it.id)),
    },
      it.photoUrl ? h('img', { src: it.photoUrl, alt: '', class: 'rec-photo' }) : null,
      h('div', {},
        h('strong', {}, it.displayName), it.units > 1 ? h('span', { class: 'muted' }, ` (${it.units}대)`) : null, ' ',
        it.isGuide ? h('span', { class: 'status guide' }, '📘 사용법') : statusBadge(it.status),
        r.otherLabs ? h('div', { class: 'muted small' }, it.labName) : null,
        reason(it) ? h('div', { class: 'muted small' }, reason(it)) : null));

    const parts = [];
    if (r.otherLabs) parts.push(h('p', { class: 'badge warn' }, `${kioskLab ? kioskLab.name : '이 실험실'}에는 맞는 기구가 없어서 다른 실험실 기구를 보여 드려요.`));
    parts.push(h('p', { class: 'muted small' }, `찾은 낱말: ${r.words.join(', ')}`));
    parts.push(h('h2', {}, '🔬 주로 사용하는 기구'));
    parts.push(...(r.equipment.length ? r.equipment.map(card) : [h('p', { class: 'muted' }, '추천할 기구가 없어요.')]));
    parts.push(h('h2', {}, '🧪 주로 사용하는 기자재'));
    parts.push(...(r.tools.length ? r.tools.map(card) : [h('p', { class: 'muted' }, '추천할 기자재가 없어요.')]));
    if (!r.equipment.length && !r.tools.length) {
      parts.push(errorBox({ message: '이 주제에 맞는 기구를 아직 몰라요.', hint: '다른 말로 다시 찾아보거나, 선생님께 문의하세요. "기구 직접 찾기"로 골라도 돼요.' }));
    }
    parts.push(h('p', { class: 'muted small' }, '추천은 선생님이 적어 둔 키워드와 학생들이 실제로 적은 실험 주제를 바탕으로 해요. 실험 계획은 꼭 선생님과 확인하세요.'));
    box.replaceChildren(...parts);
  } catch (err) {
    box.replaceChildren(errorBox(err));
  }
}
