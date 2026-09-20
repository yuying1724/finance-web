'use strict';
/** 把前端需要的核心模組（金額、日期）複製到 docs/js/core/，去掉 Node 專用區塊。前端與後端因此共用同一份計算邏輯。 */
const fs = require('fs');
const path = require('path');
const { strip } = require('./build-gas.js');

const ROOT = path.join(__dirname, '..');
const SHARED = ['money.js', 'dates.js'];

function build() {
  const outDir = path.join(ROOT, 'docs/js/core');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of SHARED) {
    const src = fs.readFileSync(path.join(ROOT, 'core', f), 'utf8');
    fs.writeFileSync(path.join(outDir, f), '/* 自動產生自 core/' + f + '，請勿直接編輯 */\n' + strip(src));
  }
}
if (require.main === module) { build(); console.log('docs/js/core 已更新'); }
module.exports = { build };
