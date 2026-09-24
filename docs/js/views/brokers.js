import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, brokerSettingsOf } from '../store.js';
import { openBrokerForm } from './brokerform.js';

function acctItem(a) {
  const bs = brokerSettingsOf(a.id);
  const sub = bs ? `${bs.market} · ${bs.calendar} · 買 T+${bs.buySettleDays} 賣 T+${bs.sellSettleDays}` : '尚未設定';
  return h('button', { class: 'item', onclick: () => openBrokerForm({ account: a, broker: bs }) },
    h('div', { class: 'ico' }, icon('briefcase')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, a.name, a.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')), h('div', { class: 's' }, sub)),
    h('span', { class: 'link-btn' }, bs ? '編輯' : '設定'));
}

/** 只畫「券商設定」分頁的內容（不含頁首與分頁切換，那些由 invest.js 統一處理） */
export function renderBrokersBody(root) {
  const d = state.data;
  const accounts = d.accounts.filter((a) => a.type === '證券' || a.type === '加密交易所');
  const body = accounts.length
    ? h('div', { class: 'card' }, h('ul', { class: 'list' }, accounts.map((a) => h('li', null, acctItem(a)))))
    : h('div', { class: 'card empty' }, h('div', { class: 'big' }, icon('briefcase')), '還沒有「證券」或「加密交易所」類型的帳戶。請先到「帳戶」新增。');
  mount(root, h('p', { class: 'muted small' }, '手續費率、證交稅率、交割天數等，依帳戶分別設定。'), body);
}
