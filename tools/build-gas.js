'use strict';
/**
 * 把 core/ 與 server/ 的檔案合併成單一 dist/Code.gs，直接貼進 Apps Script 即可。
 * - 移除 //#ifnode ... //#endif 之間的段落（那些是 Node 測試用的 require / module.exports）
 * - 依固定順序串接，順序即相依順序
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORDER = [
  'core/schema.js', 'core/money.js', 'core/dates.js', 'core/recurring.js', 'core/ids.js', 'core/us-holidays.js', 'core/valuation.js',
  'core/ledger.js', 'core/holdings.js', 'core/loan.js', 'core/creditcard.js', 'core/validate.js', 'core/report.js', 'core/seed.js',
  'server/repo.js', 'server/auth.js', 'server/mail.js', 'server/api.js', 'server/recurring.js', 'server/setup.js', 'server/main.js',
];

function strip(src) {
  return src.replace(/^[ \t]*\/\/#ifnode[\s\S]*?^[ \t]*\/\/#endif[ \t]*\r?\n?/gm, '');
}

function build() {
  const parts = [
    '/**\n * 財務管理系統 — Apps Script 後端（自動產生，請勿直接編輯）\n * 由 tools/build-gas.js 從 core/ 與 server/ 合併而成。\n */\n',
  ];
  for (const rel of ORDER) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    parts.push(`\n// ==================== ${rel} ====================\n`);
    parts.push(strip(src));
  }
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const out = parts.join('');
  fs.writeFileSync(path.join(ROOT, 'dist/Code.gs'), out);
  fs.copyFileSync(path.join(ROOT, 'server/appsscript.json'), path.join(ROOT, 'dist/appsscript.json'));
  return out;
}

if (require.main === module) {
  const out = build();
  console.log(`dist/Code.gs 已產生（${out.length} 字元）`);
}
module.exports = { build, strip, ORDER };
