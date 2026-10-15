import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as bio from '../biometric.js';
import { withBusy } from '../ui.js';

/**
 * 輕鎖定畫面：離開 App 超過設定的分鐘數再回來時蓋在畫面上（登入狀態還在）。
 * 指紋／臉部驗證通過就直接移除、不用再連後端；改用 PIN 則走正常的登入。
 */
export function renderLockScreen({ onUnlock, onUsePin }) {
  const err = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const btn = h('button', { class: 'btn btn-primary btn-block bio-btn', type: 'button', 'data-testid': 'relock-bio' }, icon('fingerprint'), '用指紋／臉部解鎖');
  let done = false;
  async function tryBio(auto) {
    if (done) return;
    await withBusy(btn, async () => {
      try { await bio.unlock(); } catch (e) {
        if (!(auto && e && e.name === 'NotAllowedError')) { err.style.display = ''; mount(err, bio.friendly(e)); }
        return;
      }
      done = true; onUnlock();
    });
  }
  btn.onclick = () => tryBio(false);
  const el = h('div', { class: 'login lockscreen', 'data-testid': 'lockscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': '已鎖定' },
    h('div', { class: 'panel' },
      h('div', { class: 'logo' }, icon('lock')),
      h('h1', null, '財務管理'),
      h('div', { class: 'sub' }, '離開一陣子了，請再驗證一次'),
      h('div', { class: 'card' }, err, btn,
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '8px' }, 'data-testid': 'relock-pin', onclick: () => { done = true; onUsePin(); } }, '改用 PIN 登入'))));
  setTimeout(() => tryBio(true), 150);
  return el;
}
