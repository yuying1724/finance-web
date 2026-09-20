import { h, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import { state, instrumentBySymbol, accountById } from '../store.js';
import * as api from '../api.js';
import { money, amountClass } from '../fmt.js';
import { openSheet, errorText } from '../ui.js';

const S = { seq: 0 };

function qty(n, symbol) { return money(n, symbol, { plain: true, noMask: true }) + ' ' + symbol; }
function plMoney(n, symbol) { return money(n, symbol, { sign: true, noMask: true }); }
function plClass(n) { return amountClass(n > 0 ? 'pos' : n < 0 ? 'neg' : 'mute'); }

function positionItem(p) {
  const inst = instrumentBySymbol(p.symbol);
  const acct = accountById(p.accountId);
  const title = `${p.symbol}　${inst ? inst.name : ''}`;
  const sub = `${acct ? acct.name : p.accountId} · 持有 ${qty(p.qty, p.symbol)}`;
  if (p.missing) {
    return h('button', { class: 'item', onclick: () => openDetail(p) },
      h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub + ' · 成本 ' + money(p.costBase, state.data.base))),
      h('span', { class: 'badge warn' }, '缺價格'));
  }
  return h('button', { class: 'item', onclick: () => openDetail(p) },
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub + ` · 市值 ${money(p.mvBase, state.data.base)}`)),
    h('div', { class: plClass(p.totalBase) }, plMoney(p.totalBase, state.data.base)));
}

function positionDetail(p) {
  const inst = instrumentBySymbol(p.symbol);
  const acct = accountById(p.accountId);
  const quoteSym = p.quote || (inst && inst.quote) || state.data.base;
  const rows = [['帳戶', acct ? acct.name : p.accountId], ['持有股數', qty(p.qty, p.symbol)],
    ['平均成本', money(p.costNative, quoteSym, { noMask: true }) + (p.estimated ? '（部分估算）' : '')]];
  if (!p.missing) {
    rows.push(['現價', money(p.priceNative, quoteSym, { noMask: true })]);
    rows.push(['市值', `${money(p.mvNative, quoteSym, { noMask: true })}　≈ ${money(p.mvBase, state.data.base, { noMask: true })}`]);
    rows.push(['損益（股價）', plMoney(p.pricePl, state.data.base)]);
    if (quoteSym !== state.data.base) rows.push(['損益（匯率）', plMoney(p.fxPl, state.data.base)]);
    rows.push(['總損益', plMoney(p.totalBase, state.data.base)]);
  } else {
    rows.push(['市值', '缺價格，無法估算']);
  }
  return h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function openDetail(p) {
  const inst = instrumentBySymbol(p.symbol);
  openSheet({ title: `${p.symbol}　${inst ? inst.name : ''}`, body: positionDetail(p) });
}

function realizedRow(r) {
  const acct = accountById(r.accountId);
  return h('li', null, h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${r.date}　${r.symbol}　賣出 ${qty(r.qty, r.symbol)}`), h('div', { class: 's' }, acct ? acct.name : r.accountId)),
    h('div', { class: plClass(r.realizedBase === null ? r.realizedNative : r.realizedBase) },
      r.realizedBase === null ? plMoney(r.realizedNative, r.quote) + '（估算）' : plMoney(r.realizedBase, state.data.base))));
}

function dividendRow(dv) {
  const acct = accountById(dv.accountId);
  return h('li', null, h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${dv.date}　${dv.relatedSymbol || dv.symbol}　股息`), h('div', { class: 's' }, acct ? acct.name : dv.accountId)),
    h('div', { class: amountClass('pos') }, '+' + money(dv.net, dv.symbol, { noMask: true }))));
}

/** 只畫「持倉」分頁的內容（不含頁首與分頁切換，那些由 invest.js 統一處理） */
export function renderHoldingsBody(root) {
  const listBox = h('div', { class: 'card' });
  mount(root, listBox);
  mount(listBox, h('div', { class: 'empty' }, '載入中…'));

  const my = ++S.seq;
  api.call('getHoldings', {}).then((res) => {
    if (my !== S.seq) return;
    clear(listBox);
    if (!res.positions.length) {
      listBox.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big' }, icon('graphUp')), '目前沒有投資部位。用右下角「＋」記一筆「買入」開始。'));
    } else {
      const totalBase = res.positions.reduce((s, p) => s + (p.missing ? 0 : p.totalBase), 0);
      const mvBase = res.positions.reduce((s, p) => s + (p.missing ? 0 : p.mvBase), 0);
      listBox.appendChild(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '總市值'), h('div', { class: 'v' }, money(mvBase, state.data.base))),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '未實現損益'), h('div', { class: 'v ' + (totalBase >= 0 ? 'amt-pos' : 'amt-neg') }, plMoney(totalBase, state.data.base)))));
      listBox.appendChild(h('div', { class: 'day-head' }, h('span', null, '持倉')));
      listBox.appendChild(h('ul', { class: 'list' }, res.positions.map((p) => h('li', null, positionItem(p)))));
    }
    if (res.realized.length) {
      listBox.appendChild(h('div', { class: 'day-head', style: { marginTop: '14px' } }, h('span', null, '已實現損益（最近）')));
      listBox.appendChild(h('ul', { class: 'list' }, res.realized.slice().reverse().slice(0, 20).map((r) => realizedRow(r))));
    }
    if (res.dividends.length) {
      listBox.appendChild(h('div', { class: 'day-head', style: { marginTop: '14px' } }, h('span', null, '股息（最近）')));
      listBox.appendChild(h('ul', { class: 'list' }, res.dividends.slice().reverse().slice(0, 20).map((dv) => dividendRow(dv))));
    }
    if (res.issues.length) {
      listBox.appendChild(h('div', { class: 'notice bad', style: { marginTop: '14px' } }, res.issues.map((i) => i.message).join('；')));
    }
  }).catch((e) => { if (my !== S.seq) return; mount(listBox, h('div', { class: 'notice bad' }, errorText(e))); });
}
