// ─────────────────────────────────────────────
// 관리자 서버 주소 (/api/admin/...) — 로그인한 관리자만 쓸 수 있음
// ─────────────────────────────────────────────
const express = require('express');
const { getDb } = require('../db');
const { getSetting } = require('../settings');
const auth = require('../auth');
const A = require('../rules/adminRules');
const RA = require('../rules/recognitionAdmin');
const Photo = require('../rules/photo');
const { broadcast } = require('../events');
const Labs = require('../rules/labs');
const Rec = require('../rules/recommend');
const Catalog = require('../rules/catalog');
const { labFilter } = Labs;

const router = express.Router();
const ok = (res, extra = {}) => res.json({ ok: true, ...extra });

// ── 로그인 / 로그아웃 / 로그인 상태 (문지기 앞에 둠) ──
router.post('/login', (req, res) => {
  const r = auth.login(getDb(), req, res, (req.body || {}).password);
  if (!r.ok) return res.status(r.status || 401).json({ ok: false, message: r.message, hint: r.hint });
  ok(res, { mustChange: r.mustChange });
});

router.post('/logout', (req, res) => { auth.logout(req, res); ok(res); });

router.get('/me', (req, res) => {
  const db = getDb();
  ok(res, { loggedIn: auth.isLoggedIn(req), mustChange: getSetting(db, 'admin_password_is_example') === '1' });
});

// ── 여기부터는 로그인한 관리자만 ──
router.use(auth.requireAdmin);

// 예시 비밀번호 그대로면 비밀번호 바꾸기 말고는 아무것도 못 하게 서버에서도 막음
// (화면만 막으면 예시 비밀번호를 아는 사람이 화면을 거치지 않고 요청을 보낼 수 있음)
router.use((req, res, next) => {
  if (req.path !== '/password' && getSetting(getDb(), 'admin_password_is_example') === '1') {
    return res.status(403).json({ ok: false, message: '먼저 관리자 비밀번호를 바꿔야 해요.', hint: '예시 비밀번호는 누구나 알 수 있어요. 새 비밀번호로 바꿔 주세요.' });
  }
  next();
});

// 요약 + 승인 대기 + 반출 중
router.get('/dashboard', (req, res) => {
  const db = getDb();
  ok(res, { summary: A.summary(db), pending: A.pendingLoans(db), active: A.activeLoans(db), classMapWarnings: RA.classMapWarningCount(db) });
});

// 승인 / 거절
router.post('/loans/:id/approve', (req, res) => { A.approve(getDb(), req.params.id); ok(res); });
router.post('/loans/:id/reject', (req, res) => { A.reject(getDb(), req.params.id, (req.body || {}).reason); ok(res); });

// 기구 현황
router.get('/equipment-status', (req, res) => { const db = getDb(); const lab = labFilter(db, req.query.lab); ok(res, { equipment: A.equipmentStatus(db, lab), queues: A.allQueues(db, lab), queueEnabled: require('../rules/equipmentRules').queueEnabled(db) }); });
router.post('/equipment/:id/force-end', (req, res) => ok(res, A.forceEnd(getDb(), req.params.id)));
router.post('/equipment/:id/maintenance', (req, res) => ok(res, A.setMaintenance(getDb(), req.params.id, !!(req.body || {}).on)));
router.post('/equipment/:id/clear-queue', (req, res) => ok(res, A.clearQueue(getDb(), req.params.id)));
router.post('/queue/:id/cancel', (req, res) => {
  const r = A.cancelQueueEntry(getDb(), req.params.id, (req.body || {}).reason);
  // 차례였던 사람을 지워서 다음 사람에게 차례가 넘어갔으면 현황판에 알려 줌 (학번은 가려서)
  if (r.nextStudent) broadcast('turn', { student: r.nextStudent });
  ok(res, r);
});

// 전체 기록 + CSV 내려받기
router.get('/records', (req, res) => ok(res, A.records(getDb(), req.query)));
router.get('/records.csv', (req, res) => {
  const { filename, body } = A.recordsCsv(getDb(), req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(body);
});

// 시약 관리
router.get('/reagents', (req, res) => ok(res, { reagents: A.listReagents(getDb(), labFilter(getDb(), req.query.lab)) }));
router.post('/reagents', (req, res) => ok(res, A.saveReagent(getDb(), req.body || {})));
router.post('/reagents/:id', (req, res) => ok(res, A.saveReagent(getDb(), req.body || {}, req.params.id)));
router.post('/reagents/:id/delete', (req, res) => { A.archiveReagent(getDb(), req.params.id); ok(res); });

// 기구 관리
router.get('/equipment', (req, res) => ok(res, { equipment: A.listEquipmentAdmin(getDb(), labFilter(getDb(), req.query.lab)) }));
router.post('/equipment', (req, res) => ok(res, A.saveEquipment(getDb(), req.body || {})));
router.post('/equipment/:id', (req, res) => ok(res, A.saveEquipment(getDb(), req.body || {}, req.params.id)));
router.post('/equipment/:id/delete', (req, res) => { A.archiveEquipment(getDb(), req.params.id); ok(res); });
// 기구 사진 올리기 / 지우기
router.post('/equipment/:id/photo', (req, res) => ok(res, Photo.savePhoto(getDb(), req.params.id, (req.body || {}).dataUrl)));
router.post('/equipment/:id/photo/delete', (req, res) => { Photo.removePhoto(getDb(), req.params.id); ok(res); });

// 재구매 목록
router.get('/reorder', (req, res) => ok(res, { items: A.reorderList(getDb()) }));
router.post('/reorder/:id/done', (req, res) => { A.markPurchased(getDb(), req.params.id); ok(res); });

// 알림 기록 (8단계)
router.get('/notifications', (req, res) => ok(res, A.notifications(getDb(), req.query.after)));
router.post('/notifications/read-all', (req, res) => { A.markAllRead(getDb()); ok(res); });

// 모델과 기구 연결 (11-3, 10단계)
router.get('/class-map', (req, res) => ok(res, RA.classMapView(getDb(), labFilter(getDb(), req.query.lab))));
router.post('/class-map', (req, res) => { const b = req.body || {}; ok(res, RA.saveClassMap(getDb(), b.className, b.equipmentIds, labFilter(getDb(), b.labId))); });
router.post('/recognition-settings', (req, res) => { RA.saveRecognitionSettings(getDb(), req.body || {}); ok(res); });

// 인식 정확도 (11-4, 10단계)
router.get('/accuracy', (req, res) => ok(res, RA.accuracy(getDb(), req.query.version, labFilter(getDb(), req.query.lab))));
router.get('/accuracy.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('기구인식기록.csv')}`);
  res.send(RA.accuracyCsv(getDb(), A.csvCell));
});

// 기자재 자료집: 보기 / 골라서 실험실에 넣기
router.get('/catalog', (req, res) => ok(res, Catalog.listCatalog(getDb())));
router.post('/catalog/add', (req, res) => { const b = req.body || {}; ok(res, Catalog.addFromCatalog(getDb(), b.ids, labFilter(getDb(), b.labId))); });

// 실험실 관리 (13단계)
router.get('/labs', (req, res) => ok(res, { labs: Labs.listLabs(getDb()) }));
// 실험실을 만들거나 영어 코드를 바꾸면 그 실험실 모델 폴더도 만들어 둠
router.post('/labs', (req, res) => { const r = Labs.saveLab(getDb(), req.body || {}); RA.ensureModelFolders(getDb()); ok(res, r); });
router.post('/labs/:id', (req, res) => { const r = Labs.saveLab(getDb(), req.body || {}, req.params.id); RA.ensureModelFolders(getDb()); ok(res, r); });
router.post('/labs/:id/delete', (req, res) => { Labs.deleteLab(getDb(), req.params.id); ok(res); });

// 16단계: 학생들이 적은 실험 주제 + 키워드 + 비슷한 말
router.get('/topics', (req, res) => ok(res, { items: Rec.topicSummary(getDb(), labFilter(getDb(), req.query.lab)) }));
router.post('/topics/delete', (req, res) => { const b = req.body || {}; ok(res, Rec.deleteTopic(getDb(), b.equipmentId, b.topic)); });
router.post('/equipment/:id/keywords/add', (req, res) => ok(res, Rec.addKeyword(getDb(), req.params.id, (req.body || {}).keyword)));
router.get('/synonyms', (req, res) => ok(res, { text: getSetting(getDb(), 'recommend_synonyms') }));
router.post('/synonyms', (req, res) => ok(res, Rec.saveSynonyms(getDb(), (req.body || {}).text)));

// 사용 통계
router.get('/stats', (req, res) => ok(res, A.stats(getDb(), req.query.month, labFilter(getDb(), req.query.lab))));

// 설정
router.get('/settings', (req, res) => ok(res, { settings: A.getEditableSettings(getDb()) }));
router.post('/settings', (req, res) => ok(res, { settings: A.saveSettings(getDb(), req.body || {}) }));
router.post('/password', (req, res) => {
  const b = req.body || {};
  const r = auth.changePassword(getDb(), req, res, b.current, b.next, b.next2);
  if (!r.ok) return res.status(400).json(r);
  ok(res);
});

module.exports = router;
