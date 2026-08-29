/* BB星打卡系统 - 前后端共享逻辑（计分规则、日期、工具函数） */
(function (global) {
  "use strict";

  // 六个打卡项定义
  var ITEMS = {
    yuwen:  { name: "语文作业",     type: "required", emoji: "📖", color: "#FFE3EC" },
    shuxue: { name: "数学作业",     type: "required", emoji: "🔢", color: "#E3F2FF" },
    yingyu: { name: "英语作业",     type: "required", emoji: "🔤", color: "#E8F8E0" },
    danci:  { name: "英语单词打卡", type: "required", emoji: "💬", color: "#FFF3D6" },
    yuedu:  { name: "阅读打卡",     type: "optional", emoji: "📚", color: "#F3E8FF" },
    tiyu:   { name: "体育打卡",     type: "optional", emoji: "⚽", color: "#DFF6F0" }
  };
  var REQUIRED = ["yuwen", "shuxue", "yingyu", "danci"];
  var OPTIONAL = ["yuedu", "tiyu"];

  // 东八区自然日键 YYYY-MM-DD
  function dateKey(d) {
    d = d || new Date();
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  }
  function prevDateKey(key) {
    var d = new Date(key + "T12:00:00+08:00");
    return dateKey(new Date(d.getTime() - 86400000));
  }
  function todayIs(key) { return key === dateKey(); }

  // 计分：必做每项2分；选做完成且非跳过各+1；总分上限10
  function computeScore(record) {
    var items = (record && record.items) || {};
    var base = 0;
    REQUIRED.forEach(function (k) { if (items[k] && items[k].done) base += 2; });
    var opt = 0;
    OPTIONAL.forEach(function (k) {
      var it = items[k];
      if (it && it.done && !it.skipped) opt += 1;
    });
    var score = Math.min(base + opt, 10);
    return { score: score, base: base, optional: opt, full: score === 10 };
  }

  // 纵向成长统计：累计星星、连续打卡天数（仅个人，不做排行）
  function computeStats(records) {
    var totalStars = 0, days = 0, todayScore = 0;
    var tk = dateKey();
    Object.keys(records || {}).forEach(function (rk) {
      if (rk.indexOf("|") < 0) return;
      var r = records[rk];
      var s = computeScore(r).score;
      totalStars += s;
      if (s > 0) days++;
      if (rk.split("|")[1] === tk) todayScore = s;
    });
    // 连续天数：从今天往回数
    var streak = 0, cur = tk;
    while (true) {
      var key = null;
      for (var k in records) { if (k.split("|")[1] === cur) { key = k; break; } }
      if (key && computeScore(records[key]).score > 0) { streak++; cur = prevDateKey(cur); }
      else break;
    }
    return { totalStars: totalStars, activeDays: days, streak: streak, todayScore: todayScore };
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function simpleHash(str) {
    var h = 5381, i = (str || "").length;
    while (i) { h = (h * 33) ^ str.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }
  function hashPattern(pattern) { return simpleHash("bbstar-pattern::" + pattern.join("-")); }

  var api = {
    ITEMS: ITEMS, REQUIRED: REQUIRED, OPTIONAL: OPTIONAL,
    dateKey: dateKey, prevDateKey: prevDateKey, todayIs: todayIs,
    computeScore: computeScore, computeStats: computeStats,
    uid: uid, simpleHash: simpleHash, hashPattern: hashPattern
  };
  global.BBShared = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
