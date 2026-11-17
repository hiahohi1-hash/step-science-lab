// ─────────────────────────────────────────────
// 기구 관련 서버 주소 (학생용 처음 화면에서 사용)
// ─────────────────────────────────────────────
// 실제 규칙은 rules/equipmentRules.js 에 있습니다.

const express = require('express');
const { getDb } = require('../db');
const E = require('../rules/equipmentRules');
const { broadcast } = require('../events');
const { now } = require('../clock');
const { labFilter } = require('../rules/labs');

const router = express.Router();

// 기구 찾기: /api/equipment?q=배양기  → 같은 이름끼리 묶어서
// serverTime: 휴대폰 시계가 조금 틀려도 남은 시간을 맞게 줄여 가도록 서버 시각을 같이 보냄
router.get('/', (req, res) => {
  res.json({ ok: true, serverTime: now().toISOString(), groups: E.searchEquipment(getDb(), req.query.q, labFilter(getDb(), req.query.lab)) });
});

// 현황판: 이 학번의 대기·차례 상황 (POST 로 받음 → 학번이 주소창·기록에 남지 않게)
// ※ 바꾸는 요청이 아니므로 실시간 "바뀌었어요" 소식을 보내지 않음 (server.js 에서 제외)
router.post('/my-queue', (req, res) => {
  res.json({ ok: true, items: E.myQueueStatus(getDb(), (req.body || {}).studentId) });
});

// 기구 한 대의 지금 상태: /api/equipment/1
router.get('/:id', (req, res) => {
  const db = getDb();
  res.json({ ok: true, equipment: E.equipmentView(db, E.getEquipmentRow(db, req.params.id)) });
});

// 사용 시작
router.post('/:id/start', (req, res) => {
  res.json({ ok: true, ...E.startUse(getDb(), { ...(req.body || {}), equipmentId: req.params.id }) });
});

// 대기 등록
router.post('/:id/queue', (req, res) => {
  res.json({ ok: true, ...E.joinQueue(getDb(), { ...(req.body || {}), equipmentId: req.params.id }) });
});

// 지금 사용 중인 본인인지 확인 (상황 C)
router.post('/:id/me', (req, res) => {
  const { use, extendBlockedReason } = E.checkCurrentUser(getDb(), req.params.id, (req.body || {}).studentId);
  res.json({ ok: true, canExtend: !extendBlockedReason, extendBlockedReason, endsAt: use.ends_at });
});

// 일찍 끝났어요
router.post('/:id/end', (req, res) => {
  const result = E.endEarly(getDb(), { ...(req.body || {}), equipmentId: req.params.id });
  // 일찍 끝나서 대기 1번에게 차례가 넘어갔으면 현황판(6단계)에 알려 줌
  if (result.nextStudent) broadcast('turn', { equipmentId: Number(req.params.id), student: result.nextStudent });
  res.json({ ok: true, ...result });
});

// 시간 연장하기
router.post('/:id/extend', (req, res) => {
  res.json({ ok: true, ...E.extendUse(getDb(), { ...(req.body || {}), equipmentId: req.params.id }) });
});

module.exports = router;
