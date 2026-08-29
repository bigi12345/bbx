/* BB星 - 本地演示引擎（engine-local.js）同构性测试
 * 在 Node 中打桩 localStorage/setTimeout，复用与 selftest.js 相同的 API 语义 */
"use strict";
const path = require("path");
const fs = require("fs");

// ---- 打桩浏览器环境 ----
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.window = global; // engine-local 挂到 window
const timers = [];
global.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };

// 加载共享逻辑与本地引擎
require(path.join(__dirname, "public/js/shared.js"));
require(path.join(__dirname, "public/js/engine-local.js"));
const LE = global.LocalEngine;
const BB = global.BBShared;

const IMG = (n) => ({ name: "img" + n + ".png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function req(method, p, data, token) {
  const r = LE.handle(method, p, data, token);
  return { status: r.status, data: r.body || {} };
}
function flushTimers() { while (timers.length) { const t = timers.shift(); t(); } }

(async () => {
  const tok0 = await req("POST", "/api/ping", {}, null); // ping
  console.log("== 1. ping / 注册登录 ==");
  const ping = await req("GET", "/api/ping", null, null);
  check("ping 本地模式", ping.data.mode === "local" && ping.data.ok === true);
  const reg = await req("POST", "/api/register", { username: "dad01", password: "1234" });
  check("家长注册", reg.status === 200 && !!reg.data.token);
  const dup = await req("POST", "/api/register", { username: "dad01", password: "1234" });
  check("重复注册被拒绝", dup.status === 400);
  const bad = await req("POST", "/api/login", { username: "dad01", password: "0000" });
  check("错误密码被拒绝", bad.status === 400);
  const pt = reg.data.token, familyCode = reg.data.parent.familyCode;

  console.log("== 2. 孩子账号 / 九宫格 ==");
  const c1 = await req("POST", "/api/parent/children", { name: "豆豆", avatar: "🐯" }, pt);
  check("创建孩子", c1.status === 200 && !!c1.data.child);
  for (let i = 0; i < 5; i++) { await req("POST", "/api/parent/children", { name: "备" + i }, pt); }
  const c6 = await req("POST", "/api/parent/children", { name: "老六" }, pt);
  check("第6个孩子被拒绝(上限5)", c6.status === 400);
  const rs = await req("POST", "/api/parent/children/" + c1.data.child.id + "/reset-pattern", { pattern: [0, 4, 8, 5, 2] }, pt);
  check("设置九宫格密码", rs.status === 200);
  const fam = await req("GET", "/api/family/" + familyCode, null, null);
  check("家庭码查询(豆豆+备0~3=5个)", fam.status === 200 && Array.isArray(fam.data.children) && fam.data.children.length === 5);
  const badLogin = await req("POST", "/api/child-login", { familyCode, childId: c1.data.child.id, pattern: [1, 2, 3, 4] });
  check("错误手势被拒绝", badLogin.status === 400);
  const okLogin = await req("POST", "/api/child-login", { familyCode, childId: c1.data.child.id, pattern: [0, 4, 8, 5, 2] });
  check("孩子手势登录", okLogin.status === 200 && !!okLogin.data.token);
  const ct = okLogin.data.token;
  const noAuth = await req("GET", "/api/child/home", null, null);
  check("未登录被拒绝", noAuth.status === 401);
  const wrongRole = await req("GET", "/api/child/home", null, pt);
  check("家长token访问孩子接口被拒", wrongRole.status === 403);

  console.log("== 3. 打卡与计分 ==");
  await req("POST", "/api/child/checkin", { item: "yuwen", images: [IMG(1)] }, ct);
  let home = await req("GET", "/api/child/home", null, ct);
  check("1项必做=2分", home.data.todayRecord.score === 2, home.data.todayRecord.score);
  await req("POST", "/api/child/checkin", { item: "shuxue", images: [IMG(2)] }, ct);
  await req("POST", "/api/child/checkin", { item: "yingyu", images: [IMG(3)] }, ct);
  await req("POST", "/api/child/checkin", { item: "danci", images: [IMG(4)] }, ct);
  home = await req("GET", "/api/child/home", null, ct);
  check("4项必做=8分", home.data.todayRecord.score === 8);
  const tooMany = await req("POST", "/api/child/checkin", { item: "tiyu", images: [IMG(1), IMG(2), IMG(3), IMG(4), IMG(5), IMG(6)] }, ct);
  check("超过单次图片上限被拒", tooMany.status === 400);
  const noConfirm = await req("POST", "/api/child/skip", { item: "tiyu" }, ct);
  check("跳过无二次确认被拒", noConfirm.status === 400);
  const skip = await req("POST", "/api/child/skip", { item: "tiyu", confirm: true }, ct);
  check("体育跳过成功", skip.status === 200 && skip.data.record.items.tiyu.skipped === true);
  await req("POST", "/api/child/checkin", { item: "yuedu", images: [IMG(5)] }, ct);
  home = await req("GET", "/api/child/home", null, ct);
  check("8+阅读1+体育0=9分", home.data.todayRecord.score === 9, home.data.todayRecord.score);
  check("统计-今日得分9", home.data.stats.todayScore === 9);
  const reqSkip = await req("POST", "/api/child/skip", { item: "yuwen", confirm: true }, ct);
  check("必做项不可跳过", reqSkip.status === 400);

  console.log("== 4. AI演示识别 ==");
  flushTimers();
  const item = await req("GET", "/api/child/item/yuwen", null, ct);
  check("AI状态done(演示模拟)", item.data.ai && Object.keys(item.data.ai).length === 1 &&
    Object.values(item.data.ai)[0].status === "done", item.data.ai);

  console.log("== 5. 重传覆盖 ==");
  await req("POST", "/api/child/checkin", { item: "yuwen", images: [IMG(9)] }, ct);
  home = await req("GET", "/api/child/home", null, ct);
  check("重传后仍是1张图", home.data.todayRecord.items.yuwen.images.length === 1);
  check("重传后分数不变(9)", home.data.todayRecord.score === 9);

  console.log("== 6. 评语防抖 ==");
  const cmt1 = await req("POST", "/api/parent/child/" + c1.data.child.id + "/comment", { text: "加油" }, pt);
  check("首条评语触发通知", cmt1.data.notified === true);
  const cmt2 = await req("POST", "/api/parent/child/" + c1.data.child.id + "/comment", { text: "加油2" }, pt);
  check("60秒内修改不重复通知(防抖)", cmt2.data.notified === false, cmt2.data);
  home = await req("GET", "/api/child/home", null, ct);
  check("孩子端看到当日最新评语", home.data.todayComment && home.data.todayComment.text === "加油2");

  console.log("== 7. 家长重置 / 日志 / 权限 ==");
  const det = await req("GET", "/api/parent/child/" + c1.data.child.id + "?date=" + BB.dateKey(), null, pt);
  check("家长查看当日详情", det.status === 200 && det.data.record.score === 9);
  const rz = await req("POST", "/api/parent/child/" + c1.data.child.id + "/reset-item", { item: "yuedu", keepComment: true }, pt);
  check("家长重置阅读项(评语保留)", rz.status === 200 && rz.data.record.items.yuedu.done === false && rz.data.record.comment);
  home = await req("GET", "/api/child/home", null, ct);
  check("重置后分数=8(阅读加分移除)", home.data.todayRecord.score === 8, home.data.todayRecord.score);
  const logs = await req("GET", "/api/parent/child/" + c1.data.child.id + "/logs", null, pt);
  check("操作日志存在(含上传/重传/跳过/重置)", logs.status === 200 &&
    ["upload", "reupload", "skip"].every(a => logs.data.logs.some(l => l.action === a)) &&
    logs.data.logs.some(l => l.action === "reset-item"), logs.data.logs.map(l => l.action));
  check("AI识别不写入日志", !logs.data.logs.some(l => String(l.action).indexOf("ai") >= 0));
  const child403 = await req("GET", "/api/parent/child/" + c1.data.child.id, null, ct);
  check("孩子token访问家长接口被拒", child403.status === 403);

  console.log("== 8. AI可见范围 / 设置 ==");
  await req("POST", "/api/parent/settings", { aiMarkVisibility: "parent" }, pt);
  const it2 = await req("GET", "/api/child/item/yuwen", null, ct);
  const aiVal = Object.values(it2.data.ai || {})[0];
  check("孩子端AI标记被隐藏", aiVal && aiVal.hidden === true, aiVal);
  const det2 = await req("GET", "/api/parent/child/" + c1.data.child.id, null, pt);
  check("家长端仍可见AI标记", det2.data.record.items.yuwen &&
    det2.data.record.items.yuwen.images[0].ai && !det2.data.record.items.yuwen.images[0].ai.hidden);
  const sget = await req("GET", "/api/parent/settings", null, pt);
  check("设置回显", sget.data.settings.aiMarkVisibility === "parent");
  await req("POST", "/api/parent/settings", { aiMarkVisibility: "both" }, pt);

  console.log("== 9. 历史记录 ==");
  const hist = await req("GET", "/api/child/history?date=" + BB.dateKey(), null, ct);
  check("孩子查今日历史", hist.status === 200 && hist.data.record.score === 8);
  const badDate = await req("GET", "/api/child/history?date=bad", null, ct);
  check("非法日期被拒绝", badDate.status === 400);
  const notFound = await req("GET", "/api/nothing", null, ct);
  check("未知接口404", notFound.status === 404);

  console.log("== 10. 删除孩子 / 会话持久化 ==");
  const kids = await req("GET", "/api/parent/children", null, pt);
  const victim = kids.data.children.find(c => c.name === "备0");
  const del = await req("DELETE", "/api/parent/children/" + victim.id, null, pt);
  check("删除孩子", del.status === 200);
  const kids2 = await req("GET", "/api/parent/children", null, pt);
  check("删除后剩4个", kids2.data.children.length === 4);
  // 会话 30 天有效
  const homeAgain = await req("GET", "/api/child/home", null, ct);
  check("会话仍有效", homeAgain.status === 200);

  console.log("\n========== 本地引擎测试结果: " + pass + " 通过 / " + fail + " 失败 ==========");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试崩溃:", e); process.exit(1); });
