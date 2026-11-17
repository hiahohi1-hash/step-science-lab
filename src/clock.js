// ─────────────────────────────────────────────
// "현재 시각"을 알려 주는 함수를 딱 한 곳에 모아 둔 파일
// ─────────────────────────────────────────────
// 앱의 모든 코드는 new Date() 대신 now() 를 써야 합니다.
// 그래야 테스트할 때 setNow() 로 "지금이 오후 6시 1분이라고 치자"처럼
// 시간을 마음대로 바꿔 가며 규칙을 확인할 수 있습니다.

let fakeTime = null; // 테스트용으로 정해 둔 가짜 시각 (null이면 진짜 시각 사용)

// 지금 시각을 Date 로 돌려줌
function now() {
  return fakeTime ? new Date(fakeTime.getTime()) : new Date();
}

// (테스트 전용) 지금 시각을 정해 둠. 예: setNow(new Date('2026-11-14T18:01:00+09:00'))
function setNow(date) {
  fakeTime = date ? new Date(date) : null;
}

// (테스트 전용) 가짜 시각을 분 단위로 앞으로 보냄. 예: advanceMinutes(10)
function advanceMinutes(minutes) {
  fakeTime = new Date(now().getTime() + minutes * 60 * 1000);
}

module.exports = { now, setNow, advanceMinutes };
