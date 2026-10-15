'use strict';
/**
 * 一鍵部署 Apps Script 後端（網址不變）：
 *   0. 先跑全部測試（node --test），沒過就停止、不部署；緊急時可加 --skip-tests 跳過
 *   1. core/ + server/ → dist/Code.gs、docs/js/core（npm run build）
 *   2. 複製成 gas/程式碼.js、gas/appsscript.json（gas/ 是 Apps Script 專案的本機鏡像，由 .clasp.json 指定；不進版控）
 *   3. clasp push：上傳 gas/ 全部檔案（會整個覆蓋線上專案，所以 gas/ 一定要是完整的兩個檔案）
 *   4. clasp deploy -i：建立新版本並更新「同一個」網頁應用程式部署（網址不變）
 * 用法：npm run deploy:gas -- "這次改了什麼"
 * 需要專案根目錄的 .clasprc.json（Google 授權，已列入 .gitignore，不會上傳；跟個人工作台共用同一份即可）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOYMENT_ID = 'AKfycbxHyXv54WEMCuolEMZ-cPWWpMaOugFGduC9RnhjBnFbpzbEyRnqk-PQnfuSuMvSc8_k';
const CLASP = process.env.CLASP || 'npx -y @google/clasp@3';
const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const desc = args.filter((a) => a !== '--skip-tests').join(' ') || `deploy ${new Date().toISOString()}`;

if (!fs.existsSync(path.join(ROOT, '.clasprc.json'))) {
  console.error('找不到 .clasprc.json（Google 授權檔）：請從個人工作台資料夾複製一份過來，或先執行 clasp 登入。');
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
run('node tools/build-gas.js && node tools/build-web.js');
if (skipTests) {
  console.warn('⚠ 已跳過測試（--skip-tests）');
} else {
  console.log('執行測試中…');
  try {
    run('node --test "tests/**/*.test.js"');
  } catch (err) {
    console.error('\n✖ 測試沒有通過，已停止部署（線上版本沒有任何變動）。');
    process.exit(1);
  }
  console.log('✔ 測試全部通過，開始部署');
}
fs.mkdirSync(path.join(ROOT, 'gas'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist/Code.gs'), path.join(ROOT, 'gas/程式碼.js'));
fs.copyFileSync(path.join(ROOT, 'server/appsscript.json'), path.join(ROOT, 'gas/appsscript.json'));
run(`${CLASP} -A .clasprc.json push --force`);
run(`${CLASP} -A .clasprc.json deploy -i ${DEPLOYMENT_ID} -d ${JSON.stringify(desc)}`);
const version = require('../core/schema.js').APP_VERSION;
console.log(`後端 ${version} 部署完成，網址不變。`);
