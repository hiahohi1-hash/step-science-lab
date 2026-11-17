// 카스 번호 검증 테스트 (명세 5-2, 11단계)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidCas, findCasNumbers } = require('../src/rules/casNumber');

test('7647-01-0 은 올바른 카스 번호', () => {
  assert.equal(isValidCas('7647-01-0'), true);
});

test('7647-01-1 은 틀린 카스 번호 (검증 숫자가 다름)', () => {
  assert.equal(isValidCas('7647-01-1'), false);
});

test('예시 시약 10가지의 카스 번호는 모두 올바름', () => {
  for (const cas of ['7647-01-0', '7664-93-9', '7697-37-2', '1310-73-2', '7761-88-8', '64-17-5', '67-64-1', '7647-14-5', '77-09-8', '7722-84-1']) {
    assert.equal(isValidCas(cas), true, cas);
  }
});

test('모양이 틀리면 올바르지 않음 (숫자 2~7개 - 2개 - 1개)', () => {
  for (const bad of ['1-01-0', '12345678-01-0', '7647-1-0', '7647-01-00', '7647010', 'abc-de-f', '']) {
    assert.equal(isValidCas(bad), false, bad);
  }
});

test('라벨 글자에서 올바른 카스 번호만 찾고, 검증에 실패한 번호는 무시', () => {
  const text = 'Hydrochloric acid\nCAS No. 7647–01–0  Lot 12-34-5\nEthanol 64-17-5, fake 7647-01-1';
  assert.deepEqual(findCasNumbers(text), ['7647-01-0', '64-17-5']);
});
