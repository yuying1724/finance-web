'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

const MIN = 60000;

test('ping 與 GET 不需登入，也不洩漏任何資料', () => {
  const b = loadBackend().setup();
  const r = b.post({ action: 'ping' });
  assert.ok(r.ok); assert.equal(r.data.name, 'finance-web');
  const g = JSON.parse(b.ctx.doGet().getContent());
  assert.ok(g.ok);
  assert.ok(!JSON.stringify(g).includes('SS_MAIN'));
});

test('沒有登入就不能呼叫任何需要資料的操作', () => {
  const b = loadBackend().setup();
  for (const action of ['bootstrap', 'listTransactions', 'addTransaction', 'upsertAccount', 'changePin', 'monthSummary']) {
    const r = b.post({ action, params: {} });
    assert.equal(r.ok, false, action);
    assert.equal(r.error.code, 'AUTH_REQUIRED', action);
  }
});

test('登入成功後可以呼叫；授權碼不分大小寫與連字號', () => {
  const b = loadBackend().setup();
  assert.ok(b.call('bootstrap').ok);
  const loose = b.token.toLowerCase().replace(/-/g, ' ');
  assert.ok(b.post({ action: 'login', params: { token: loose, pin: b.pin } }).ok);
});

test('授權碼錯誤：一律失敗、有延遲、而且不會累積鎖定（別人亂猜鎖不到你）', () => {
  const b = loadBackend().setup();
  for (let i = 0; i < 10; i++) {
    const r = b.post({ action: 'login', params: { token: 'AAAAA-BBBBB-CCCCC-DDDDD', pin: b.pin } });
    assert.equal(r.error.code, 'AUTH_FAILED');
  }
  assert.ok(b.state.sleptMs >= 7000);
  assert.ok(b.login().ok, '真正的裝置仍可登入');
});

test('授權碼正確但 PIN 錯誤：第 5 次鎖定 15 分鐘，之後解除', () => {
  const b = loadBackend().setup();
  let r;
  for (let i = 1; i <= 4; i++) {
    r = b.login(b.token, '000001');
    assert.equal(r.error.code, 'AUTH_FAILED');
    assert.equal(r.error.details.remaining, 5 - i);
  }
  r = b.login(b.token, '000001');
  assert.equal(r.error.code, 'LOCKED');
  assert.equal(b.login().error.code, 'LOCKED', '鎖定期間連正確的 PIN 也不能登入');
  b.advance(14 * MIN);
  assert.equal(b.login().error.code, 'LOCKED');
  b.advance(2 * MIN);
  assert.ok(b.login().ok);
});

test('成功登入會清除失敗次數', () => {
  const b = loadBackend().setup();
  for (let i = 0; i < 3; i++) b.login(b.token, '000001');
  assert.ok(b.login().ok);
  for (let i = 0; i < 4; i++) assert.equal(b.login(b.token, '000001').error.code, 'AUTH_FAILED');
  assert.ok(b.login().ok, '清除後重新計算，第 4 次錯誤時還沒鎖');
});

test('工作階段：閒置逾時要重新登入；有操作會自動續期', () => {
  const b = loadBackend().setup();
  const first = b.session;
  b.advance(20 * MIN);
  assert.ok(b.call('bootstrap').ok);
  assert.equal(b.session, first, '剩餘超過一半效期，不換發');
  b.advance(35 * MIN); // 累計 55 分鐘，剩不到一半
  const r = b.call('bootstrap');
  assert.ok(r.ok); assert.notEqual(b.session, first, '已換發新的工作階段碼');
  b.advance(50 * MIN);
  assert.ok(b.call('bootstrap').ok, '續期後又可以再撐一段');
  b.advance(61 * MIN);
  assert.equal(b.call('bootstrap').error.code, 'AUTH_REQUIRED');
});

test('工作階段碼被竄改（換裝置、延長效期、亂改簽章）一律拒絕', () => {
  const b = loadBackend().setup();
  const [dev, iat, exp, ttl, sig] = b.session.split('.');
  const forged = [
    [dev, iat, String(Number(exp) + 86400000), ttl, sig].join('.'),
    ['D99', iat, exp, ttl, sig].join('.'),
    [dev, iat, exp, ttl, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')].join('.'),
    [dev, iat, exp, ttl].join('.'),
    'garbage', '', '....', null,
  ];
  for (const s of forged) {
    const r = b.post({ action: 'bootstrap', params: {}, session: s });
    assert.equal(r.error.code, 'AUTH_REQUIRED', String(s));
  }
});

test('撤銷裝置：該裝置的登入立刻失效，其他裝置不受影響', () => {
  const b = loadBackend().setup();
  const other = b.ctx.FinAuth.addDevice('平板');
  const r2 = b.post({ action: 'login', params: { token: other.token, pin: b.pin } });
  assert.ok(r2.ok);
  assert.ok(b.ctx.FinAuth.revokeDevice(b.deviceId));
  assert.equal(b.call('bootstrap').error.code, 'AUTH_REQUIRED');
  assert.equal(b.login().error.code, 'AUTH_FAILED');
  assert.ok(b.post({ action: 'bootstrap', params: {}, session: r2.data.session }).ok);
});

test('登出所有裝置：所有既有工作階段失效，但授權碼與 PIN 仍可重新登入', () => {
  const b = loadBackend().setup();
  b.ctx.FinAuth.signOutAll();
  assert.equal(b.call('bootstrap').error.code, 'AUTH_REQUIRED');
  assert.ok(b.login().ok);
});

test('變更 PIN：需要舊 PIN；新 PIN 要符合規則；舊 PIN 之後失效', () => {
  const b = loadBackend().setup();
  assert.equal(b.call('changePin', { oldPin: 'wrong', newPin: '135790' }).error.code, 'AUTH_FAILED');
  assert.equal(b.call('changePin', { oldPin: b.pin, newPin: '123' }).error.code, 'WEAK_PIN');
  assert.ok(b.call('changePin', { oldPin: b.pin, newPin: '135790' }).ok);
  assert.equal(b.login(b.token, b.pin).error.code, 'AUTH_FAILED');
  assert.ok(b.login(b.token, '135790').ok);
});

test('Script Properties 只存雜湊，不存明碼授權碼與 PIN', () => {
  const b = loadBackend().setup();
  const dump = JSON.stringify(b.state.props);
  assert.ok(!dump.includes(b.pin));
  assert.ok(!dump.includes(b.token.replace(/-/g, '')));
  assert.ok(!dump.includes(b.token));
});

test('PIN 尚未設定時登入會給明確錯誤，而不是放行', () => {
  const b = loadBackend();
  b.ctx.FinSetup.initialize(b.ss);
  const dev = b.ctx.FinAuth.addDevice('x');
  const r = b.post({ action: 'login', params: { token: dev.token, pin: '' } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_INITIALIZED');
});

test('尚未初始化時，所有操作都給明確的錯誤且不崩潰', () => {
  const b = loadBackend();
  assert.equal(b.post({ action: 'bootstrap', params: {}, session: 'x.1.2.3.abc' }).ok, false);
  assert.equal(b.post({ action: 'login', params: { token: 'x', pin: 'y' } }).error.code, 'AUTH_FAILED');
});

test('壞請求：非 JSON、陣列、未知操作、原型鏈名稱、超大請求', () => {
  const b = loadBackend().setup();
  assert.equal(b.rawPost('{not json').error.code, 'BAD_REQUEST');
  assert.equal(b.rawPost('[1,2]').error.code, 'BAD_REQUEST');
  assert.equal(b.rawPost('null').error.code, 'BAD_REQUEST');
  assert.equal(b.post({ action: 'nope' }).error.code, 'BAD_ACTION');
  for (const a of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(b.post({ action: a, session: b.session }).error.code, 'BAD_ACTION', a);
  assert.equal(b.rawPost('{"action":"ping","pad":"' + 'x'.repeat(210000) + '"}').error.code, 'BAD_REQUEST');
  assert.equal(b.rawPost('').error.code, 'BAD_ACTION'); // 空 body 視為沒指定操作
});
