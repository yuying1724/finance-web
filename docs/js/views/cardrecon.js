import { h, mount, clear } from '../dom.js';
import * as api from '../api.js';
import { money } from '../fmt.js';
import { openSheet, toast, errorText, loading } from '../ui.js';
import { refreshInBackground } from '../data.js';

/**
 * 信用卡對帳模式：打開某張卡（同額度群組就是整張合併帳單）某一期的明細，對著銀行帳單一筆一筆打勾。
 * 上面填銀行帳單的「本期新增消費」金額，系統合計跟它比，差額 0 就是對上了。
 * 銀行沒列進這期的，按「移到下期」（改這筆的信用卡入帳日）；勾選狀態與銀行金額存在後端，換裝置也看得到。
 */
const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const KIND = { refund: '退款', installment: '分期', transfer: '轉出', credit: '回饋' };
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const r2 = (x) => Math.round(x * 100) / 100;

export function openCardRecon(accountId, closeDate) {
  const body = h('div', null, loading());
  const sheet = openSheet({ title: '信用卡對帳', body });
  let r = null;
  let busy = Promise.resolve();

  const load = (cd) => api.call('getCardRecon', { accountId, closeDate: cd || '' }).then((res) => { r = res; draw(); })
    .catch((e) => { clear(body); mount(body, h('div', { class: 'notice bad' }, errorText(e))); });

  function recompute() {
    let tot = 0, chk = 0, n = 0;
    r.lines.forEach((l) => { tot += l.amount; if (l.checked) { chk += l.amount; n++; } });
    r.total = r2(tot); r.checkedTotal = r2(chk); r.checkedCount = n;
    r.diff = r.bankAmount === null ? null : r2(r.bankAmount - r.total);
  }

  /** 勾選／取消：畫面先變，背景送出；失敗就還原 */
  function setChecked(lines, on) {
    const changed = lines.filter((l) => l.checked !== on);
    if (!changed.length) return;
    changed.forEach((l) => { l.checked = on; });
    recompute(); draw();
    const params = { accountId, closeDate: r.period.end, [on ? 'check' : 'uncheck']: changed.map((l) => l.key) };
    busy = busy.then(() => api.call('setCardRecon', params)).catch((e) => {
      changed.forEach((l) => { l.checked = !on; });
      recompute(); draw();
      toast('沒有存到，已還原：' + errorText(e), { kind: 'bad' });
    });
  }

  function saveBank(value) {
    const v = String(value).replace(/[,\s]/g, '');
    const amt = v === '' ? null : Number(v);
    if (amt !== null && !isFinite(amt)) { toast('銀行帳單金額請輸入數字', { kind: 'bad' }); return; }
    r.bankAmount = amt; recompute(); draw();
    busy = busy.then(() => api.call('setCardRecon', { accountId, closeDate: r.period.end, bankAmount: amt === null ? '' : amt }))
      .catch((e) => toast('銀行金額沒有存到：' + errorText(e), { kind: 'bad' }));
  }

  async function move(l, settleDate) {
    try {
      await busy;
      await api.call('moveCardTx', { txId: l.txId, settleDate, expectedUpdatedAt: l.updatedAt });
      toast(settleDate ? `已移到下期（入帳日 ${md(settleDate)}）` : '已改回依消費日入帳');
      refreshInBackground();
      await load(r.period.end);
    } catch (e) { toast(errorText(e), { kind: 'bad' }); }
  }

  function draw() {
    clear(body);
    const sym = r.symbol;
    const periodSel = h('select', { 'aria-label': '帳單期別', 'data-testid': 'recon-period', onchange: (e) => load(e.target.value) },
      r.periods.map((p) => h('option', { value: p.end, selected: p.end === r.period.end },
        `${md(p.start)}～${md(p.end)}${p.current ? '（本期，還沒結帳）' : ''}`)));
    periodSel.value = r.period.end;

    const bankInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: '照銀行帳單填', 'data-testid': 'recon-bank',
      value: r.bankAmount === null ? '' : String(r.bankAmount), onchange: (e) => saveBank(e.target.value) });
    const diffView = r.diff === null ? h('span', { class: 'muted' }, '填了銀行金額才會比對')
      : r.diff === 0 ? h('span', { class: 'badge good', 'data-testid': 'recon-diff' }, '對上了')
        : h('span', { 'data-testid': 'recon-diff' }, h('b', null, money(Math.abs(r.diff), sym)), h('span', { class: 'muted small' }, r.diff > 0 ? '（銀行比較多，可能有漏記）' : '（系統比較多，可能有記重複或該移到下期的）'));

    const all = r.lines;
    const head = h('div', null,
      h('div', { class: 't', style: { fontWeight: 600, marginBottom: '6px' } }, r.isGroup ? `${r.name}（合併帳單）` : r.name),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, '帳單期別'), periodSel),
      h('div', { class: 'muted small', style: { margin: '-2px 0 10px' } }, `結帳日 ${r.period.end}，繳款截止 ${r.dueDate}`),
      h('dl', { class: 'kv' },
        h('dt', null, '系統合計'), h('dd', { 'data-testid': 'recon-total' }, money(r.total, sym), h('span', { class: 'muted small' }, `（${all.length} 筆）`)),
        h('dt', null, '已勾選'), h('dd', { 'data-testid': 'recon-checked' }, money(r.checkedTotal, sym), h('span', { class: 'muted small' }, `（${r.checkedCount}/${all.length} 筆）`)),
        h('dt', null, '銀行帳單'), h('dd', null, bankInput),
        h('dt', null, '差額'), h('dd', null, diffView)),
      h('div', { class: 'muted small', style: { marginTop: '6px' } }, '銀行帳單金額填「本期新增消費」（不含上期未繳和繳款）。分期只算這期輪到的那一期。'));

    const unchecked = all.filter((l) => !l.checked);
    const tools = all.length ? h('div', { class: 'row-flex wrap', style: { margin: '12px 0 4px' } },
      h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'recon-all', onclick: () => setChecked(all, true) }, '全部勾選'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setChecked(all, false) }, '全部取消'),
      unchecked.length && r.checkedCount ? h('span', { class: 'muted small' }, `還有 ${unchecked.length} 筆沒勾：${money(r2(unchecked.reduce((a, l) => a + l.amount, 0)), sym)}`) : null) : null;

    const nextStart = addDays(r.period.end, 1);
    const nearFrom = addDays(r.period.end, -7);
    const list = all.length ? h('ul', { class: 'list recon-list', 'data-testid': 'recon-lines' }, all.map((l) => {
      const cb = h('input', { type: 'checkbox', checked: l.checked, 'aria-label': `${l.label} ${l.amount}`, onchange: (e) => setChecked([l], e.target.checked) });
      const sub = [md(l.date) + (l.settleDate ? `（入帳 ${md(l.billDate)}）` : ''), r.isGroup ? l.cardName : '', l.category, l.note].filter(Boolean).join(' · ');
      const actions = [];
      // 「移到下期」只放在結帳日前一週內的消費（銀行常常隔幾天才請款）；填過入帳日的可以改回來
      if (l.movable && !r.current && l.billDate >= nearFrom) actions.push(h('button', { type: 'button', class: 'link-btn small', 'data-testid': 'recon-move', onclick: () => move(l, nextStart) }, '移到下期'));
      if (l.movable && l.settleDate) actions.push(h('button', { type: 'button', class: 'link-btn small', onclick: () => move(l, '') }, '改回依消費日'));
      return h('li', { class: l.checked ? 'done' : '', 'data-key': l.key },
        h('div', { class: 'item' },
          h('label', { class: 'check', style: { flex: 'none' } }, cb),
          h('div', { class: 'grow', onclick: () => setChecked([l], !l.checked) },
            h('div', { class: 't' }, l.label, KIND[l.kind] ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, KIND[l.kind]) : null),
            h('div', { class: 's' }, sub)),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt' }, money(l.amount, sym)), actions.length ? h('div', null, actions) : null)));
    })) : h('div', { class: 'empty' }, '這一期沒有消費');

    const pays = r.payments.length ? h('div', null,
      h('div', { class: 'day-head' }, h('span', null, '這期轉入卡片的錢（繳款等，不算在消費裡）')),
      h('ul', { class: 'list' }, r.payments.map((x) => h('li', null, h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, x.label), h('div', { class: 's' }, [md(x.date), r.isGroup ? x.cardName : ''].filter(Boolean).join(' · '))),
        h('div', { class: 'amt muted' }, money(x.amount, sym))))))) : null;

    mount(body, head, tools, list, pays);
  }

  load(closeDate);
  return sheet;
}
