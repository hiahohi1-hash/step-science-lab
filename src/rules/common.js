// ─────────────────────────────────────────────
// 규칙 파일들이 함께 쓰는 것: 규칙 위반 오류, 학번·이름 검사
// ─────────────────────────────────────────────

// 규칙에 맞지 않을 때 던지는 오류.
// message: 무엇이 잘못됐는지 / hint: 어떻게 하면 되는지 (화면에 둘 다 보여 줌)
class RuleError extends Error {
  constructor(message, hint = '', status = 400) {
    super(message);
    this.name = 'RuleError';
    this.hint = hint;
    this.status = status;
  }
}

// 학번 검사: 숫자 4~10자리
function checkStudentId(studentId) {
  const s = String(studentId ?? '').trim();
  if (!/^\d{4,10}$/.test(s)) {
    throw new RuleError('학번이 올바르지 않아요.', '학번은 숫자만 4~10자리로 입력해 주세요. (예: 20315)');
  }
  return s;
}

// 이름 검사: 1~20글자
function checkName(name) {
  const s = String(name ?? '').trim();
  if (s.length < 1 || s.length > 20) {
    throw new RuleError('이름을 확인해 주세요.', '이름은 1~20글자로 입력해 주세요.');
  }
  return s;
}

// 숫자 번호 검사 (시약 번호, 기록 번호 등)
function checkId(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new RuleError(`${what} 번호가 올바르지 않아요.`, '처음 화면에서 다시 시작해 주세요.');
  return n;
}

module.exports = { RuleError, checkStudentId, checkName, checkId };
