import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';
import { refresh } from '../data.js';

let catType = '支出';

export function renderCategories(root, { subtabs }) {
  const d = state.data;
  const parents = d.categories.filter((c) => !c.parentId && c.type === catType);
  const card = h('div', { class: 'card' });
  for (const p of parents) {
    card.appendChild(h('div', { class: 'item', style: { borderTop: '1px solid var(--line)' } },
      h('div', { class: 'ico', style: { background: 'color-mix(in srgb, ' + (p.color || '#b3a58c') + ' 22%, var(--card))' } }, p.icon || '•'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, p.name, p.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用'))),
      h('button', { class: 'icon-btn', 'aria-label': `編輯 ${p.name}`, onclick: () => openCategoryForm({ category: p }) }, icon('edit')),
      h('button', { class: 'icon-btn', 'aria-label': `在 ${p.name} 底下新增子分類`, onclick: () => openCategoryForm({ parentId: p.id, type: catType }) }, icon('plus'))));
    const kids = d.categories.filter((c) => c.parentId === p.id);
    if (kids.length) card.appendChild(h('div', { class: 'chips', style: { padding: '0 0 10px 50px' } }, kids.map((k) =>
      h('button', { class: 'chip' + (k.active ? '' : ' voided'), onclick: () => openCategoryForm({ category: k }) }, k.name))));
  }
  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '帳戶'), h('button', { class: 'btn btn-sm btn-primary', onclick: () => openCategoryForm({ type: catType }) }, icon('plus'), '新增分類')),
    subtabs('categories'),
    h('div', { class: 'seg', style: { marginBottom: '12px' } }, ['支出', '收入'].map((t) => h('button', { class: catType === t ? 'on' : '', onclick: () => { catType = t; renderCategories(root, { subtabs }); } }, t))),
    card);
}

export function openCategoryForm({ category = null, parentId = '', type = '支出' } = {}) {
  const d = state.data;
  const editing = !!category;
  const f = category ? { name: category.name, icon: category.icon, color: category.color || '#b3a58c', parentId: category.parentId } : { name: '', icon: '', color: '#b3a58c', parentId };
  const catT = category ? category.type : type;
  const hasKids = editing && d.categories.some((c) => c.parentId === category.id);
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const parentOptions = d.categories.filter((c) => !c.parentId && c.type === catT && (!category || c.id !== category.id));

  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
    banner.style.display = 'none';
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertCategory', { category: { id: category ? category.id : undefined, type: catT, ...f, name: f.name.trim() }, expectedUpdatedAt: category ? category.updatedAt : undefined });
        sheet.close(); await refresh(); toast(editing ? '已儲存' : '已新增分類');
      } catch (err) { banner.style.display = ''; mount(banner, errorText(err)); }
    });
  } }, editing ? '儲存' : '新增');

  const toggle = editing ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async (e) => {
    await withBusy(e.currentTarget, async () => {
      try { await api.call('setCategoryActive', { id: category.id, active: !category.active }); sheet.close(); await refresh(); toast(category.active ? '已停用（過去的交易不受影響）' : '已啟用'); }
      catch (err) { banner.style.display = ''; mount(banner, errorText(err)); }
    });
  } }, category.active ? '停用' : '重新啟用') : null;

  const sheet = openSheet({
    title: editing ? '編輯分類' : (parentId ? '新增子分類' : '新增分類'), dismissable: false,
    body: h('div', null, banner,
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, `名稱（${catT}）`), h('input', { type: 'text', maxlength: 30, value: f.name, oninput: (e) => { f.name = e.target.value; } })),
      h('div', { class: 'two', style: { gridTemplateColumns: '1fr 1fr' } },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, '圖示（1 個 emoji，選填）'), h('input', { type: 'text', maxlength: 8, value: f.icon, oninput: (e) => { f.icon = e.target.value; } })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, '顏色'), h('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : '#b3a58c', style: { padding: '2px', height: '42px' }, onchange: (e) => { f.color = e.target.value; } }))),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, '上層分類'),
        h('select', { disabled: hasKids, onchange: (e) => { f.parentId = e.target.value; } }, h('option', { value: '' }, '（無，這是一級分類）'),
          parentOptions.map((p) => h('option', { value: p.id, selected: p.id === f.parentId }, `${p.icon} ${p.name}`))),
        hasKids ? h('div', { class: 'muted small' }, '這個分類底下有子分類，不能再放到別的分類底下。') : null)),
    footer: [toggle, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save].filter(Boolean),
  });
  return sheet;
}
