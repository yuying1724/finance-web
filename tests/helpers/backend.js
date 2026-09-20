'use strict';
/** 載入「打包後的」dist/Code.gs（真正要貼進 Apps Script 的那份）到隔離環境，搭配 Google 服務模擬 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMocks } = require('./gas-mocks.js');

const CODE = path.join(__dirname, '../../dist/Code.gs');

function loadBackend() {
  const mock = createMocks();
  const ctx = vm.createContext(Object.assign({ console }, mock.globals));
  vm.runInContext(fs.readFileSync(CODE, 'utf8'), ctx, { filename: 'Code.gs' });
  ctx.FinClock.now = () => mock.state.clock.now;
  const ss = mock.state.spreadsheets.SS_MAIN;

  function post(body) {
    const out = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(out.getContent());
  }
  function rawPost(contents) { return JSON.parse(ctx.doPost({ postData: { contents } }).getContent()); }

  const backend = { ctx, mock, state: mock.state, ss, post, rawPost, session: null, token: null };

  /** 完整初始化：建立資料表、設定 PIN、建立一台裝置並登入 */
  backend.setup = function setup(opts = {}) {
    const pin = opts.pin || '246810';
    ctx.FinSetup.initialize(ss);
    ctx.FinAuth.setPin(pin);
    const dev = ctx.FinAuth.addDevice(opts.deviceName || '測試手機');
    backend.token = dev.token; backend.pin = pin; backend.deviceId = dev.id;
    backend.login();
    return backend;
  };
  backend.login = function login(token = backend.token, pin = backend.pin) {
    const r = post({ action: 'login', params: { token, pin } });
    if (r.ok) backend.session = r.data.session;
    return r;
  };
  /** 已登入的呼叫；若回應帶新 session 就自動更新 */
  backend.call = function call(action, params = {}) {
    const r = post({ action, params, session: backend.session });
    if (r.session) backend.session = r.session;
    return r;
  };
  backend.advance = (ms) => { mock.state.clock.now += ms; };
  return backend;
}

module.exports = { loadBackend };
