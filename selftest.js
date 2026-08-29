/* BB星打卡系统 - 端到端功能自查脚本（node 18+，直接运行） */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra ? " → " + JSON.stringify(extra).slice(0, 200) : "")); }
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function req(method, path, data, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      if (i > 0) { await sleep(1200); console.log("    ↻ 重试 " + path); }
      const r = await fetch(BASE + path, { method, headers, body: data ? JSON.stringify(data) : undefined });
      let j = null; try { j = await r.json(); } catch (e) {}
      return { status: r.status, data: j };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

(async () => {
  console.log("== 0. 服务与静态页面 ==");
  const ping = await req("GET", "/api/ping");
  check("GET /api/ping 返回 ok", ping.status === 200 && ping.data.ok === true);
  const html = await fetch(BASE + "/");
  const htmlText = await html.text();
  check("首页可访问且含标题", html.status === 200 && htmlText.includes("BB星"));
  const css = await fetch(BASE + "/css/style.css");
  check("样式表可访问", css.status === 200);
  const js = await fetch(BASE + "/js/app.js");
  check("前端脚本可访问", js.status === 200);

  console.log("== 1. 家长账号体系 ==");
  const uname = "testparent" + Date.now().toString(36);
  const reg = await req("POST", "/api/register", { username: uname, password: "1234" });
  check("家长注册成功", reg.status === 200 && reg.data.token);
  const regDup = await req("POST", "/api/register", { username: uname, password: "1234" });
  check("重复用户名被拒绝", regDup.status === 400);
  const regBad = await req("POST", "/api/register", { username: "a", password: "1" });
  check("弱用户名/密码被拒绝", regBad.status === 400);
  const loginBad = await req("POST", "/api/login", { username: uname, password: "wrong" });
  check("错误密码登录被拒绝", loginBad.status === 400);
  const login = await req("POST", "/api/login", { username: uname, password: "1234" });
  check("家长登录成功", login.status === 200);
  const pt = reg.data.token;
  const fc = reg.data.parent.familyCode;
  check("生成4位家庭码", /^\d{4}$/.test(fc));
  const noAuth = await req("GET", "/api/parent/children");
  check("未登录访问家长接口被拦截(401)", noAuth.status === 401);

  console.log("== 2. 孩子账号 + 九宫格 ==");
  const c1 = await req("POST", "/api/parent/children", { name: "小雨", avatar: "🐰" }, pt);
  check("创建孩子1成功", c1.status === 200 && c1.data.child.id);
  const c2 = await req("POST", "/api/parent/children", { name: "小天", avatar: "🐯" }, pt);
  check("创建孩子2成功", c2.status === 200);
  const pat = [0, 1, 4, 3];
  const setPat = await req("POST", "/api/parent/children/" + c1.data.child.id + "/reset-pattern", { pattern: pat }, pt);
  check("设置九宫格密码成功", setPat.status === 200);
  const fam = await req("GET", "/api/family/" + fc);
  check("家庭码查询孩子列表", fam.status === 200 && fam.data.children.length === 2);
  const clBad = await req("POST", "/api/child-login", { familyCode: fc, childId: c1.data.child.id, pattern: [0, 2, 4, 6] });
  check("错误手势被拒绝", clBad.status === 400);
  const cl = await req("POST", "/api/child-login", { familyCode: fc, childId: c1.data.child.id, pattern: pat });
  check("孩子九宫格登录成功", cl.status === 200 && cl.data.token);
  const ct = cl.data.token;
  const cross = await req("GET", "/api/parent/children", null, ct);
  check("孩子token访问家长接口被拦截(403)", cross.status === 403);

  console.log("== 3. 打卡上传 + 计分 ==");
  const ck1 = await req("POST", "/api/child/checkin", { item: "yuwen", images: [{ name: "a.png", dataUrl: tinyPng }] }, ct);
  check("语文作业打卡成功", ck1.status === 200);
  const home1 = await req("GET", "/api/child/home", null, ct);
  check("上传后得分=2（必做1项）", home1.data.todayRecord.score === 2, home1.data.todayRecord);
  check("AI判题进入pending或done", (() => {
    const imgs = home1.data.todayRecord.items.yuwen.images;
    return imgs.length === 1 && imgs[0].ai && ["pending", "done"].includes(imgs[0].ai.status);
  })(), home1.data.todayRecord.items.yuwen);
  // 等AI判题完成
  await new Promise(r => setTimeout(r, 800));
  const itemPoll = await req("GET", "/api/child/item/yuwen", null, ct);
  const aiArr = Object.values(itemPoll.data.ai || {});
  check("AI判题轮询返回结果", aiArr.length === 1 && aiArr[0].status === "done", itemPoll.data);
  // 其余必做
  await req("POST", "/api/child/checkin", { item: "shuxue", images: [{ name: "b.png", dataUrl: tinyPng }] }, ct);
  await req("POST", "/api/child/checkin", { item: "yingyu", images: [{ name: "c.png", dataUrl: tinyPng }] }, ct);
  await req("POST", "/api/child/checkin", { item: "danci", images: [{ name: "d.png", dataUrl: tinyPng }] }, ct);
  // 选做：阅读上传图（计分）、体育跳过（不计分）
  await req("POST", "/api/child/checkin", { item: "yuedu", images: [{ name: "e.png", dataUrl: tinyPng }] }, ct);
  const skipNoConfirm = await req("POST", "/api/child/skip", { item: "tiyu" }, ct);
  check("跳过缺少二次确认被拒绝", skipNoConfirm.status === 400);
  const skip = await req("POST", "/api/child/skip", { item: "tiyu", confirm: true }, ct);
  check("跳过体育打卡成功", skip.status === 200);
  const home2 = await req("GET", "/api/child/home", null, ct);
  check("全打卡得分=9（4必做8分+阅读1分+体育跳过0分）", home2.data.todayRecord.score === 9, { score: home2.data.todayRecord.score });
  check("体育标记为skipped", home2.data.todayRecord.items.tiyu.skipped === true);
  check("星星统计-今日9颗", home2.data.stats.todayScore === 9);

  console.log("== 4. 多图上限 / 重新上传覆盖 ==");
  const tooMany = await req("POST", "/api/child/checkin", { item: "yuwen", images: [1, 2, 3, 4, 5, 6].map(i => ({ name: i + ".png", dataUrl: tinyPng })) }, ct);
  check("超过单科目图片上限被拒绝", tooMany.status === 400);
  const reUp = await req("POST", "/api/child/checkin", { item: "yuwen", images: [{ name: "new.png", dataUrl: tinyPng }] }, ct);
  check("重新上传覆盖成功", reUp.status === 200 && reUp.data.record.items.yuwen.images.length === 1);
  const home2b = await req("GET", "/api/child/home", null, ct);
  check("重传后分数不变(仍9)", home2b.data.todayRecord.score === 9);

  console.log("== 5. 家长端：评语 / 重置 / 日志 ==");
  const cm = await req("POST", "/api/parent/child/" + c1.data.child.id + "/comment", { text: "今天很棒！" }, pt);
  check("写评语成功且通知", cm.status === 200 && cm.data.notified === true);
  const cm2 = await req("POST", "/api/parent/child/" + c1.data.child.id + "/comment", { text: "今天非常棒！" }, pt);
  check("60秒内再编辑不重复通知（防抖）", cm2.status === 200 && cm2.data.notified === false);
  const home3 = await req("GET", "/api/child/home", null, ct);
  check("孩子端能看到最新评语", home3.data.todayComment && home3.data.todayComment.text === "今天非常棒！");
  const cmEmpty = await req("POST", "/api/parent/child/" + c1.data.child.id + "/comment", { text: "  " }, pt);
  check("空评语被拒绝", cmEmpty.status === 400);
  // 重置：清空评语选项
  const rst = await req("POST", "/api/parent/child/" + c1.data.child.id + "/reset-item", { item: "tiyu", keepComment: false }, pt);
  check("家长重置已打卡项成功", rst.status === 200);
  const home4 = await req("GET", "/api/child/home", null, ct);
  check("重置后体育回灰、分数重算(8+1=9)", home4.data.todayRecord.score === 9 && home4.data.todayRecord.items.tiyu.done === false, home4.data.todayRecord);
  check("重置时选择清空评语→评语为空", home4.data.todayComment === null);
  const logs = await req("GET", "/api/parent/child/" + c1.data.child.id + "/logs", null, pt);
  const acts = logs.data.logs.map(l => l.action);
  check("操作日志包含 upload/skip/reset-item", acts.includes("upload") && acts.includes("skip") && acts.includes("reset-item"));
  check("日志包含重传记录", acts.includes("reupload"));
  check("AI识别结果不写入日志", !acts.includes("ai"));

  console.log("== 6. 权限与隔离 ==");
  const reg2 = await req("POST", "/api/register", { username: "other" + Date.now().toString(36), password: "1234" });
  const pt2 = reg2.data.token;
  const foreign = await req("GET", "/api/parent/child/" + c1.data.child.id, null, pt2);
  check("其他家长无法查看别人的孩子(403)", foreign.status === 403);
  const foreignRst = await req("POST", "/api/parent/children/" + c1.data.child.id + "/reset-pattern", { pattern: [1, 2, 3, 4] }, pt2);
  check("其他家长无法重置别人的密码(403)", foreignRst.status === 403);
  // 5个孩子上限
  await req("POST", "/api/parent/children", { name: "小一" }, pt2);
  await req("POST", "/api/parent/children", { name: "小二" }, pt2);
  await req("POST", "/api/parent/children", { name: "小三" }, pt2);
  await req("POST", "/api/parent/children", { name: "小四" }, pt2);
  await req("POST", "/api/parent/children", { name: "小五" }, pt2);
  const six = await req("POST", "/api/parent/children", { name: "小六" }, pt2);
  check("第6个孩子被拒绝（上限5个）", six.status === 400);

  console.log("== 7. 家长端详情/日期筛选/图片访问 ==");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const det = await req("GET", "/api/parent/child/" + c1.data.child.id + "?date=" + today, null, pt);
  check("家长查看当日详情", det.status === 200 && det.data.record && det.data.record.items.yuwen.done === true);
  check("家长端可见AI标记数据", det.data.record.items.yuwen.images[0].ai.status === "done");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const detY = await req("GET", "/api/parent/child/" + c1.data.child.id + "?date=" + yesterday, null, pt);
  check("历史日期查询为空记录", detY.status === 200 && detY.data.record === null);
  // 图片访问需令牌
  const imgId = det.data.record.items.yuwen.images[0].id;
  const imgNoT = await fetch(BASE + "/img/" + c1.data.child.id + "/" + imgId);
  check("无令牌访问图片被拒绝(401)", imgNoT.status === 401);
  const imgOk = await fetch(BASE + "/img/" + c1.data.child.id + "/" + imgId + "?t=" + pt);
  check("带令牌可访问图片", imgOk.status === 200 && (imgOk.headers.get("content-type") || "").startsWith("image/"));

  console.log("== 8. 设置 / AI可见范围 / 推送开关 ==");
  const sSet = await req("POST", "/api/parent/settings", { aiMarkVisibility: "parent", notifyEnabled: false, autoCleanDays: 30, maxImagesPerItem: 3 }, pt);
  check("保存家长设置", sSet.status === 200);
  const homeHid = await req("GET", "/api/child/home", null, ct);
  check("孩子端AI标记被隐藏（仅家长可见）", homeHid.data.todayRecord.items.yuwen.images[0].ai.hidden === true);
  const detSee = await req("GET", "/api/parent/child/" + c1.data.child.id + "?date=" + today, null, pt);
  check("家长端仍可见AI标记", detSee.data.record.items.yuwen.images[0].ai.status === "done");
  const sGet = await req("GET", "/api/parent/settings", null, pt);
  check("设置读取回显", sGet.data.settings.aiMarkVisibility === "parent" && sGet.data.settings.maxImagesPerItem === 3);
  await req("POST", "/api/parent/settings", { aiMarkVisibility: "both", notifyEnabled: true }, pt);

  console.log("== 9. 历史打卡（孩子端） ==");
  const his = await req("GET", "/api/child/history?date=" + today, null, ct);
  check("孩子查今日历史记录", his.status === 200 && his.data.record.score === 9);
  const hisBad = await req("GET", "/api/child/history?date=abc", null, ct);
  check("非法日期被拒绝", hisBad.status === 400);

  console.log("\n========== 结果: " + pass + " 通过 / " + fail + " 失败 ==========");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试执行异常:", e); process.exit(2); });
