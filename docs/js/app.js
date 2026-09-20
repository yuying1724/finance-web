import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { prefs, state, subscribe, applyTheme } from './store.js';
import { refresh } from './data.js';
import * as api from './api.js';
import { closeAllSheets } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderTransactions } from './views/transactions.js';
import { renderAccounts } from './views/accounts.js';
import { renderInvest } from './views/invest.js';
import { renderSettings } from './views/settings.js';
import { openTxForm } from './views/txform.js';

const app = document.getElementById('app');
const TABS = [
  { id: 'home', label: '首頁', icon: 'home', render: renderHome },
  { id: 'tx', label: '交易', icon: 'list', render: renderTransactions },
  { id: 'accounts', label: '帳戶', icon: 'wallet', render: renderAccounts },
  { id: 'invest', label: '投資', icon: 'graphUp', render: renderInvest },
  { id: 'settings', label: '設定', icon: 'sliders', render: renderSettings },
];

let viewRoot = null;
let lastActive = Date.now();

export function parseRoute() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/');
  return { tab: TABS.some((t) => t.id === parts[0]) ? parts[0] : 'home', sub: parts[1] || '', params: Object.fromEntries(new URLSearchParams(query)) };
}

function renderView() {
  if (!viewRoot || !state.data) return;
  const r = parseRoute();
  const tab = TABS.find((t) => t.id === r.tab);
  document.querySelectorAll('[data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === r.tab));
  try {
    tab.render(viewRoot, r);
  } catch (e) {
    console.error(e);
    mount(viewRoot, h('div', { class: 'notice bad' }, '畫面發生錯誤：' + e.message));
  }
}

function showShell() {
  const nav = (cls) => TABS.map((t) => h('a', { href: '#/' + t.id, 'data-tab': t.id, class: cls }, icon(t.icon), h('span', null, t.label)));
  viewRoot = h('main', { class: 'main', id: 'view' });
  const shell = h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' }, icon('coin'), '財務管理'),
      nav(''),
      h('div', { class: 'spacer' }),
      h('button', { class: 'navlike', onclick: () => lock('已鎖定') }, icon('lock'), '鎖定')),
    viewRoot,
    h('nav', { class: 'tabbar', 'aria-label': '主選單' }, nav('')),
    h('button', { class: 'fab', 'aria-label': '記一筆', onclick: () => openTxForm({ onDone: refresh }) }, icon('plus')));
  mount(app, shell);
  renderView();
}

export function lock(message) {
  api.clearSession();
  state.data = null;
  closeAllSheets();
  viewRoot = null;
  renderLogin(app, { message, onSuccess: start });
}

async function start() {
  applyTheme();
  if (!api.hasValidSession()) { renderLogin(app, { onSuccess: start }); return; }
  mount(app, h('div', { class: 'boot' }, '載入中…'));
  try {
    await refresh();
    showShell();
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED') return; // 已由 authLost 處理
    mount(app, h('div', { class: 'login' }, h('div', { class: 'panel card center' },
      h('h2', null, '無法載入資料'), h('p', { class: 'muted' }, e.message),
      h('button', { class: 'btn btn-primary btn-block', onclick: start }, '重試'),
      h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onclick: () => lock() }, '重新登入'))));
  }
}

api.setAuthLostHandler(() => { if (state.data || viewRoot) lock('登入已過期，請重新輸入 PIN'); });
subscribe(renderView);
window.addEventListener('hashchange', () => { closeAllSheets(); renderView(); window.scrollTo(0, 0); });

// 閒置太久自動鎖定（時間取自後端的「閒置登出分鐘」）
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => {
  const s = prefs.session;
  if (!s || !viewRoot) return;
  if (Date.now() - lastActive > (s.ttl || 60) * 60000) lock('閒置太久，已自動鎖定');
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !viewRoot) return;
  if (!api.hasValidSession()) lock('登入已過期，請重新輸入 PIN');
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });

start();
