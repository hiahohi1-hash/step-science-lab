// ─────────────────────────────────────────────
// 기구 사진 인식 관련 서버 주소 (/api/recognition/...)
// ─────────────────────────────────────────────
// ※ 인식은 태블릿 브라우저 안에서 합니다. 서버는 "분류 이름 ↔ 기구" 연결 표를 알려 주고 인식 결과 기록을 받습니다.
// ※ 18단계: 사용자가 "맞아요"/다른 기구로 확인한 사진(가운데 224×224)만 학습용으로 받습니다 (학번·이름 없이).
const express = require('express');
const { getDb } = require('../db');
const Rec = require('../rules/recognition');
const Training = require('../rules/training');
const { labFilter } = require('../rules/labs');

const router = express.Router();

// 인식할 때 필요한 설정 + 연결 표
router.get('/config', (req, res) => res.json({ ok: true, ...Rec.recognitionConfig(getDb(), labFilter(getDb(), req.query.lab)) }));

// 인식 기록 저장 (사용자가 최종 확인한 기구와 함께)
router.post('/log', (req, res) => { Rec.saveLog(getDb(), req.body || {}); res.json({ ok: true }); });

// 18단계: 확인된 기구 사진 저장 (같은 컴퓨터에서 한 시간에 120장까지 — 디스크를 채우는 장난 방지)
const sampleCount = new Map();
router.post('/sample', (req, res) => {
  const key = req.ip + ':' + new Date().getHours();
  const n = (sampleCount.get(key) || 0) + 1;
  sampleCount.set(key, n);
  if (sampleCount.size > 5000) sampleCount.clear();
  if (n > 120) return res.status(429).json({ ok: false, message: '잠시 뒤에 다시 보내 주세요.' });
  const b = req.body || {};
  res.json({ ok: true, ...Training.saveSample(getDb(), { equipmentId: b.equipmentId, dataUrl: b.dataUrl }) });
});

module.exports = router;
