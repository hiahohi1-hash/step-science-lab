// ─────────────────────────────────────────────
// 기구 사진 인식 관련 서버 주소 (/api/recognition/...)
// ─────────────────────────────────────────────
// ※ 사진은 서버로 보내지 않습니다. 인식은 태블릿 브라우저 안에서 하고,
//    서버는 "분류 이름 ↔ 기구" 연결 표를 알려 주고 인식 결과 기록만 받습니다.
const express = require('express');
const { getDb } = require('../db');
const Rec = require('../rules/recognition');
const { labFilter } = require('../rules/labs');

const router = express.Router();

// 인식할 때 필요한 설정 + 연결 표
router.get('/config', (req, res) => res.json({ ok: true, ...Rec.recognitionConfig(getDb(), labFilter(getDb(), req.query.lab)) }));

// 인식 기록 저장 (사용자가 최종 확인한 기구와 함께)
router.post('/log', (req, res) => { Rec.saveLog(getDb(), req.body || {}); res.json({ ok: true }); });

module.exports = router;
