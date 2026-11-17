// ─────────────────────────────────────────────
// 카스 번호(화학 초록 서비스 등록번호) 찾기와 검증 (5-2)
// ─────────────────────────────────────────────
// 모양: "숫자 2~7개 - 숫자 2개 - 숫자 1개"  예: 7647-01-0
// 검증: 마지막 숫자를 뺀 나머지 숫자를 오른쪽부터 1, 2, 3, 4…를 곱해 모두 더하고,
//       10으로 나눈 나머지가 마지막 숫자와 같으면 올바른 번호.
// 예: 7647-01-0 → 1×1 + 0×2 + 7×3 + 4×4 + 6×5 + 7×6 = 110 → 110 % 10 = 0 = 마지막 숫자 ✔

const CAS_SHAPE = /^(\d{2,7})-(\d{2})-(\d)$/;

// 올바른 카스 번호인지 (모양 + 검증 숫자)
function isValidCas(text) {
  const m = CAS_SHAPE.exec(String(text ?? '').trim());
  if (!m) return false;
  const body = m[1] + m[2];            // 마지막 숫자를 뺀 나머지
  const check = Number(m[3]);          // 마지막 숫자
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]); // 오른쪽부터
    sum += digit * (i + 1);
  }
  return sum % 10 === check;
}

// 글자 덩어리(광학 문자 인식 결과)에서 올바른 카스 번호만 모두 찾기 (9단계에서 사용)
// 인식 오류로 생기는 "–", "—", 공백 등을 "-" 로 바로잡아서 찾음. 검증에 실패한 번호는 무시.
function findCasNumbers(text) {
  const cleaned = String(text ?? '').replace(/[‐‑‒–—―−]/g, '-').replace(/\s*-\s*/g, '-');
  const found = cleaned.match(/(?<!\d)\d{2,7}-\d{2}-\d(?!\d)/g) || [];
  return [...new Set(found.filter(isValidCas))];
}

module.exports = { isValidCas, findCasNumbers };
