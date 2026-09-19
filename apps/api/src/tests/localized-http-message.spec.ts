import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localizeHttpMessage } from '../common/localize-http-message';

test('known authentication and benchmark errors are localized precisely', () => {
  assert.equal(localizeHttpMessage('Invalid account or password.', 401), '账号或密码错误。');
  assert.equal(
    localizeHttpMessage('Higher-is-better thresholds must satisfy S ≥ A ≥ B ≥ C.', 400),
    '越高越好的指标必须满足 S ≥ A ≥ B ≥ C。',
  );
});

test('existing Chinese messages are preserved', () => {
  assert.equal(localizeHttpMessage('请填写确认说明。', 400), '请填写确认说明。');
});

test('unknown English messages use a Chinese status fallback', () => {
  assert.equal(
    localizeHttpMessage('Some internal validation detail.', 400),
    '请求参数不符合要求，请检查填写内容。',
  );
  assert.equal(
    localizeHttpMessage('You do not have permission to continue.', 403),
    '当前账号没有执行此操作的权限。',
  );
});
