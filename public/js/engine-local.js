/* BB星 - 本地演示模式引擎（纯静态部署时自动启用，数据存于浏览器 localStorage）
 * 与后端 server.js 的 REST API 保持同构：window.LocalEngine.handle(method, path, data) → {status, body}
 */
(function (global) {
"use strict";
var BB = global.BBShared;
var LS_KEY = "bbstar_local_db_v1";

function defaultDB() {
  return {
    settings: { aiMarkVisibility: "both", autoCleanDays: 90, notifyEnabled: true, maxImagesPerItem: 5, hintFirstDot: false },
    parents: [], children: [], sessions: {}, records: {}, logs: []
  };
}
function load() {
  try { var d = JSON.parse(localStorage.getItem(LS_KEY)); if (d) return d; } catch (e) {}
  return defaultDB();
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
  catch (e) { // 存储满：截断日志与最旧记录的图片
    DB.logs = DB.logs.slice(-200);
    var keys = Object.keys(DB.records).sort();
    for (var i = 0; i < keys.length && e; i++) {
      var rec = DB.records[keys[i]];
      Object.keys(rec.items || {}).forEach(function (k) { if (rec.items[k].images) rec.items[k].images = []; });
      try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); e = null; } catch (e2) {}
    }
    if (e) console.warn("本地存储已满");
  }
}
var DB = load();

function ok(body) { return { status: 200, body: body || { ok: true } }; }
function err(status, msg) { return { status: status, body: { error: msg } }; }
function tokenFor(role, id) {
  var t = "lt_" + role + "_" + id;
  DB.sessions[t] = { role: role, id: id, exp: Date.now() + 30 * 86400000 };
  return t;
}
function session(token) { return DB.sessions[token] && DB.sessions[token].exp > Date.now() ? DB.sessions[token] : null; }
function child(id) { return DB.children.find(function (c) { return c.id === id; }); }
function parent(id) { return DB.parents.find(function (p) { return p.id === id; }); }
function recOf(childId, key, create) {
  var rk = childId + "|" + key;
  if (!DB.records[rk] && create) DB.records[rk] = { childId: childId, date: key, items: {}, comment: null, createdAt: Date.now() };
  return DB.records[rk];
}
function addLog(actor, childId, action, item, detail) {
  DB.logs.push({ id: BB.uid("log"), actor: actor, childId: childId, action: action, item: item || "", detail: detail || "", at: new Date().toISOString() });
  save();
}
function sanitizeChild(c) { return { id: c.id, name: c.name, avatar: c.avatar || "🐣", createdAt: c.createdAt }; }
function recordView(record, includeImages) {
  if (!record) return null;
  var out = { date: record.date, items: {}, comment: record.comment || null, score: BB.computeScore(record).score, scoreDetail: BB.computeScore(record) };
  Object.keys(record.items).forEach(function (k) {
    var it = record.items[k];
    var imgs = (includeImages && it.images) ? it.images.map(function (im) {
      var ai = im.ai;
      if (DB.settings.aiMarkVisibility === "parent" && CURRENT_ROLE === "child") ai = { status: ai ? ai.status : "pending", hidden: true };
      return { id: im.id, name: im.name, at: im.at, ai: ai, dataUrl: im.dataUrl };
    }) : { count: it.images ? it.images.length : 0 };
    out.items[k] = { done: !!it.done, skipped: !!it.skipped, updatedAt: it.updatedAt || null, images: imgs };
  });
  return out;
}
function childRecords(childId) {
  var m = {};
  Object.keys(DB.records).forEach(function (k) { if (k.split("|")[0] === childId) m[k] = DB.records[k]; });
  return m;
}
function simulateAI(img) {
  var seed = BB.simpleHash(img.id + img.name);
  var n = parseInt(seed.slice(-1), 36) % 9, marks = [];
  for (var i = 0; i < n; i++) {
    var r = parseInt((seed.slice(i % seed.length, i % seed.length + 2) || "0"), 36), v = r % 10;
    if (v < 7) marks.push({ x: 8 + (i % 3) * 40 + (r % 10), y: 12 + Math.floor(i / 3) * 26 + (r % 7), label: "correct" });
    else if (v < 9) marks.push({ x: 8 + (i % 3) * 40 + (r % 10), y: 12 + Math.floor(i / 3) * 26 + (r % 7), label: "wrong" });
  }
  return { status: "done", engine: "sim", marks: marks, at: new Date().toISOString(), note: "演示模式·模拟识别" };
}

var CURRENT_ROLE = null;

function handle(method, path, data, token) {
  data = data || {};
  var sess = token ? session(token) : null;
  CURRENT_ROLE = sess ? sess.role : null;
  var seg = path.split("/").filter(Boolean); // ["api", ...]
  var p = "/" + seg.slice(1).join("/"); // 去掉 api 前缀
  var qi = p.indexOf("?");
  var qs = qi >= 0 ? p.slice(qi + 1) : "";
  if (qi >= 0) p = p.slice(0, qi);
  var qDate = "";
  qs.split("&").forEach(function (kv) {
    if (kv.indexOf("date=") === 0) qDate = decodeURIComponent(kv.slice(5));
  });

  if (p === "/ping") return ok({ ok: true, mode: "local", time: new Date().toISOString() });

  /* ---- 家长 ---- */
  if (p === "/register" && method === "POST") {
    var u = String(data.username || "").trim();
    if (!u || u.length < 2) return err(400, "用户名至少2个字符");
    if (!data.password || String(data.password).length < 4) return err(400, "密码至少4位");
    if (DB.parents.some(function (x) { return x.username === u; })) return err(400, "该用户名已被注册");
    var par = { id: BB.uid("p"), username: u, passHash: BB.simpleHash("pw::" + data.password), familyCode: String(Math.floor(1000 + Math.random() * 9000)), children: [], createdAt: new Date().toISOString() };
    DB.parents.push(par); save();
    return ok({ token: tokenFor("parent", par.id), parent: { id: par.id, username: par.username, familyCode: par.familyCode } });
  }
  if (p === "/login" && method === "POST") {
    var pr = DB.parents.find(function (x) { return x.username === String(data.username || "").trim(); });
    if (!pr || pr.passHash !== BB.simpleHash("pw::" + data.password)) return err(400, "用户名或密码错误");
    return ok({ token: tokenFor("parent", pr.id), parent: { id: pr.id, username: pr.username, familyCode: pr.familyCode } });
  }
  if (p.indexOf("/family/") === 0) {
    var code = decodeURIComponent(p.slice("/family/".length));
    var fp = DB.parents.find(function (x) { return x.familyCode === code; });
    if (!fp) return err(400, "家庭码不正确");
    return ok({ children: DB.children.filter(function (c) { return c.parentId === fp.id; }).map(function (c) {
      var s = sanitizeChild(c);
      s.hasPattern = !!c.patternHash;
      s.hint = DB.settings.hintFirstDot ? (c.patternHint != null ? c.patternHint : null) : null;
      return s;
    }) });
  }
  if (p === "/child-login" && method === "POST") {
    var fp2 = DB.parents.find(function (x) { return x.familyCode === String(data.familyCode || "").trim(); });
    if (!fp2) return err(400, "家庭码不正确");
    var ch = child(data.childId);
    if (!ch || ch.parentId !== fp2.id) return err(400, "孩子不存在");
    if (BB.hashPattern(data.pattern || []) !== ch.patternHash) return err(400, "手势密码不正确");
    return ok({ token: tokenFor("child", ch.id), child: sanitizeChild(ch) });
  }

  var role = sess ? sess.role : null;
  if (!sess && p !== "/ping") return err(401, "请先登录");

  if (p.indexOf("/parent/") === 0) {
    if (role !== "parent") return err(403, "需要家长权限");
    var me = parent(sess.id);
    if (p === "/parent/children" && method === "GET") return ok({ children: DB.children.filter(function (c) { return c.parentId === me.id; }).map(sanitizeChild) });
    if (p === "/parent/children" && method === "POST") {
      var mine = DB.children.filter(function (c) { return c.parentId === me.id; });
      if (mine.length >= 5) return err(400, "单个家长最多创建5个孩子账号");
      var nm = String(data.name || "").trim();
      if (!nm) return err(400, "请填写孩子昵称");
      if (mine.some(function (c) { return c.name === nm; })) return err(400, "已有同名孩子账号");
      var nc = { id: BB.uid("c"), parentId: me.id, name: nm, avatar: data.avatar || "🐣", patternHash: null, createdAt: new Date().toISOString() };
      DB.children.push(nc); save();
      return ok({ child: sanitizeChild(nc) });
    }
    var mChild, m1 = p.match(/^\/parent\/children\/([^/]+)\/reset-pattern$/);
    if (m1 && method === "POST") {
      mChild = child(m1[1]); if (!mChild || mChild.parentId !== me.id) return err(403, "无权限");
      if (!Array.isArray(data.pattern) || data.pattern.length < 4) return err(400, "请至少连接4个点");
      mChild.patternHash = BB.hashPattern(data.pattern);
      mChild.patternHint = data.pattern[0]; save();
      addLog("parent", mChild.id, "reset-pattern", "", "家长重置了九宫格密码");
      return ok();
    }
    var m2 = p.match(/^\/parent\/children\/([^/]+)$/);
    if (m2 && method === "DELETE") {
      mChild = child(m2[1]); if (!mChild || mChild.parentId !== me.id) return err(403, "无权限");
      DB.children = DB.children.filter(function (c) { return c.id !== mChild.id; });
      Object.keys(DB.records).forEach(function (rk) { if (rk.split("|")[0] === mChild.id) delete DB.records[rk]; });
      save(); return ok();
    }
    var m3 = p.match(/^\/parent\/child\/([^/]+)(\/.*)?$/);
    if (m3) {
      var ch2 = child(m3[1]); if (!ch2 || ch2.parentId !== me.id) return err(403, "无权限");
      var rest = m3[2] || "";
      var key = data.date || BB.dateKey();
      if (rest === "" && method === "GET") {
        return ok({ child: sanitizeChild(ch2), date: key, record: recordView(recOf(ch2.id, key, false), true), stats: BB.computeStats(childRecords(ch2.id)), days: Object.keys(childRecords(ch2.id)).map(function (k) { return k.split("|")[1]; }).sort() });
      }
      if (rest === "/comment" && method === "POST") {
        var rec = recOf(ch2.id, key, true);
        if (!data.text || !String(data.text).trim()) return err(400, "评语不能为空");
        var now = Date.now(), prev = rec.comment, notify = false;
        if (DB.settings.notifyEnabled && (!prev || !prev.notifyAt || now - prev.notifyAt > 60000)) notify = true;
        rec.comment = { text: String(data.text).trim(), at: new Date().toISOString(), by: "parent", notifyAt: notify ? now : (prev ? prev.notifyAt : 0) };
        save(); return ok({ ok: true, notified: notify });
      }
      if (rest === "/reset-item" && method === "POST") {
        if (!BB.ITEMS[data.item]) return err(400, "无效打卡项");
        var rec2 = recOf(ch2.id, key, true), it = rec2.items[data.item];
        if (!it || !it.done) return err(400, "该项目未完成，无需重置");
        rec2.items[data.item] = { done: false, skipped: false, images: [], updatedAt: new Date().toISOString() };
        if (data.keepComment === false && rec2.comment) rec2.comment = null;
        addLog("parent", ch2.id, "reset-item", data.item, "家长重置「" + BB.ITEMS[data.item].name + "」" + (data.keepComment === false ? "，评语已清空" : "，评语保留"));
        save(); return ok({ ok: true, record: recordView(rec2, true) });
      }
      if (rest === "/logs" && method === "GET") {
        return ok({ logs: DB.logs.filter(function (l) { return l.childId === ch2.id; }).sort(function (a, b) { return b.at.localeCompare(a.at); }).slice(0, 500) });
      }
    }
    if (p === "/parent/settings" && method === "GET") {
      var s = Object.assign({}, DB.settings); s.aiApiKey = "";
      return ok({ settings: s });
    }
    if (p === "/parent/settings" && method === "POST") {
      ["aiMarkVisibility", "notifyEnabled", "hintFirstDot", "maxImagesPerItem", "autoCleanDays"].forEach(function (k) {
        if (k in data) DB.settings[k] = data[k];
      });
      if (data.maxImagesPerItem != null) DB.settings.maxImagesPerItem = Math.min(9, Math.max(1, data.maxImagesPerItem | 0));
      if (data.autoCleanDays != null) DB.settings.autoCleanDays = Math.max(0, data.autoCleanDays | 0);
      save(); return ok();
    }
  }

  if (p.indexOf("/child/") === 0) {
    if (role !== "child") return err(403, "需要孩子权限");
    var me2 = child(sess.id);
    var tk = BB.dateKey();
    if (p === "/child/home" && method === "GET") {
      var yk = BB.prevDateKey(tk);
      var yrec = recOf(me2.id, yk, false);
      var trec = recordView(recOf(me2.id, tk, false), true);
      return ok({
        child: sanitizeChild(me2), today: tk, todayRecord: trec,
        yesterday: { date: yk, score: yrec ? BB.computeScore(yrec).score : 0, comment: yrec ? (yrec.comment || null) : null },
        todayComment: trec ? (trec.comment || null) : null,
        stats: BB.computeStats(childRecords(me2.id)),
        settings: { aiMarkVisibility: DB.settings.aiMarkVisibility, hintFirstDot: !!DB.settings.hintFirstDot, maxImagesPerItem: DB.settings.maxImagesPerItem }
      });
    }
    if (p === "/child/history" && method === "GET") {
      var qd = qDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(qd)) return err(400, "日期无效");
      return ok({ date: qd, record: recordView(recOf(me2.id, qd, false), true), days: Object.keys(childRecords(me2.id)).map(function (k) { return k.split("|")[1]; }).sort().reverse() });
    }
    if (p === "/child/checkin" && method === "POST") {
      if (!BB.ITEMS[data.item]) return err(400, "无效打卡项");
      var rec3 = recOf(me2.id, tk, true);
      var it3 = rec3.items[data.item] || (rec3.items[data.item] = {});
      var max = DB.settings.maxImagesPerItem || 5;
      var imgs = Array.isArray(data.images) ? data.images : [];
      if (imgs.length > max) return err(400, "单次最多上传" + max + "张图片");
      var isRe = !!it3.done;
      var saved = imgs.map(function (im) {
        var m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(im.dataUrl || "");
        if (!m) return null;
        return { id: BB.uid("img"), name: im.name || "作业.jpg", dataUrl: im.dataUrl, at: new Date().toISOString(), ai: { status: "pending" } };
      }).filter(Boolean);
      if (!saved.length) return err(400, "图片数据无效");
      it3.images = saved; it3.done = true; it3.skipped = false; it3.updatedAt = new Date().toISOString();
      addLog("child", me2.id, isRe ? "reupload" : "upload", data.item,
        (isRe ? "重新上传" : "上传") + "「" + BB.ITEMS[data.item].name + "」" + saved.length + "张图片" + (data.quality && data.quality.warned ? "（画质提示后仍继续）" : ""));
      save();
      // 异步模拟 AI
      setTimeout(function () {
        saved.forEach(function (img) { img.ai = simulateAI(img); });
        save();
      }, 1500 + Math.random() * 1500);
      return ok({ ok: true, record: recordView(rec3, true) });
    }
    if (p === "/child/skip" && method === "POST") {
      if (!BB.ITEMS[data.item] || BB.ITEMS[data.item].type !== "optional") return err(400, "仅选做项目可跳过");
      if (!data.confirm) return err(400, "需二次确认");
      var rec4 = recOf(me2.id, tk, true);
      var it4 = rec4.items[data.item] || (rec4.items[data.item] = {});
      it4.done = true; it4.skipped = true; it4.images = []; it4.updatedAt = new Date().toISOString();
      addLog("child", me2.id, "skip", data.item, "选择「今日无打卡内容」跳过「" + BB.ITEMS[data.item].name + "」（不计入选做加分）");
      save(); return ok({ ok: true, record: recordView(rec4, true) });
    }
    var mi = p.match(/^\/child\/item\/([^/?]+)/);
    if (mi && method === "GET") {
      var it5 = recOf(me2.id, tk, false);
      it5 = it5 && it5.items[mi[1]];
      var out = { done: !!(it5 && it5.done), ai: {} };
      if (it5 && it5.images) it5.images.forEach(function (img) {
        var ai = img.ai;
        if (DB.settings.aiMarkVisibility === "parent") ai = { status: ai ? ai.status : "pending", hidden: true };
        out.ai[img.id] = ai;
      });
      return ok(out);
    }
  }
  return err(404, "接口不存在");
}

global.LocalEngine = {
  handle: function (method, path, data, token) {
    try { return handle(method, path, data, token); }
    catch (e) { return { status: 500, body: { error: "本地引擎错误：" + e.message } }; }
  },
  raw: function () { return DB; }
};
})(typeof window !== "undefined" ? window : globalThis);
