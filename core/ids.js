/** ID 產生：前綴 + 補零流水號（T000001、A001）。以「目前最大號 + 1」計算，手動改過 Sheet 也不會撞號。 */
var FinIds = (function () {
  function parseSeq(id, prefix) {
    var s = String(id === null || id === undefined ? '' : id);
    if (s.indexOf(prefix) !== 0) return 0;
    var rest = s.slice(prefix.length);
    return /^\d+$/.test(rest) ? parseInt(rest, 10) : 0;
  }
  function pad(n, width) { var s = String(n); while (s.length < width) s = '0' + s; return s; }

  /** 回傳 count 個新 ID */
  function next(existingIds, prefix, width, count) {
    var max = 0;
    for (var i = 0; i < existingIds.length; i++) {
      var n = parseSeq(existingIds[i], prefix);
      if (n > max) max = n;
    }
    var out = [];
    for (var k = 1; k <= (count || 1); k++) out.push(prefix + pad(max + k, width));
    return out;
  }
  return { next: next, parseSeq: parseSeq };
})();
//#ifnode
module.exports = FinIds;
//#endif
