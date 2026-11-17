// ─────────────────────────────────────────────
// 경고 띠 내용 (6-4): "연체 중: 염산 (학번 203**, 3시간 지남)"
// ─────────────────────────────────────────────
const express = require('express');
const { getDb } = require('../db');
const { now } = require('../clock');
const { formatDuration, maskStudentId } = require('../timeFormat');

const router = express.Router();

router.get('/', (req, res) => {
  const t = now();
  // 1분 검사 전이라도 기한이 지난 것은 연체로 보여 줌
  const rows = getDb().prepare(`
    SELECT l.id, l.student_id, l.due_at, r.name AS reagent_name
    FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
    WHERE l.status = '연체' OR (l.status = '반출 중' AND l.due_at <= ?)
    ORDER BY l.due_at`).all(t.toISOString());
  res.json({
    ok: true,
    overdue: rows.map((l) => ({
      id: l.id,
      text: `연체 중: ${l.reagent_name} (학번 ${maskStudentId(l.student_id)}, ${formatDuration((t - new Date(l.due_at)) / 60000)} 지남)`,
    })),
  });
});

module.exports = router;
