/* BB星每日作业打卡系统 - 后端服务（零依赖，Node >= 18）
 * 启动: node server.js   (环境变量 PORT 可改端口)
 * 数据: data/db.json + uploads/ 图片文件
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const BB = require("./public/js/shared.js");

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UP_DIR = process.env.UPLOADS_DIR || path.join(ROOT, "uploads");
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PORT = process.env.PORT || 3000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UP_DIR, { recursive: true });

/* ---------------- JSON 数据库（原子写 + 防抖落盘） ---------------- */
let DB = null;
let saveTimer = null;
function defaultDB() {
  return {
    settings: {
      aiMarkVisibility: "both",        // both | parent  （AI对错标记可见范围）
      autoCleanDays: 90,               // 图片自动清理天数（0=不清理）
      notifyEnabled: true,             // 评语推送开关
      maxImagesPerItem: 5,             // 单科目最大图片数
      hintFirstDot: false,             // 孩子端九宫格显示首点提示
      aiApiUrl: process.env.AI_API_URL || "",
      aiApiKey: process.env.AI_API_KEY || "",
      aiModel: process.env.AI_MODEL || ""
    },
    parents: [], children: [], sessions: {}, records: {}, logs: []
  };
}
function loadDB() {
  try { DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (e) { DB = defaultDB(); }
  // 补齐缺省字段
  const def = defaultDB();
  DB.settings = Object.assign({}, def.settings, DB.settings || {});
  ["parents", "children", "logs"].forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
  if (!DB.sessions) DB.sessions = {};
  if (!DB.records) DB.records = {};
}
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(DB, null, 1));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error("DB保存失败", e.message); }
  }, 200);
}
loadDB();

/* ---------------- 工具 ---------------- */
function body(req) {
  return new Promise((res, rej) => {
    let chunks = [], size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { rej(new Error("body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { rej(e); }
    });
    req.on("error", rej);
  });
}
function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}
function getRecord(childId, key) {
  const rk = childId + "|" + key;
  if (!DB.records[rk]) {
    DB.records[rk] = {
      childId: childId, date: key, items: {}, comment: null, createdAt: Date.now()
    };
  }
  if (!DB.records[rk].items) DB.records[rk].items = {};
  return DB.records[rk];
}
function addLog(actor, childId, action, item, detail) {
  DB.logs.push({
    id: BB.uid("log"), actor, childId, action, item: item || "",
    detail: detail || "", at: new Date().toISOString()
  });
  if (DB.logs.length > 5000) DB.logs = DB.logs.slice(-4000);
  saveDB();
}
function findChild(id) { return DB.children.find(c => c.id === id); }
function sanitizeChild(c) { return { id: c.id, name: c.name, avatar: c.avatar || "🐣", createdAt: c.createdAt, familyCode: c.familyCode }; }
function recordView(record, includeImages) {
  if (!record) return null;
  const out = {
    date: record.date, items: {}, comment: record.comment || null,
    score: BB.computeScore(record).score, scoreDetail: BB.computeScore(record)
  };
  Object.keys(record.items).forEach(k => {
    const it = record.items[k];
    out.items[k] = {
      done: !!it.done, skipped: !!it.skipped, updatedAt: it.updatedAt || null,
      images: (includeImages && it.images) ? it.images.map(img => ({
        id: img.id, name: img.name, w: img.w, h: img.h, at: img.at, ai: img.ai
      })) : (it.images ? { count: it.images.length } : { count: 0 })
    };
  });
  return out;
}

/* ---------------- AI 判题 ----------------
 * 优先使用 settings.aiApiUrl（OpenAI 兼容视觉接口）；未配置则使用内置模拟引擎（演示模式）。
 * AI 结果仅辅助参考，不参与计分。 */
function simulateAI(img) {
  // 演示模式：依据图片特征确定性生成“题目级”标记（√ / × / 不标记）
  const seed = BB.simpleHash(img.id + img.name);
  const n = parseInt(seed.slice(-1), 36) % 9; // 0..8 个可判定题目
  const marks = [];
  for (let i = 0; i < n; i++) {
    const r = parseInt(seed.slice(i % seed.length, i % seed.length + 2) || "0", 36);
    const v = r % 10;
    const label = v < 7 ? "correct" : (v < 9 ? "wrong" : "unresolved"); // ~70%√ ~20%× ~10%不判
    if (label === "unresolved") continue;
    marks.push({
      x: 8 + (i % 3) * 40 + (r % 10),
      y: 12 + Math.floor(i / 3) * 26 + (r % 7),
      label
    });
  }
  return { status: "done", engine: "sim", marks, at: new Date().toISOString(), note: "演示模式·模拟识别" };
}
async function callRealAI(img) {
  const cfg = DB.settings;
  const dataUrl = "data:" + (img.mime || "image/jpeg") + ";base64," + fs.readFileSync(path.join(UP_DIR, childDir(img.childId), img.id + ".bin")).toString("base64");
  const resp = await fetch(cfg.aiApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.aiApiKey },
    body: JSON.stringify({
      model: cfg.aiModel || "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "你是小学作业批改助手。请识别图中每道题的作答，返回JSON：{\"marks\":[{\"x\":数字0-100,\"y\":数字0-100,\"label\":\"correct|wrong\"}]}，x/y为题目在图片中的大致百分比位置。仅对有标准答案的客观题标记；作文、阅读理解等主观题或无法辨认的题不做标记。只输出JSON。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }]
    })
  });
  if (!resp.ok) throw new Error("AI接口 HTTP " + resp.status);
  const data = await resp.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : {};
  const marks = (parsed.marks || []).filter(x => x && (x.label === "correct" || x.label === "wrong"))
    .map(x => ({
      x: Math.max(0, Math.min(100, Number(x.x) || 0)),
      y: Math.max(0, Math.min(100, Number(x.y) || 0)),
      label: x.label
    }));
  return { status: "done", engine: "api", marks, at: new Date().toISOString(), note: "AI识别" };
}

/* ---------------- 图片生命周期清理 ---------------- */
function childDir(childId) { return path.join(UP_DIR, childId); }
function cleanupImages() {
  const days = DB.settings.autoCleanDays | 0;
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  Object.keys(DB.records).forEach(rk => {
    const rec = DB.records[rk];
    // 只清理“非最近”日期的图片，保留打卡状态与得分记录
    Object.keys(rec.items || {}).forEach(k => {
      const it = rec.items[k];
      if (it.images && it.images.length) {
        const keep = it.images.filter(img => {
          if (new Date(img.at).getTime() >= cutoff) return true;
          try { fs.unlinkSync(path.join(childDir(rec.childId), img.id + ".bin")); } catch (e) {}
          removed++;
          return false;
        });
        it.images = keep;
        it.imagesCleaned = true;
      }
    });
  });
  if (removed) { addLog("system", "-", "cleanup", "", "按生命周期策略清理 " + removed + " 张过期图片（打卡记录与得分保留）"); }
  saveDB();
}
setInterval(cleanupImages, 6 * 3600 * 1000);
setTimeout(cleanupImages, 30 * 1000);

/* ---------------- 会话 ---------------- */
function mkSession(role, id) {
  const token = BB.uid("tk") + BB.simpleHash(String(Math.random()));
  DB.sessions[token] = { role, id, at: Date.now(), exp: Date.now() + 30 * 86400000 };
  // 清理过期
  Object.keys(DB.sessions).forEach(t => { if (DB.sessions[t].exp < Date.now()) delete DB.sessions[t]; });
  saveDB();
  return token;
}
function auth(req) {
  const h = req.headers["authorization"] || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  return token && DB.sessions[token] ? { session: DB.sessions[token], token } : null;
}

/* ---------------- API 路由 ---------------- */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, parts: pattern.split("/").filter(Boolean), handler }); }

// ---- 公共 ----
route("GET", "/api/ping", (ctx) => json(ctx.res, 200, { ok: true, mode: "server", time: new Date().toISOString() }));

// ---- 家长注册/登录 ----
route("POST", "/api/register", async (ctx) => {
  const { username, password } = ctx.data;
  if (!username || String(username).trim().length < 2) return json(ctx.res, 400, { error: "用户名至少2个字符" });
  if (!password || String(password).length < 4) return json(ctx.res, 400, { error: "密码至少4位" });
  if (DB.parents.some(p => p.username === username.trim())) return json(ctx.res, 400, { error: "该用户名已被注册" });
  const familyCode = String(Math.floor(100000 + Math.random() * 900000));
  const parent = { id: BB.uid("p"), username: username.trim(), passHash: BB.simpleHash("pw::" + password), familyCode, children: [], createdAt: new Date().toISOString() };
  DB.parents.push(parent); saveDB();
  json(ctx.res, 200, { token: mkSession("parent", parent.id), parent: { id: parent.id, username: parent.username, familyCode } });
});
route("POST", "/api/login", async (ctx) => {
  const { username, password } = ctx.data;
  const parent = DB.parents.find(p => p.username === String(username || "").trim());
  if (!parent || parent.passHash !== BB.simpleHash("pw::" + password)) return json(ctx.res, 400, { error: "用户名或密码错误" });
  json(ctx.res, 200, { token: mkSession("parent", parent.id), parent: { id: parent.id, username: parent.username, familyCode: parent.familyCode } });
});

// ---- 孩子登录（家庭码 + 九宫格） ----
route("POST", "/api/child-login", async (ctx) => {
  const { familyCode, childId, pattern } = ctx.data;
  const parent = DB.parents.find(p => p.familyCode === String(familyCode || "").trim());
  if (!parent) return json(ctx.res, 400, { error: "家庭码不正确" });
  const child = findChild(childId);
  if (!child || child.parentId !== parent.id) return json(ctx.res, 400, { error: "孩子不存在" });
  if (BB.hashPattern(pattern || []) !== child.patternHash) return json(ctx.res, 400, { error: "手势密码不正确" });
  json(ctx.res, 200, { token: mkSession("child", child.id), child: sanitizeChild(child) });
});
route("GET", "/api/family/:code", async (ctx) => { // 家庭码 → 孩子列表（不含敏感数据）
  const parent = DB.parents.find(p => p.familyCode === ctx.params.code);
  if (!parent) return json(ctx.res, 400, { error: "家庭码不正确" });
  const children = DB.children.filter(c => c.parentId === parent.id).map(c => {
    const s = sanitizeChild(c);
    s.hasPattern = !!c.patternHash;
    s.hint = DB.settings.hintFirstDot ? (c.patternHint != null ? c.patternHint : null) : null;
    return s;
  });
  json(ctx.res, 200, { children });
});

// ---- 家长端 ----
route("GET", "/api/parent/children", async (ctx) => {
  const children = DB.children.filter(c => c.parentId === ctx.user.id).map(sanitizeChild);
  json(ctx.res, 200, { children });
});
route("POST", "/api/parent/children", async (ctx) => {
  const { name, avatar } = ctx.data;
  const mine = DB.children.filter(c => c.parentId === ctx.user.id);
  if (mine.length >= 5) return json(ctx.res, 400, { error: "单个家长最多创建5个孩子账号" });
  if (!name || !String(name).trim()) return json(ctx.res, 400, { error: "请填写孩子昵称" });
  if (mine.some(c => c.name === String(name).trim())) return json(ctx.res, 400, { error: "已有同名孩子账号" });
  const child = {
    id: BB.uid("c"), parentId: ctx.user.id, name: String(name).trim(),
    avatar: avatar || "🐣", patternHash: null, createdAt: new Date().toISOString()
  };
  DB.children.push(child); saveDB();
  json(ctx.res, 200, { child: sanitizeChild(child) });
});
route("POST", "/api/parent/children/:id/reset-pattern", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  const { pattern } = ctx.data;
  if (!Array.isArray(pattern) || pattern.length < 4) return json(ctx.res, 400, { error: "请至少连接4个点" });
  child.patternHash = BB.hashPattern(pattern);
  child.patternHint = pattern[0]; saveDB();
  addLog("parent", child.id, "reset-pattern", "", "家长重置了九宫格密码");
  json(ctx.res, 200, { ok: true });
});
route("DELETE", "/api/parent/children/:id", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  DB.children = DB.children.filter(c => c.id !== child.id);
  Object.keys(DB.records).forEach(rk => { if (rk.split("|")[0] === child.id) delete DB.records[rk]; });
  try { fs.rmSync(childDir(child.id), { recursive: true, force: true }); } catch (e) {}
  saveDB();
  json(ctx.res, 200, { ok: true });
});
// 孩子详情（任意日期）
route("GET", "/api/parent/child/:id", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  const q = ctx.url.searchParams;
  const key = q.get("date") || BB.dateKey();
  const rk = child.id + "|" + key;
  const rec = DB.records[rk];
  // 纵向成长统计
  const childRecords = {};
  Object.keys(DB.records).forEach(k => { if (k.split("|")[0] === child.id) childRecords[k] = DB.records[k]; });
  json(ctx.res, 200, {
    child: sanitizeChild(child), date: key, record: recordView(rec, true),
    stats: BB.computeStats(childRecords), days: Object.keys(childRecords).map(k => k.split("|")[1]).sort()
  });
});
// 写评语（每天一条，覆盖式）
route("POST", "/api/parent/child/:id/comment", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  const { text, date } = ctx.data;
  const key = date || BB.dateKey();
  if (!text || !String(text).trim()) return json(ctx.res, 400, { error: "评语不能为空" });
  const rec = getRecord(child.id, key);
  const now = Date.now();
  const prev = rec.comment;
  // 防抖：60秒内多次编辑只推一次提示；家长可关闭推送
  let notify = false;
  if (DB.settings.notifyEnabled) {
    if (!prev || !prev.notifyAt || now - prev.notifyAt > 60000) { notify = true; }
  }
  rec.comment = { text: String(text).trim(), at: new Date().toISOString(), by: "parent", notifyAt: notify ? now : (prev ? prev.notifyAt : 0) };
  saveDB();
  json(ctx.res, 200, { ok: true, notified: notify });
});
// 手动重置打卡项（评语保留/清空由家长选择）
route("POST", "/api/parent/child/:id/reset-item", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  const { item, date, keepComment } = ctx.data;
  if (!BB.ITEMS[item]) return json(ctx.res, 400, { error: "无效打卡项" });
  const key = date || BB.dateKey();
  const rec = getRecord(child.id, key);
  const it = rec.items[item];
  if (!it || !it.done) return json(ctx.res, 400, { error: "该项目未完成，无需重置" });
  rec.items[item] = { done: false, skipped: false, images: [], updatedAt: new Date().toISOString() };
  if (keepComment === false && rec.comment) rec.comment = null;
  addLog("parent", child.id, "reset-item", item, "家长重置「" + BB.ITEMS[item].name + "」" + (keepComment === false ? "，评语已清空" : "，评语保留"));
  saveDB();
  json(ctx.res, 200, { ok: true, record: recordView(rec, true) });
});
route("GET", "/api/parent/child/:id/logs", async (ctx) => {
  const child = findChild(ctx.params.id);
  if (!child || child.parentId !== ctx.user.id) return json(ctx.res, 403, { error: "无权限" });
  const logs = DB.logs.filter(l => l.childId === child.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
  json(ctx.res, 200, { logs });
});
// 家长设置
route("GET", "/api/parent/settings", async (ctx) => {
  const s = Object.assign({}, DB.settings);
  s.aiApiKey = s.aiApiKey ? "已配置" : "";
  json(ctx.res, 200, { settings: s });
});
route("POST", "/api/parent/settings", async (ctx) => {
  const allow = ["aiMarkVisibility", "autoCleanDays", "notifyEnabled", "maxImagesPerItem", "hintFirstDot", "aiApiUrl", "aiModel"];
  allow.forEach(k => { if (k in ctx.data) DB.settings[k] = ctx.data[k]; });
  if (typeof ctx.data.aiApiKey === "string" && ctx.data.aiApiKey && ctx.data.aiApiKey !== "已配置") DB.settings.aiApiKey = ctx.data.aiApiKey;
  if (ctx.data.autoCleanDays != null) DB.settings.autoCleanDays = Math.max(0, ctx.data.autoCleanDays | 0);
  if (ctx.data.maxImagesPerItem != null) DB.settings.maxImagesPerItem = Math.min(9, Math.max(1, ctx.data.maxImagesPerItem | 0));
  saveDB();
  json(ctx.res, 200, { ok: true });
});

// ---- 孩子端 ----
route("GET", "/api/child/home", async (ctx) => {
  const child = findChild(ctx.user.id);
  const tk = BB.dateKey();
  const yk = BB.prevDateKey(tk);
  const childRecords = {};
  Object.keys(DB.records).forEach(k => { if (k.split("|")[0] === child.id) childRecords[k] = DB.records[k]; });
  // AI 标记可见范围：parent-only 时孩子端不返回 marks
  const view = recordView(childRecords[child.id + "|" + tk], true);
  if (view && DB.settings.aiMarkVisibility === "parent" && view.items) {
    Object.keys(view.items).forEach(k => {
      (view.items[k].images || []).forEach(img => { if (img.ai) img.ai = { status: img.ai.status, engine: img.ai.engine, at: img.ai.at, hidden: true }; });
    });
  }
  const yrec = childRecords[child.id + "|" + yk];
  json(ctx.res, 200, {
    child: sanitizeChild(child), today: BB.dateKey(),
    todayRecord: view, yesterday: {
      date: yk, score: yrec ? BB.computeScore(yrec).score : 0,
      comment: (yrec && yrec.comment) ? yrec.comment : null
    },
    todayComment: (view && view.comment) || null,
    stats: BB.computeStats(childRecords),
    settings: {
      aiMarkVisibility: DB.settings.aiMarkVisibility, hintFirstDot: !!DB.settings.hintFirstDot,
      maxImagesPerItem: DB.settings.maxImagesPerItem
    }
  });
});
route("GET", "/api/child/history", async (ctx) => {
  const child = findChild(ctx.user.id);
  const key = ctx.url.searchParams.get("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return json(ctx.res, 400, { error: "日期无效" });
  const rec = DB.records[child.id + "|" + key];
  const childRecords = {};
  Object.keys(DB.records).forEach(k => { if (k.split("|")[0] === child.id) childRecords[k] = DB.records[k]; });
  let view = recordView(rec, true);
  if (view && DB.settings.aiMarkVisibility === "parent" && view.items) {
    Object.keys(view.items).forEach(k => {
      (view.items[k].images || []).forEach(img => { if (img.ai) img.ai = { status: img.ai.status, engine: img.ai.engine, at: img.ai.at, hidden: true }; });
    });
  }
  json(ctx.res, 200, { date: key, record: view, days: Object.keys(childRecords).map(k => k.split("|")[1]).sort().reverse() });
});
// 打卡上传（多图，base64）
route("POST", "/api/child/checkin", async (ctx) => {
  const child = findChild(ctx.user.id);
  const { item, images, quality } = ctx.data;
  if (!BB.ITEMS[item]) return json(ctx.res, 400, { error: "无效打卡项" });
  const tk = BB.dateKey();
  const rec = getRecord(child.id, tk);
  let it = rec.items[item] || (rec.items[item] = {});
  const max = DB.settings.maxImagesPerItem || 5;
  const newImgs = Array.isArray(images) ? images : [];
  if (newImgs.length > max) return json(ctx.res, 400, { error: "单次最多上传" + max + "张图片" });
  const isRe = !!(it.done);
  const dir = childDir(child.id);
  fs.mkdirSync(dir, { recursive: true });
  // 删除旧图文件
  (it.images || []).forEach(img => { try { fs.unlinkSync(path.join(dir, img.id + ".bin")); } catch (e) {} });
  const saved = newImgs.map(im => {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(im.dataUrl || "");
    if (!m) return null;
    const id = BB.uid("img");
    fs.writeFileSync(path.join(dir, id + ".bin"), Buffer.from(m[2], "base64"));
    return { id, name: im.name || "作业.jpg", mime: m[1], w: im.w || 0, h: im.h || 0, childId: child.id, at: new Date().toISOString(), ai: { status: "pending" } };
  }).filter(Boolean);
  if (!saved.length) return json(ctx.res, 400, { error: "图片数据无效" });
  it.images = saved; it.done = true; it.skipped = false; it.updatedAt = new Date().toISOString();
  addLog("child", child.id, isRe ? "reupload" : "upload", item,
    (isRe ? "重新上传" : "上传") + "「" + BB.ITEMS[item].name + "」" + saved.length + "张图片" +
    (quality && quality.warned ? "（画质提示后仍继续）" : ""));
  saveDB();
  // 异步 AI 判题（仅必做项；不阻断打卡）
  judgeImages(saved, BB.ITEMS[item].type === "required");
  json(ctx.res, 200, { ok: true, record: recordView(getRecord(child.id, tk), true) });
});
// 选做项跳过（二次确认由前端完成后传 confirm:true）
route("POST", "/api/child/skip", async (ctx) => {
  const child = findChild(ctx.user.id);
  const { item, confirm } = ctx.data;
  if (BB.ITEMS[item] && BB.ITEMS[item].type !== "optional") return json(ctx.res, 400, { error: "仅选做项目可跳过" });
  if (!confirm) return json(ctx.res, 400, { error: "需二次确认" });
  const tk = BB.dateKey();
  const rec = getRecord(child.id, tk);
  const it = rec.items[item] || (rec.items[item] = {});
  it.done = true; it.skipped = true; it.images = []; it.updatedAt = new Date().toISOString();
  addLog("child", child.id, "skip", item, "选择「今日无打卡内容」跳过「" + BB.ITEMS[item].name + "」（不计入选做加分）");
  saveDB();
  json(ctx.res, 200, { ok: true, record: recordView(rec, true) });
});
// 轮询某打卡项 AI 状态
route("GET", "/api/child/item/:item", async (ctx) => {
  const child = findChild(ctx.user.id);
  if (!BB.ITEMS[ctx.params.item]) return json(ctx.res, 400, { error: "无效项" });
  const tk = BB.dateKey();
  const rec = DB.records[child.id + "|" + tk];
  const it = rec && rec.items[ctx.params.item];
  const out = { done: !!(it && it.done), ai: {} };
  if (it && it.images) {
    it.images.forEach(img => { out.ai[img.id] = img.ai; });
  }
  if (DB.settings.aiMarkVisibility === "parent") {
    Object.keys(out.ai).forEach(k => { if (out.ai[k]) out.ai[k] = { status: out.ai[k].status, hidden: true }; });
  }
  json(ctx.res, 200, out);
});
// 图片访问（需孩子/家长会话令牌）
route("GET", "/img/:childId/:imgId", async (ctx) => {
  const img = ctx.url.searchParams.get("t");
  if (!img || !DB.sessions[img]) { ctx.res.writeHead(401); return ctx.res.end("unauthorized"); }
  const file = path.join(childDir(ctx.params.childId), ctx.params.imgId + ".bin");
  if (!fs.existsSync(file)) { ctx.res.writeHead(404); return ctx.res.end("not found"); }
  const rec = DB.records[ctx.params.childId + "|" + BB.dateKey()];
  let mime = "image/jpeg";
  for (const rk in DB.records) {
    for (const k in DB.records[rk].items || {}) {
      const found = (DB.records[rk].items[k].images || []).find(i => i.id === ctx.params.imgId);
      if (found) { mime = found.mime || "image/jpeg"; break; }
    }
  }
  const buf = fs.readFileSync(file);
  ctx.res.writeHead(200, { "Content-Type": mime, "Cache-Control": "private, max-age=86400" });
  ctx.res.end(buf);
});

/* ---- AI 判题执行 ---- */
async function judgeImages(images, isRequired) {
  if (!isRequired) return; // 阅读打卡、体育打卡不启用AI判题
  for (const img of images) {
    try {
      if (DB.settings.aiApiUrl && DB.settings.aiApiKey) {
        img.ai = await callRealAI(img);
      } else {
        img.ai = simulateAI(img);
      }
    } catch (e) {
      img.ai = { status: "failed", engine: "api", marks: [], at: new Date().toISOString(), note: "AI暂无法识别本次作业" };
    }
    saveDB();
  }
}

/* ---------------- 静态文件 ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  if (pathname === "/" || pathname === "") file = path.join(PUBLIC_DIR, "index.html");
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(b2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---------------- 请求分发 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); return res.end(); }
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/img/")) return serveStatic(req, res, pathname);

  const segs = pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  let matched = null, params = {};
  for (const r of routes) {
    if (r.method !== method) continue;
    const p = r.parts; // e.g. ["api","ping"]
    if (p.length !== segs.length) continue;
    let ok = true, prm = {};
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(":")) prm[p[i].slice(1)] = segs[i];
      else if (p[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) { matched = r; params = prm; break; }
  }
  if (!matched) { return json(res, 404, { error: "接口不存在" }); }
  const a = auth(req);
  const routePath = "/" + matched.parts.join("/");
  const exempt = ["/api/ping", "/api/register", "/api/login", "/api/child-login", "/api/family/:code"];
  // /img/* 自带 ?t= 令牌校验，不走 Authorization 头
  const needAuth = !exempt.includes(routePath) && routePath !== "/img/:childId/:imgId";
  if (needAuth) {
    if (!a) return json(res, 401, { error: "请先登录" });
    const role = a.session.role;
    const isParentRoute = matched.parts[1] === "parent";
    const isChildRoute = matched.parts[1] === "child";
    if (isParentRoute && role !== "parent") return json(res, 403, { error: "需要家长权限" });
    if (isChildRoute && role !== "child") return json(res, 403, { error: "需要孩子权限" });
  }
  try {
    const data = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? await body(req) : {};
    await matched.handler({ req, res, url, params, data, user: a ? a.session : null, token: a ? a.token : null });
  } catch (e) {
    console.error("API错误:", e);
    try { json(res, 500, { error: "服务器内部错误" }); } catch (_) {}
  }
});

server.listen(PORT, () => console.log("BB星打卡系统已启动: http://localhost:" + PORT));
