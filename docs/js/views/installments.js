import { h } from '../dom.js';
import { state } from '../store.js';
import { money } from '../fmt.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { write } from '../data.js';

/**
 * 信用卡分期（零利率）的共用畫面：交易詳情的「設為分期／提前清償」、帳單裡的「分期中」清單。
 * 購買當下已經記全額，這裡只改「帳單怎麼分期出帳」，不影響淨資產與可用額度。
 */

export function installmentOf(txId) {
  return ((state.data && state.data.installments) || []).find((x) => x.txId === txId) || null;
}

/** 一行摘要：「分 6 期・第 2/6 期 5,000・未出帳 20,000」 */
export function installmentText(x) {
  if (!x) return '';
  const cur = x.currentPeriods && x.currentPeriods.length ? `本期第 ${x.currentPeriods.join('～')}/${x.terms} 期 ${money(x.currentAmount, x.symbol)}` : '';
  if (x.status === '已完成') return `分 ${x.terms} 期・已全部出帳`;
  if (x.status === '已提前清償') return `分 ${x.terms} 期・已提前清償（${x.payoffDate}）`;
  return [`分 ${x.terms} 期`, x.status === '提前清償中' ? `提前清償（${x.payoffDate}）` : '', cur, x.remaining > 0 ? `之後未出帳 ${money(x.remaining, x.symbol)}` : '']
    .filter(Boolean).join('・');
}

/** 帳單裡的「分期中」清單 */
export function installmentListBlock(list) {
  if (!list || !list.length) return null;
  return h('div', { style: { marginTop: '12px' }, 'data-testid': 'inst-list' },
    h('div', { class: 'day-head' }, h('span', null, `分期中（${list.length} 筆）`)),
    h('ul', { class: 'list' }, list.map((x) => h('li', null, h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, x.name, h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, `${x.date}　共 ${money(x.total, x.symbol)}`)),
        h('div', { class: 's' }, installmentText(x))),
      h('div', { class: 'amt' }, x.currentAmount ? money(x.currentAmount, x.symbol) : ''))))));
}

/** 把一筆信用卡支出設為分期 */
export function openSetInstallment(t) {
  const f = { terms: '6', remainderOn: '首期' };
  const termsInput = h('input', { type: 'text', inputmode: 'numeric', value: f.terms, 'aria-label': '分期期數', oninput: (e) => { f.terms = e.target.value; } });
  const remSel = h('select', { 'aria-label': '零頭', onchange: (e) => { f.remainderOn = e.target.value; } }, ['首期', '末期'].map((v) => h('option', { value: v }, `零頭放${v}`)));
  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'inst-save', onclick: async () => {
    const n = Number(String(f.terms).trim());
    if (!(n >= 2 && n <= 60 && Math.floor(n) === n)) { toast('分期期數請填 2～60 的整數', { kind: 'bad' }); return; }
    sheet.close();
    const r = await write('addInstallment', { txId: t.id, terms: n, remainderOn: f.remainderOn }, { failPrefix: '設定失敗：' });
    if (r) toast(`已設為分 ${n} 期`);
  } }, '設為分期');
  const sheet = openSheet({
    title: '設為分期（零利率）',
    body: h('div', null,
      h('div', { class: 'notice', style: { marginBottom: '12px' } }, `${money(t.srcQty, t.srcSymbol, { noMask: true })}（${t.date}）：已經記全額，設為分期後帳單每期只算一份`),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, '期數'), termsInput,
        h('div', { class: 'chips', style: { marginTop: '6px' } }, [3, 6, 12, 24].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => { f.terms = String(n); termsInput.value = String(n); } }, `${n} 期`)))),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, '零頭'), remSel)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
}

/** 提前清償（剩下的各期一次進今天所在的那期帳單）／取消提前清償 */
export async function togglePayoff(x) {
  const undo = !!x.payoffDate;
  const today = state.data.today;
  if (!undo && !(await confirmDialog({ title: '提前清償？', message: `剩下未出帳的 ${money(x.remaining + (x.currentAmount || 0), x.symbol, { noMask: true })} 會全部算進這一期的帳單。`, confirmText: '提前清償' }))) return;
  const r = await write('setInstallmentPayoff', { id: x.id, date: undo ? '' : today }, { failPrefix: '操作失敗：' });
  if (r) toast(undo ? '已取消提前清償' : '已提前清償');
}
