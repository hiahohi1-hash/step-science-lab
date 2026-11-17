// ─────────────────────────────────────────────
// 기구 인식 판정 규칙 (11-2) — 화면(브라우저)과 테스트(Node.js)가 같은 파일을 씁니다.
// ─────────────────────────────────────────────
// 모델은 1초에 여러 번 "이 사진은 autoclave 91%, dryer 5% …" 처럼 결과를 냅니다.
// 이 판정기는 그 결과를 차례로 받아서 언제 결정할지 정합니다.
//
//  ① 1등이 "기구 아님"(not_equipment) → 아무 반응 없이 계속 인식 (결과: none)
//  ② 같은 기구가 2초 동안 계속 확신도 80% 이상 → 그 기구로 결정 (결과: decided)
//  ③ 기구가 보이는데 5초가 지나도 결정이 안 되면 (확신도가 낮거나 결과가 계속 바뀜)
//     → 그동안의 평균 확신도로 상위 3개 후보를 보여 줌 (결과: candidates)
//  ※ 관리자가 기구와 연결하지 않은 분류 이름은 "기구 아님"처럼 무시합니다.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); // Node.js (테스트)
  else root.RecognitionCore = factory();                                         // 브라우저
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    threshold: 0.8,          // 자동 결정 확신도 기준
    holdSeconds: 2,          // 같은 결과가 이어져야 하는 시간
    candidateSeconds: 5,     // 기구가 보인 지 이만큼 지나도 결정이 안 되면 후보 표시
    notEquipmentClass: 'not_equipment',
    resetAfterNothingSeconds: 2, // "기구 아님"이 이만큼 계속되면 처음부터 다시 셈 (카메라를 다른 데로 돌린 것)
  };

  function createJudge(options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    // knownClasses: 기구와 연결된 분류 이름 목록 (없으면 "기구 아님"을 뺀 모든 분류를 인정)
    const known = opt.knownClasses ? new Set(opt.knownClasses) : null;
    const isEquipment = (c) => c !== opt.notEquipmentClass && (!known || known.has(c));

    let streak = null;        // { className, startMs, sum, count } — 80% 이상이 이어지는 중인 기구
    let visibleMs = 0;        // 기구가 보인 시간의 합
    let lastMs = null;        // 바로 전 결과의 시각
    let nothingSinceMs = null; // "기구 아님"이 시작된 시각
    const totals = new Map(); // 분류 이름 → { sum, count } (후보 평균 계산용)
    let finished = false;     // 결정했거나 후보를 보여 준 뒤에는 더 판단하지 않음

    function reset() {
      streak = null; visibleMs = 0; lastMs = null; nothingSinceMs = null; totals.clear(); finished = false;
    }

    // 지금까지의 평균 확신도로 상위 3개 (기구 아님·연결 안 된 분류는 뺌)
    function topCandidates(n) {
      return [...totals.entries()]
        .map(([className, t]) => ({ className, probability: t.sum / t.count }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, n || 3);
    }

    // predictions: [{ className, probability }], nowMs: 지금 시각(밀리초)
    function update(predictions, nowMs) {
      if (finished) return { type: 'finished' };
      const list = (predictions || []).filter((p) => p && typeof p.probability === 'number');
      if (!list.length) return { type: 'none' };
      const top = list.reduce((a, b) => (b.probability > a.probability ? b : a));
      const dt = lastMs === null ? 0 : Math.max(0, Math.min(nowMs - lastMs, 1000)); // 화면이 잠깐 멈춰도 1초 넘게 세지 않음
      lastMs = nowMs;

      // ① 기구 아님 → 반응 없음
      if (!isEquipment(top.className)) {
        streak = null;
        if (nothingSinceMs === null) nothingSinceMs = nowMs;
        if (nowMs - nothingSinceMs >= opt.resetAfterNothingSeconds * 1000) { visibleMs = 0; totals.clear(); }
        return { type: 'none' };
      }
      nothingSinceMs = null;
      visibleMs += dt;

      // 후보 평균에 더하기 (기구인 분류만)
      for (const p of list) {
        if (!isEquipment(p.className)) continue;
        const t = totals.get(p.className) || { sum: 0, count: 0 };
        t.sum += p.probability; t.count += 1;
        totals.set(p.className, t);
      }

      // ② 80% 이상이 같은 기구로 이어지는지
      if (top.probability >= opt.threshold) {
        if (!streak || streak.className !== top.className) {
          streak = { className: top.className, startMs: nowMs, sum: 0, count: 0 };
        }
        streak.sum += top.probability; streak.count += 1;
        if (nowMs - streak.startMs >= opt.holdSeconds * 1000) {
          finished = true;
          return {
            type: 'decided',
            className: top.className,
            confidence: streak.sum / streak.count,
            top3: topCandidates(3),
          };
        }
      } else {
        streak = null; // 80% 아래로 떨어지면 처음부터
      }

      // ③ 오래 봐도 결정이 안 됨 → 후보
      if (visibleMs >= opt.candidateSeconds * 1000) {
        finished = true;
        const top3 = topCandidates(3);
        return { type: 'candidates', top3, className: top3[0] && top3[0].className, confidence: top3[0] && top3[0].probability };
      }
      return { type: 'watching', className: top.className, probability: top.probability };
    }

    return { update, reset, topCandidates };
  }

  return { createJudge, DEFAULTS };
}));
