/* BB星每日作业打卡系统 - 前端应用 */
(function () {
"use strict";
const BB = window.BBShared;
const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");

const AVATARS = ["🐣", "🐰", "🐯", "🐼", "🦊", "🐨", "🦁", "🐷", "🐸", "🦄"];
const state = {
  view: "boot", timers: [], homeData: null, todayKey: null,
  parentInfo: null, childInfo: null, settings: {},
  pDetail: { childId: null, child: null, date: null, data: null }
};

/* ---------------- 基础工具 ---------------- */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
function clearTimers() { state.timers.forEach(t => clearInterval(t)); state.timers = []; }
function addTimer(t) { state.timers.push(t); }
function toast(msg, ms) {
  const w = document.getElementById("toast-wrap");
  const t = el('<div class="toast">' + esc(msg) + "</div>");
  w.appendChild(t);
  setTimeout(() => t.remove(), ms || 2600);
}
function openModal(html, plain) {
  $modal.innerHTML = plain ? html : '<div class="modal-mask"><div class="modal">' + html + "</div></div>";
  return $modal.firstChild;
}
function closeModal() { $modal.innerHTML = ""; }
function fmtTime(iso) {
  const d = new Date(iso);
  const p = n => (n < 10 ? "0" + n : n);
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function imgSrc(img, childId) {
  if (img.dataUrl) return img.dataUrl;
  return window.Api.imgUrl(childId, img.id);
}
function actionIcon(a) {
  return { upload: "📤", reupload: "🔄", skip: "⏭️", "reset-item": "↩️", "reset-pattern": "🔑", cleanup: "🧹" }[a] || "•";
}

/* ---------------- 得分可视化组件 ---------------- */
function scoreViz(score, label) {
  score = Math.max(0, Math.min(10, score | 0));
  let stars = "";
  for (let i = 0; i < 10; i++) stars += '<span class="star' + (i < score ? " on" : "") + '">⭐</span>';
  return (
    '<div class="score-viz">' +
    '<div class="row spread" style="margin-bottom:6px"><span class="score-num">' + esc(label || "今日得分") + " " + score + " / 10</span>" +
    (score === 10 ? '<span class="score-num" style="color:#E8A400">满分！🎉</span>' : "") + "</div>" +
    '<div class="energy-bar"><div class="energy-fill" style="width:' + score * 10 + '%"></div></div>' +
    '<div class="stars">' + stars + "</div></div>"
  );
}

/* ---------------- 图片查看器（AI √/× 覆盖标记） ---------------- */
function openViewer(img, childId, canSeeMarks) {
  const ai = img.ai || {};
  let marksHtml = "";
  if (canSeeMarks && ai.status === "done" && Array.isArray(ai.marks)) {
    marksHtml = ai.marks.map(m =>
      '<span class="ai-mark ' + (m.label === "correct" ? "correct" : "wrong") + '" style="left:' + m.x + "%;top:" + m.y + '%">' + (m.label === "correct" ? "√" : "×") + "</span>"
    ).join("");
  }
  let note = "";
  if (!canSeeMarks) note = "家长已开启「AI对错标记仅家长可见」";
  else if (ai.status === "pending") note = "AI识别中，请稍候…";
  else if (ai.status === "failed") note = "AI暂无法识别本次作业";
  else if (ai.status === "done") note = (ai.note || "AI识别") + " · 对错仅供参考，不参与计分";

  const mask = el(
    '<div class="viewer-mask">' +
    '<div class="viewer-img-wrap"><img src="' + esc(imgSrc(img, childId)) + '" alt="作业">' + marksHtml + "</div>" +
    '<div class="viewer-toolbar">' +
    '<span class="ai-note">' + esc(note) + "</span>" +
    '<button class="btn small ghost" id="v-close">关闭</button></div>' +
    '<div style="margin-top:10px;max-width:520px;text-align:center"><span class="ai-note">📝 作文/阅读理解等主观题 AI 无法评判，请家长人工审阅</span></div>' +
    "</div>"
  );
  document.body.appendChild(mask);
  mask.querySelector("#v-close").onclick = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) mask.remove(); };
}

/* ---------------- 九宫格连线组件 ---------------- */
function patternComponent(onDraw, opts) {
  opts = opts || {};
  const wrap = el(
    '<div><div class="pattern-box" id="pt-box">' +
    Array.from({ length: 9 }, (_, i) => '<div class="dot" data-i="' + i + '"></div>').join("") +
    "</div><div class='pattern-tip' id='pt-tip'>请按住并滑动连接至少4个点</div></div>"
  );
  const box = wrap.querySelector("#pt-box");
  const tip = wrap.querySelector("#pt-tip");
  let seq = [];
  function dotAt(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.classList && t.classList.contains("dot") ? t : null;
  }
  function addDot(d) {
    const i = d.dataset.i;
    if (seq.includes(i)) return;
    seq.push(i);
    d.classList.add("on");
    tip.textContent = "已连接 " + seq.length + " 个点";
  }
  box.addEventListener("pointerdown", e => {
    e.preventDefault();
    try { box.setPointerCapture(e.pointerId); } catch (_) {}
    seq = [];
    box.querySelectorAll(".dot").forEach(d => d.classList.remove("on"));
    const d = e.target.classList.contains("dot") ? e.target : dotAt(e.clientX, e.clientY);
    if (d) addDot(d);
  });
  box.addEventListener("pointermove", e => {
    if (!seq.length) return;
    e.preventDefault();
    const d = dotAt(e.clientX, e.clientY);
    if (d) addDot(d);
  });
  const finish = () => {
    if (seq.length >= (opts.min || 4)) {
      onDraw(seq.map(Number));
      if (opts.keep !== true) setTimeout(() => { seq = []; box.querySelectorAll(".dot").forEach(d => d.classList.remove("on")); tip.textContent = "请按住并滑动连接至少4个点"; }, 500);
    } else if (seq.length) {
      tip.textContent = "至少连接" + (opts.min || 4) + "个点，请重试";
      setTimeout(() => { seq = []; box.querySelectorAll(".dot").forEach(d => d.classList.remove("on")); }, 600);
    }
  };
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);
  if (opts.hintDot != null) {
    const d = box.querySelector('.dot[data-i="' + opts.hintDot + '"]');
    if (d) d.style.boxShadow = "0 0 0 4px #FFD6E8";
  }
  return wrap;
}

/* ---------------- 图片处理：压缩 + 画质检测 ---------------- */
function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function compress(dataUrl, maxDim, q) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      let w = im.width, h = im.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      res({ dataUrl: c.toDataURL("image/jpeg", q), w, h });
    };
    im.onerror = () => res({ dataUrl, w: 0, h: 0 });
    im.src = dataUrl;
  });
}
function checkQuality(dataUrl) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const s = 200;
      const sc = Math.min(1, s / Math.max(im.width, im.height));
      const w = Math.max(8, Math.round(im.width * sc)), h = Math.max(8, Math.round(im.height * sc));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(im, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let sum = 0, g = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        g[i] = v; sum += v;
      }
      const mean = sum / (w * h);
      // 拉普拉斯方差 → 清晰度
      let lapSum = 0, lapSq = 0, n = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        lapSum += lap; lapSq += lap * lap; n++;
      }
      const varL = lapSq / Math.max(1, n) - Math.pow(lapSum / Math.max(1, n), 2);
      res({ dark: mean < 68, blur: varL < 45, ok: mean >= 68 && varL >= 45 });
    };
    im.onerror = () => res({ dark: false, blur: false, ok: true });
    im.src = dataUrl;
  });
}

/* ================= 启动 ================= */
(async function boot() {
  await window.Api.init();
  window.Api.loadToken();
  const role = localStorage.getItem("bbstar_role");
  if (window.Api.token && role === "parent") {
    const r = await window.Api.get("/parent/children");
    if (r.status === 200) { state.parentInfo = JSON.parse(localStorage.getItem("bbstar_parent") || "{}"); return renderParentHome(r.data.children); }
  }
  if (window.Api.token && role === "child") {
    const r = await window.Api.get("/child/home");
    if (r.status === 200) return renderChildHome(r.data);
  }
  renderAuth("kid");
})();

function modeBadge() {
  return window.Api.mode === "local" ? '<span class="badge">本地演示模式</span>' : '<span class="badge" style="background:#D9F5EC;color:#2E8B6A">云同步已连接</span>';
}

/* ================= 登录 / 注册 ================= */
function renderAuth(tab) {
  clearTimers();
  state.view = "auth";
  const t = tab || "kid";
  $app.innerHTML =
    '<div class="auth-wrap"><div class="big-logo">⭐</div><div class="big-title">BB星 · 每日作业打卡</div>' +
    '<div class="tabs">' +
    '<div class="tab ' + (t === "kid" ? "active" : "") + '" data-t="kid">孩子登录</div>' +
    '<div class="tab ' + (t === "login" ? "active" : "") + '" data-t="login">家长登录</div>' +
    '</div>' +
    '<div class="card" id="auth-body"></div>' +
    '<div class="muted" style="text-align:center;margin-top:14px">' + modeBadge() + " · 手机/平板/电脑均可使用</div></div>";
  $app.querySelectorAll(".tab").forEach(x => x.onclick = () => renderAuth(x.dataset.t));
  const body = $app.querySelector("#auth-body");

  if (t === "kid") {
    const savedCode = localStorage.getItem("bbstar_saved_family") || "";
    body.innerHTML =
      '<div class="form-item"><label>家庭码（家长端首页可查看）</label><input type="text" id="k-code" inputmode="numeric" maxlength="4" placeholder="4位数字" value="' + esc(savedCode) + '"></div>' +
      '<div id="k-body"><button class="btn" id="k-go" style="width:100%">下一步</button></div>' +
      '<div class="muted" style="margin-top:12px">🔐 孩子使用九宫格手势密码登录；忘记密码请家长在工作台重置</div>';
    body.querySelector("#k-go").onclick = async () => {
      const code = body.querySelector("#k-code").value.trim();
      if (!code) return toast("请输入家庭码");
      const r = await window.Api.get("/family/" + encodeURIComponent(code));
      if (r.status !== 200) return toast(r.data.error || "家庭码不正确");
      localStorage.setItem("bbstar_saved_family", code);
      if (!r.data.children.length) return toast("该家庭还没有孩子账号，请家长先创建");
      const kb = body.querySelector("#k-body");
      kb.innerHTML = '<div class="muted">请选择你是谁 👇</div><div class="kid-list">' +
        r.data.children.map(c => '<div class="kid" data-id="' + c.id + '" data-hint="' + (c.hint == null ? "" : c.hint) + '"><div class="k-emoji">' + esc(c.avatar) + '</div><div class="k-name">' + esc(c.name) + "</div></div>").join("") + "</div>";
      kb.querySelectorAll(".kid").forEach(k => {
        k.onclick = () => {
          const hint = k.dataset.hint;
          kb.innerHTML = '<div class="muted" style="text-align:center">请绘制你的手势密码</div>' + '<div id="pt-holder"></div><div class="muted" style="text-align:center;margin-top:8px"><span id="k-forgot">忘记密码？请家长重置</span></div>';
          const holder = kb.querySelector("#pt-holder");
          const comp = patternComponent(async seq => {
            const rl = await window.Api.post("/child-login", { familyCode: code, childId: k.dataset.id, pattern: seq });
            if (rl.status !== 200) { toast(rl.data.error || "手势密码不正确，再试试"); return; }
            window.Api.setToken(rl.data.token);
            localStorage.setItem("bbstar_role", "child");
            localStorage.setItem("bbstar_saved_family", code);
            state.childInfo = rl.data.child;
            toast("欢迎 " + rl.data.child.name + "！🌟");
            const rh = await window.Api.get("/child/home");
            renderChildHome(rh.data);
          }, { hintDot: hint === "" ? null : Number(hint) });
          holder.appendChild(comp);
          kb.querySelector("#k-forgot").onclick = () => toast("请爸爸妈妈在家长工作台为你重置手势密码哦 😊");
        };
      });
    };
  } else if (t === "login") {
    const savedUser = localStorage.getItem("bbstar_saved_user") || "";
    body.innerHTML =
      '<div class="form-item"><label>用户名</label><input type="text" id="a-user" placeholder="家长用户名" autocomplete="username" value="' + esc(savedUser) + '"></div>' +
      '<div class="form-item"><label>密码</label><input type="password" id="a-pass" placeholder="至少4位" autocomplete="current-password"></div>' +
      '<button class="btn" id="a-go" style="width:100%">登录</button>' +
      '<button class="btn ghost" id="a-reg" style="width:100%;margin-top:10px">还没有账号？注册家长账号</button>';
    body.querySelector("#a-go").onclick = async () => {
      const u = body.querySelector("#a-user").value.trim(), p = body.querySelector("#a-pass").value;
      if (!u || !p) return toast("请填写用户名和密码");
      const r = await window.Api.post("/login", { username: u, password: p });
      if (r.status !== 200) return toast(r.data.error || "操作失败");
      window.Api.setToken(r.data.token);
      localStorage.setItem("bbstar_role", "parent");
      localStorage.setItem("bbstar_saved_user", u);
      localStorage.setItem("bbstar_parent", JSON.stringify(r.data.parent));
      state.parentInfo = r.data.parent;
      toast("欢迎回来 👋");
      const rc = await window.Api.get("/parent/children");
      renderParentHome(rc.data.children || []);
    };
    body.querySelector("#a-reg").onclick = () => renderAuth("reg");
  } else { // t === "reg"：注册作为登录下方的按钮入口
    body.innerHTML =
      '<div class="muted" id="a-back" style="margin-bottom:10px;cursor:pointer">‹ 返回登录</div>' +
      '<div class="form-item"><label>设置用户名</label><input type="text" id="a-user" placeholder="家长用户名" autocomplete="username"></div>' +
      '<div class="form-item"><label>密码</label><input type="password" id="a-pass" placeholder="至少4位" autocomplete="new-password"></div>' +
      '<div class="muted" style="margin-bottom:12px">📌 仅家长可注册主账号，注册后可为孩子创建账号（最多5个）</div>' +
      '<button class="btn" id="a-go" style="width:100%">注册并登录</button>';
    body.querySelector("#a-back").onclick = () => renderAuth("login");
    body.querySelector("#a-go").onclick = async () => {
      const u = body.querySelector("#a-user").value.trim(), p = body.querySelector("#a-pass").value;
      if (!u || !p) return toast("请填写用户名和密码");
      const r = await window.Api.post("/register", { username: u, password: p });
      if (r.status !== 200) return toast(r.data.error || "操作失败");
      window.Api.setToken(r.data.token);
      localStorage.setItem("bbstar_role", "parent");
      localStorage.setItem("bbstar_saved_user", u);
      localStorage.setItem("bbstar_parent", JSON.stringify(r.data.parent));
      state.parentInfo = r.data.parent;
      toast("注册成功！请创建孩子账号 🎉");
      const rc = await window.Api.get("/parent/children");
      renderParentHome(rc.data.children || []);
    };
  }
}

function logout() {
  window.Api.clearToken();
  localStorage.removeItem("bbstar_role");
  renderAuth("login");
}

/* ================= 家长端 ================= */
async function renderParentHome(children) {
  clearTimers();
  state.view = "parentHome";
  const fc = state.parentInfo && state.parentInfo.familyCode ? state.parentInfo.familyCode : "";
  $app.innerHTML =
    '<div class="topbar"><div class="logo">⭐ BB星家长工作台</div><div class="row">' + modeBadge() +
    '<button class="btn small ghost" id="p-set">⚙️ 设置</button>' +
    '<button class="btn small ghost" id="p-out">退出</button></div></div>' +
    '<div class="card" style="margin-bottom:14px"><div class="row spread wrap">' +
    '<div><h3>👨‍👩‍👧 家庭码：<span style="color:var(--blue-d)">' + esc(fc) + '</span></h3><div class="muted">孩子登录时输入此家庭码 + 选择自己 + 手势密码</div></div>' +
    '<button class="btn" id="p-add">＋ 创建孩子账号</button></div></div>' +
    '<div id="p-list">' + (children.length ? "" : '<div class="card"><div style="text-align:center;padding:20px" class="muted">还没有孩子账号，点击上方按钮创建（最多5个）</div></div>') + "</div>";
  $app.querySelector("#p-out").onclick = logout;
  $app.querySelector("#p-set").onclick = openParentSettings;
  $app.querySelector("#p-add").onclick = () => openCreateChild(children);

  const list = $app.querySelector("#p-list");
  children.forEach(c => {
    const card = el('<div class="child-card"><div class="c-emoji">' + esc(c.avatar) + '</div><div style="flex:1"><div class="c-name">' + esc(c.name) + '</div><div class="muted">点击进入详情工作台</div></div><div style="font-size:24px">›</div></div>');
    card.onclick = () => renderParentDetail(c.id, BB.dateKey());
    list.appendChild(card);
  });
  state.parentChildren = children;
}

function openCreateChild(children) {
  if (children.length >= 5) return toast("单个家长最多创建5个孩子账号");
  let avatar = AVATARS[0];
  const m = openModal(
    '<h3>＋ 创建孩子账号</h3>' +
    '<div class="form-item"><label>孩子昵称</label><input type="text" id="nc-name" placeholder="例如：小雨"></div>' +
    '<div class="form-item"><label>选择头像</label><div class="kid-list" id="nc-avatars">' +
    AVATARS.map((a, i) => '<div class="kid" data-a="' + a + '" style="' + (i === 0 ? "border-color:var(--blue)" : "") + '"><div class="k-emoji">' + a + "</div></div>").join("") + "</div></div>" +
    '<div class="muted" style="margin-bottom:10px">创建后请为孩子设置九宫格手势密码</div>' +
    '<div class="modal-btns"><button class="btn ghost" id="nc-cancel">取消</button><button class="btn" id="nc-ok">创建</button></div>'
  );
  m.querySelectorAll("#nc-avatars .kid").forEach(k => {
    k.onclick = () => { avatar = k.dataset.a; m.querySelectorAll("#nc-avatars .kid").forEach(x => x.style.borderColor = ""); k.style.borderColor = "var(--blue)"; };
  });
  m.querySelector("#nc-cancel").onclick = closeModal;
  m.querySelector("#nc-ok").onclick = async () => {
    const name = m.querySelector("#nc-name").value.trim();
    if (!name) return toast("请填写孩子昵称");
    const r = await window.Api.post("/parent/children", { name, avatar });
    if (r.status !== 200) return toast(r.data.error || "创建失败");
    closeModal();
    toast("创建成功！接下来设置手势密码 🔑");
    openResetPattern(r.data.child, async () => {
      const rc = await window.Api.get("/parent/children");
      renderParentHome(rc.data.children);
    });
  };
}

function openResetPattern(child, after) {
  let saved = null;
  const m = openModal('<h3>🔑 设置 ' + esc(child.name) + ' 的手势密码</h3><div id="rp-holder"></div><div class="muted" style="text-align:center" id="rp-state">请绘制图案（至少4个点），设置后请让孩子牢记</div><div class="modal-btns"><button class="btn ghost" id="rp-cancel">取消</button><button class="btn" id="rp-ok" disabled>保存密码</button></div>');
  const holder = m.querySelector("#rp-holder");
  const okBtn = m.querySelector("#rp-ok");
  holder.appendChild(patternComponent(seq => { saved = seq; okBtn.disabled = false; m.querySelector("#rp-state").textContent = "图案已绘制，点击保存"; }, { keep: true }));
  okBtn.onclick = async () => {
    if (!saved) return;
    const r = await window.Api.post("/parent/children/" + child.id + "/reset-pattern", { pattern: saved });
    if (r.status !== 200) return toast(r.data.error || "保存失败");
    closeModal();
    toast("手势密码已设置 ✅");
    if (after) after(); else refreshParentDetail();
  };
  m.querySelector("#rp-cancel").onclick = closeModal;
}

async function openParentSettings() {
  const r = await window.Api.get("/parent/settings");
  if (r.status !== 200) return toast("加载设置失败");
  const s = r.data.settings;
  const m = openModal(
    '<h3>⚙️ 家长设置</h3>' +
    '<div class="form-item"><label>AI对错标记可见范围（保护孩子自信心）</label>' +
    '<select id="s-vis"><option value="both"' + (s.aiMarkVisibility !== "parent" ? " selected" : "") + '>孩子端和家长端都可见</option><option value="parent"' + (s.aiMarkVisibility === "parent" ? " selected" : "") + ">仅家长端可见（孩子端不显示√×）</option></select></div>" +
    '<div class="form-item"><label>评语推送通知</label><div class="row"><input type="checkbox" id="s-notify"' + (s.notifyEnabled ? " checked" : "") + ' style="width:22px;height:22px"><span class="muted">开启后孩子端会收到新评语提醒（60秒内多次编辑只提醒一次）</span></div></div>' +
    '<div class="form-item"><label>孩子端九宫格首点提示</label><div class="row"><input type="checkbox" id="s-hint"' + (s.hintFirstDot ? " checked" : "") + ' style="width:22px;height:22px"><span class="muted">孩子画手势时高亮提示第一个点，减少忘记密码</span></div></div>' +
    '<div class="form-item"><label>单科目最大图片数（1-9张）</label><input type="number" id="s-max" min="1" max="9" value="' + (s.maxImagesPerItem || 5) + '"></div>' +
    '<div class="form-item"><label>图片自动清理（天，0=不清理）</label><input type="number" id="s-clean" min="0" value="' + (s.autoCleanDays != null ? s.autoCleanDays : 90) + '"><div class="muted">超过天数的历史作业图片自动清理释放空间，打卡记录与得分永久保留</div></div>' +
    (window.Api.mode === "server" ?
      '<div class="form-item"><label>AI判题接口（OpenAI兼容，选填）</label><input type="text" id="s-aiurl" placeholder="https://api.xxx.com/v1/chat/completions" value="' + esc(s.aiApiUrl || "") + '">' +
      '<input type="password" id="s-aikey" placeholder="API Key（' + (s.aiApiKey ? "已配置" : "未配置") + '）" style="margin-top:8px">' +
      '<input type="text" id="s-aimodel" placeholder="视觉模型名，如 gpt-4o-mini" value="' + esc(s.aiModel || "") + '" style="margin-top:8px"><div class="muted">不填则使用内置演示识别（模拟√×）</div></div>' : "") +
    '<div class="modal-btns"><button class="btn ghost" id="s-cancel">取消</button><button class="btn" id="s-ok">保存设置</button></div>'
  );
  m.querySelector("#s-cancel").onclick = closeModal;
  m.querySelector("#s-ok").onclick = async () => {
    const data = {
      aiMarkVisibility: m.querySelector("#s-vis").value,
      notifyEnabled: m.querySelector("#s-notify").checked,
      hintFirstDot: m.querySelector("#s-hint").checked,
      maxImagesPerItem: m.querySelector("#s-max").value,
      autoCleanDays: m.querySelector("#s-clean").value
    };
    if (window.Api.mode === "server") {
      data.aiApiUrl = m.querySelector("#s-aiurl").value.trim();
      data.aiModel = m.querySelector("#s-aimodel").value.trim();
      const k = m.querySelector("#s-aikey").value.trim();
      if (k) data.aiApiKey = k;
    }
    const rs = await window.Api.post("/parent/settings", data);
    if (rs.status !== 200) return toast(rs.data.error || "保存失败");
    closeModal();
    toast("设置已保存 ✅");
  };
}

/* ---- 家长端孩子详情 ---- */
async function renderParentDetail(childId, date) {
  clearTimers();
  state.view = "parentDetail";
  state.pDetail = { childId, date };
  const r = await window.Api.get("/parent/child/" + childId + "?date=" + encodeURIComponent(date));
  if (r.status !== 200) return toast(r.data.error || "加载失败");
  const d = r.data;
  state.pDetail.data = d;
  const rec = d.record || { items: {}, comment: null };
  const score = rec.score || 0;
  const canSeeMarks = true; // 家长始终可见

  let itemsHtml = "";
  BB.REQUIRED.concat(BB.OPTIONAL).forEach(k => {
    const def = BB.ITEMS[k];
    const it = rec.items && rec.items[k];
    const done = it && it.done;
    const imgs = done && it.skipped !== true && Array.isArray(it.images) ? it.images : [];
    itemsHtml +=
      '<div class="item-row"><div class="i-left"><span style="font-size:22px">' + def.emoji + "</span><span>" + def.name + (def.type === "optional" ? ' <span class="muted">（选做）</span>' : "") + "</span>" +
      '<span class="st-pill ' + (done ? (it.skipped ? "skip" : "done") : "todo") + '">' + (done ? (it.skipped ? "今日无内容" : "已完成") : "未完成") + "</span></div>" +
      '<div class="row">' +
      (done ? '<button class="btn small warn" data-reset="' + k + '">重置</button>' : "") +
      "</div>" +
      (imgs.length ? '<div class="img-thumbs" style="width:100%">' + imgs.map(img =>
        '<img class="img-thumb" data-img="' + esc(img.id) + '" src="' + esc(imgSrc(img, childId)) + '">').join("") + "</div>" : "") +
      "</div>";
  });

  $app.innerHTML =
    '<button class="back-link" id="d-back">‹ 返回孩子列表</button>' +
    '<div class="card">' +
    '<div class="detail-head"><span style="font-size:38px">' + esc(d.child.avatar) + '</span><div><h3 style="margin:0">' + esc(d.child.name) + " 的工作台</h3>" +
    '<div class="muted">仅查看 · 不可代替孩子上传作业</div></div>' +
    '<div class="date-nav" style="margin-left:auto"><button class="btn small ghost" id="d-prev">‹ 前一天</button>' +
    '<input type="date" id="d-date" value="' + date + '">' +
    '<button class="btn small ghost" id="d-next">后一天 ›</button>' +
    (date === BB.dateKey() ? "" : '<button class="btn small" id="d-today">今天</button>') + "</div></div>" +
    scoreViz(score, "当日得分") +
    '<div class="stats-row">' +
    '<div class="stat-card"><div class="s-num">⭐ ' + d.stats.totalStars + '</div><div class="s-label">累计星星</div></div>' +
    '<div class="stat-card"><div class="s-num">🔥 ' + d.stats.streak + '</div><div class="s-label">连续打卡天数</div></div>' +
    '<div class="stat-card"><div class="s-num">📅 ' + d.stats.activeDays + '</div><div class="s-label">打卡总天数</div></div></div>' +
    '<div class="muted">💡 仅个人纵向成长对比，无排行榜、不与别人比较</div></div>' +

    '<div class="card" style="margin-top:14px"><h3>📋 打卡详情（' + date + "）</h3><div class='items-panel'>" + itemsHtml + "</div>" +
    '<div class="muted" style="margin-top:6px">🤖 AI判题仅供参考、不参与计分；作文/阅读理解等主观题请人工审阅</div></div>' +

    '<div class="card" style="margin-top:14px"><h3>💬 当日整体评语（每天一条）</h3>' +
    (rec.comment ? '<div class="comment-box"><div class="cb-head">🗓 ' + esc(rec.comment.at ? fmtTime(rec.comment.at) : "") + ' 家长评语</div>' + esc(rec.comment.text) + "</div>" : '<div class="muted" style="margin-bottom:8px">今天还没有写评语</div>') +
    '<div class="form-item" style="margin-top:10px"><textarea id="d-comment" rows="3" placeholder="写点鼓励的话吧…（保存即覆盖当日评语）">' + esc(rec.comment ? rec.comment.text : "") + "</textarea></div>" +
    '<button class="btn" id="d-savec">保存评语</button></div>' +

    '<div class="card" style="margin-top:14px"><h3>🛠 账号管理</h3><div class="row wrap">' +
    '<button class="btn ghost" id="d-pattern">重置九宫格密码</button>' +
    '<button class="btn warn" id="d-del">删除孩子账号</button></div></div>' +

    '<div class="card" style="margin-top:14px"><h3>📜 操作日志</h3><div id="d-logs"><div class="muted">加载中…</div></div></div>';

  $app.querySelector("#d-back").onclick = async () => {
    const rc = await window.Api.get("/parent/children");
    renderParentHome(rc.data.children);
  };
  const nav = delta => {
    const nd = BB.dateKey(new Date(date + "T12:00:00+08:00").getTime() + delta * 86400000);
    renderParentDetail(childId, nd);
  };
  $app.querySelector("#d-prev").onclick = () => nav(-1);
  $app.querySelector("#d-next").onclick = () => nav(1);
  $app.querySelector("#d-date").onchange = e => { if (e.target.value) renderParentDetail(childId, e.target.value); };
  const todayBtn = $app.querySelector("#d-today");
  if (todayBtn) todayBtn.onclick = () => renderParentDetail(childId, BB.dateKey());
  $app.querySelector("#d-savec").onclick = async () => {
    const text = $app.querySelector("#d-comment").value.trim();
    if (!text) return toast("评语不能为空");
    const rc = await window.Api.post("/parent/child/" + childId + "/comment", { text, date });
    if (rc.status !== 200) return toast(rc.data.error || "保存失败");
    toast(rc.data.notified ? "评语已保存，孩子将收到提醒 💬" : "评语已保存 ✅");
    renderParentDetail(childId, date);
  };
  $app.querySelectorAll("[data-reset]").forEach(b => {
    b.onclick = () => openResetItem(childId, date, b.dataset.reset, rec.comment);
  });
  $app.querySelectorAll(".img-thumb").forEach(t => {
    t.onclick = () => {
      const imgs = [];
      BB.REQUIRED.concat(BB.OPTIONAL).forEach(k => {
        const it = rec.items && rec.items[k];
        if (it && Array.isArray(it.images)) imgs.push(...it.images);
      });
      const img = imgs.find(x => x.id === t.dataset.img);
      if (img) openViewer(img, childId, canSeeMarks);
    };
  });
  $app.querySelector("#d-pattern").onclick = () => openResetPattern(d.child);
  $app.querySelector("#d-del").onclick = () => {
    const m = openModal("<h3>确认删除</h3><div>删除「" + esc(d.child.name) + "」的账号及其全部打卡记录、图片，<b>不可恢复</b>。确定删除吗？</div><div class='modal-btns'><button class='btn ghost' id='dl-no'>取消</button><button class='btn warn' id='dl-yes'>确认删除</button></div>");
    m.querySelector("#dl-no").onclick = closeModal;
    m.querySelector("#dl-yes").onclick = async () => {
      const rd = await window.Api.del("/parent/children/" + childId);
      if (rd.status !== 200) return toast(rd.data.error || "删除失败");
      closeModal();
      const rc = await window.Api.get("/parent/children");
      renderParentHome(rc.data.children);
    };
  };
  // 日志
  (async () => {
    const rl = await window.Api.get("/parent/child/" + childId + "/logs");
    const box = $app.querySelector("#d-logs");
    if (rl.status !== 200 || !rl.data.logs.length) { box.innerHTML = '<div class="muted">暂无操作记录</div>'; return; }
    box.innerHTML = rl.data.logs.map(l =>
      '<div class="log-item"><span>' + actionIcon(l.action) + "</span><span>" + esc(l.detail || (l.actor === "parent" ? "家长操作" : "孩子操作")) + '</span><span class="log-time">' + fmtTime(l.at) + "</span></div>"
    ).join("");
  })();
}

async function refreshParentDetail() {
  const p = state.pDetail;
  if (p && p.childId) renderParentDetail(p.childId, p.date);
}

function openResetItem(childId, date, item, comment) {
  let keepComment = true;
  const m = openModal(
    "<h3>重置打卡项</h3><div>将「" + esc(BB.ITEMS[item].name) + "」重置回<b>未完成</b>，当日分数将实时重算，星星与能量条同步刷新。</div>" +
    (comment ? '<div class="form-item" style="margin-top:14px"><label>已存在的当日评语如何处理？</label>' +
      '<div class="row"><input type="radio" name="kc" value="1" checked style="width:20px;height:20px"> <span>保留评语</span></div>' +
      '<div class="row" style="margin-top:6px"><input type="radio" name="kc" value="0" style="width:20px;height:20px"> <span>清空评语</span></div></div>'
      : '<div class="muted" style="margin-top:8px">当日暂无评语</div>') +
    "<div class='modal-btns'><button class='btn ghost' id='ri-no'>取消</button><button class='btn warn' id='ri-yes'>确认重置</button></div>"
  );
  m.querySelectorAll("input[name=kc]").forEach(r => r.onchange = () => { keepComment = r.value === "1"; });
  m.querySelector("#ri-no").onclick = closeModal;
  m.querySelector("#ri-yes").onclick = async () => {
    const r = await window.Api.post("/parent/child/" + childId + "/reset-item", { item, date, keepComment });
    if (r.status !== 200) return toast(r.data.error || "重置失败");
    closeModal();
    toast("已重置，分数已重新计算 🔄");
    renderParentDetail(childId, date);
  };
}

/* ================= 孩子端 ================= */
async function renderChildHome(data) {
  clearTimers();
  state.view = "childHome";
  state.homeData = data;
  state.todayKey = data.today;
  state.childInfo = data.child;
  state.settings = data.settings || {};
  const rec = data.todayRecord || { items: {}, comment: null };
  const score = rec.score || 0;
  const canSeeMarks = data.settings && data.settings.aiMarkVisibility !== "parent";
  state.canSeeMarks = canSeeMarks;

  let gridHtml = "";
  BB.REQUIRED.concat(BB.OPTIONAL).forEach(k => {
    const def = BB.ITEMS[k];
    const it = rec.items && rec.items[k];
    const done = it && it.done;
    const imgCount = done && Array.isArray(it.images) ? it.images.length : 0;
    let tag = done ? (it.skipped ? "今日无打卡内容" : "已完成" + (imgCount ? " · " + imgCount + "张图" : "")) : "点击打卡";
    if (done && !it.skipped && def.type === "required") {
      const ai = imgCount && it.images[0].ai ? it.images[0].ai : null;
      if (ai) {
        if (ai.status === "pending") tag += " · AI识别中…";
        else if (ai.status === "failed") tag += " · AI暂无法识别";
        else if (ai.status === "done") tag += " · AI已标记";
      }
    }
    gridHtml +=
      '<button class="punch ' + (done ? "done" : "") + " " + (def.type === "required" ? "req" : "opt") + '" data-item="' + k + '" style="background:' + (done ? "" : def.color) + '">' +
      '<span class="p-check">' + (done ? "✅" : "") + "</span>" +
      '<div class="p-emoji">' + def.emoji + '</div><div class="p-name">' + def.name + "</div>" +
      '<div class="p-tag">' + tag + "</div></button>";
  });

  const yComment = data.yesterday && data.yesterday.comment;
  $app.innerHTML =
    '<div class="topbar"><div class="row"><span style="font-size:26px">' + esc(data.child.avatar) + '</span><div class="logo">BB星</div></div><div class="row">' +
    '<button class="btn small ghost" id="c-his">📚 历史打卡</button>' +
    '<button class="btn small ghost" id="c-out">退出</button></div></div>' +
    '<div class="home-cols"><div>' +
    '<div class="card">' + scoreViz(score, "今日得分") +
    '<div class="stats-row">' +
    '<div class="stat-card"><div class="s-num">⭐ ' + data.stats.totalStars + '</div><div class="s-label">累计星星</div></div>' +
    '<div class="stat-card"><div class="s-num">🔥 ' + data.stats.streak + '</div><div class="s-label">连续天数</div></div></div>' +
    '<div class="muted">💪 只和昨天的自己比，不做排行</div></div>' +
    (data.todayComment ? '<div class="card" style="margin-top:14px"><h3>💬 今日评语</h3><div class="comment-box"><div class="cb-head">家长说</div>' + esc(data.todayComment.text) + "</div></div>" : "") +
    "</div><div>" +
    '<div class="card"><h3>🌙 昨日表现</h3>' +
    (yComment ? '<div class="comment-box"><div class="cb-head">家长评语</div>' + esc(yComment.text) + "</div>" : '<div class="muted" style="margin-bottom:6px">昨天还没有评语</div>') +
    scoreViz(data.yesterday ? data.yesterday.score : 0, "昨日得分") + "</div>" +
    '<div class="card" style="margin-top:14px"><h3>🎯 今日任务</h3><div class="grid6">' + gridHtml + "</div>" +
    '<div class="muted" style="margin-top:10px">必做每项2分 · 选做每项+1分 · 每日满分10分，自然日自动重置</div></div>' +
    "</div></div>";

  $app.querySelector("#c-out").onclick = logout;
  $app.querySelector("#c-his").onclick = renderChildHistory;
  $app.querySelectorAll(".punch").forEach(b => {
    b.onclick = () => {
      const k = b.dataset.item;
      const it = rec.items && rec.items[k];
      if (BB.ITEMS[k].type === "required") {
        openUploadPanel(k, it);
      } else {
        openOptionalAction(k, it);
      }
    };
  });

  // 评语提醒：记录已读 notifyAt
  try {
    const lsKey = "bbstar_notify_" + data.child.id;
    const seen = Number(localStorage.getItem(lsKey) || 0);
    if (data.todayComment && data.todayComment.notifyAt > seen) {
      toast("💬 爸爸妈妈给你写了新评语！");
      localStorage.setItem(lsKey, data.todayComment.notifyAt);
    }
  } catch (e) {}

  // 轮询：新评语提醒 + 自然日重置
  addTimer(setInterval(async () => {
    const r = await window.Api.get("/child/home");
    if (r.status !== 200) return;
    if (r.data.today !== state.todayKey) {
      toast("新的一天开始啦，星星重置 ✨");
      return renderChildHome(r.data);
    }
    const c = r.data.todayComment;
    try {
      const lsKey = "bbstar_notify_" + r.data.child.id;
      const seen = Number(localStorage.getItem(lsKey) || 0);
      if (c && c.notifyAt > seen) {
        toast("💬 爸爸妈妈给你写了新评语！");
        localStorage.setItem(lsKey, c.notifyAt);
        state.homeData = r.data;
        renderChildHome(r.data);
        return;
      }
    } catch (e) {}
    // AI 状态变化刷新标签
    const s = scoreRefreshNeeded(r.data);
    if (s) renderChildHome(r.data);
  }, 12000));
}

function scoreRefreshNeeded(newData) {
  const old = state.homeData;
  if (!old || !old.todayRecord || !newData.todayRecord) return false;
  const oi = old.todayRecord.items || {}, ni = newData.todayRecord.items || {};
  return BB.REQUIRED.some(k => {
    const a = oi[k] && oi[k].images && oi[k].images[0] ? (oi[k].images[0].ai || {}).status : null;
    const b = ni[k] && ni[k].images && ni[k].images[0] ? (ni[k].images[0].ai || {}).status : null;
    return a !== b;
  });
}

/* ---- 选做项弹窗（防误触二次确认） ---- */
function openOptionalAction(item, it) {
  const done = it && it.done;
  const m = openModal(
    "<h3>" + BB.ITEMS[item].emoji + " " + esc(BB.ITEMS[item].name) + "</h3>" +
    (done ? '<div class="muted" style="margin-bottom:10px">今日已完成' + (it.skipped ? "（今日无打卡内容，未计入选做加分）" : "") + "，重新操作将覆盖</div>" : "") +
    '<button class="btn" id="op-img" style="width:100%;margin-bottom:10px">📷 上传图片完成打卡（+1分）</button>' +
    '<button class="btn ghost" id="op-skip" style="width:100%">🗓 今日无打卡内容（不计分）</button>' +
    '<div class="muted" style="margin-top:12px">选做项不强制，选择「今日无打卡内容」也算完成打卡，但不获得加分</div>' +
    "<div class='modal-btns'><button class='btn ghost' id='op-cancel'>取消</button></div>"
  );
  m.querySelector("#op-cancel").onclick = closeModal;
  m.querySelector("#op-img").onclick = () => { closeModal(); openUploadPanel(item, it); };
  m.querySelector("#op-skip").onclick = () => {
    // 二次确认防误触
    const m2 = openModal(
      "<h3>确认跳过吗？</h3><div>「" + esc(BB.ITEMS[item].name) + "」将标记为<b>今日无打卡内容</b>：状态变绿但<b>不获得选做加分</b>。该操作会记录到日志，家长可查看。</div>" +
      "<div class='modal-btns'><button class='btn ghost' id='sk-no'>再想想</button><button class='btn' id='sk-yes'>确认跳过</button></div>"
    );
    m2.querySelector("#sk-no").onclick = () => { closeModal(); };
    m2.querySelector("#sk-yes").onclick = async () => {
      const r = await window.Api.post("/child/skip", { item, confirm: true });
      if (r.status !== 200) return toast(r.data.error || "操作失败");
      closeModal();
      toast("已标记「今日无打卡内容」");
      const rh = await window.Api.get("/child/home");
      renderChildHome(rh.data);
    };
  };
}

/* ---- 上传面板（拍照/相册 · 多图 · 画质检测） ---- */
function openUploadPanel(item, it) {
  const max = (state.settings && state.settings.maxImagesPerItem) || 5;
  const def = BB.ITEMS[item];
  let files = []; // {name, dataUrl, w, h, warn}

  const m = openModal(
    "<h3>" + def.emoji + " " + esc(def.name) + (it && it.done ? "（重新上传将覆盖旧图并重新AI判题）" : "") + "</h3>" +
    (it && it.done && !it.skipped && Array.isArray(it.images) && it.images.length ?
      '<div class="muted" style="margin-bottom:8px">已有 ' + it.images.length + " 张图片，新图提交后覆盖</div>" : "") +
    '<div class="row wrap"><label class="btn small" style="cursor:pointer">📷 拍照<input type="file" accept="image/*" capture="environment" id="up-cam" multiple hidden></label>' +
    '<label class="btn small ghost" style="cursor:pointer">🖼 相册选图<input type="file" accept="image/*" id="up-alb" multiple hidden></label>' +
    '<span class="muted">最多 ' + max + " 张</span></div>" +
    '<div class="quality-warn hidden" id="up-warn"></div>' +
    '<div class="upload-preview" id="up-prev"></div>' +
    '<div class="muted">🤖 提交后AI自动识别对错（仅供参考，不影响得分）</div>' +
    '<div class="modal-btns"><button class="btn ghost" id="up-cancel">取消</button><button class="btn" id="up-ok" disabled>提交打卡</button></div>'
  );
  const prevBox = m.querySelector("#up-prev");
  const okBtn = m.querySelector("#up-ok");
  const warnBox = m.querySelector("#up-warn");

  function refresh() {
    prevBox.innerHTML =
      files.map((f, i) =>
        '<div class="up-item"><img src="' + f.dataUrl + '"><button class="rm" data-i="' + i + '">✕</button></div>').join("") +
      (files.length < max ? '<button class="up-add" id="up-add">＋</button>' : "");
    okBtn.disabled = !files.length;
    const warned = files.filter(f => f.warn);
    warnBox.classList.toggle("hidden", !warned.length);
    if (warned.length) warnBox.innerHTML = "⚠️ 有 " + warned.length + " 张图片可能" + (warned.some(f => f.warn.blur) ? "模糊" : "") + (warned.some(f => f.warn.blur) && warned.some(f => f.warn.dark) ? "或" : "") + (warned.some(f => f.warn.dark) ? "偏暗" : "") + "，AI识别成功率会降低，建议重新拍摄";
    prevBox.querySelectorAll(".rm").forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); refresh(); });
    const add = prevBox.querySelector("#up-add");
    if (add) add.onclick = () => m.querySelector("#up-alb").click();
  }

  async function addFiles(list) {
    const room = max - files.length;
    if (list.length > room) toast("最多上传 " + max + " 张，超出部分未添加");
    for (const f of Array.from(list).slice(0, room)) {
      try {
        const raw = await readFile(f);
        const c = await compress(raw, 1280, 0.82);
        const q = await checkQuality(c.dataUrl);
        files.push({ name: f.name || "作业.jpg", dataUrl: c.dataUrl, w: c.w, h: c.h, warn: q.ok ? null : q });
      } catch (e) { toast("有图片读取失败"); }
    }
    refresh();
  }
  m.querySelector("#up-cam").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
  m.querySelector("#up-alb").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
  m.querySelector("#up-cancel").onclick = closeModal;

  okBtn.onclick = async () => {
    const warned = files.filter(f => f.warn);
    if (warned.length) {
      const mq = openModal(
        "<h3>画质提醒</h3><div>有 " + warned.length + " 张图片可能模糊或偏暗，AI识别可能不准。建议在光线充足处重新拍摄、对准作业纸。</div>" +
        "<div class='modal-btns'><button class='btn ghost' id='q-re'>重新拍摄</button><button class='btn' id='q-go'>仍要使用</button></div>"
      );
      mq.querySelector("#q-re").onclick = () => { closeModal(); };
      mq.querySelector("#q-go").onclick = () => { closeModal(); submit(true); };
      return;
    }
    submit(false);
  };

  async function submit(warned) {
    okBtn.disabled = true;
    okBtn.textContent = "上传中…";
    const r = await window.Api.post("/child/checkin", {
      item,
      images: files.map(f => ({ name: f.name, dataUrl: f.dataUrl, w: f.w, h: f.h })),
      quality: { warned: !!warned }
    });
    if (r.status !== 200) { okBtn.disabled = false; okBtn.textContent = "提交打卡"; return toast(r.data.error || "上传失败"); }
    closeModal();
    toast("打卡完成 🌟 AI识别中…");
    const rh = await window.Api.get("/child/home");
    renderChildHome(rh.data);
    pollAI(item);
  }
  refresh();
}

function pollAI(item) {
  let n = 0;
  const t = setInterval(async () => {
    n++;
    const r = await window.Api.get("/child/item/" + item);
    if (r.status !== 200 || n > 20) { clearInterval(t); return; }
    const ai = r.data && r.data.ai ? Object.values(r.data.ai) : [];
    const allDone = ai.length && ai.every(a => a && a.status !== "pending");
    if (allDone) {
      clearInterval(t);
      if (ai.some(a => a.status === "failed")) toast("AI暂无法识别本次作业，打卡不受影响 🙂");
      else if (ai.some(a => a.status === "done" && !a.hidden)) toast("AI识别完成 ✔✖ 已标注");
      if (state.view === "childHome") {
        const rh = await window.Api.get("/child/home");
        renderChildHome(rh.data);
      }
    }
  }, 2500);
  addTimer(t);
}

/* ---- 历史打卡 ---- */
async function renderChildHistory(date) {
  clearTimers();
  state.view = "childHistory";
  date = date || BB.dateKey();
  const r = await window.Api.get("/child/history?date=" + encodeURIComponent(date));
  if (r.status !== 200) return toast(r.data.error || "加载失败");
  const d = r.data;
  const rec = d.record || { items: {}, comment: null };
  const canSeeMarks = state.canSeeMarks !== false;

  let itemsHtml = "";
  BB.REQUIRED.concat(BB.OPTIONAL).forEach(k => {
    const def = BB.ITEMS[k];
    const it = rec.items && rec.items[k];
    const done = it && it.done;
    const imgs = done && !it.skipped && Array.isArray(it.images) ? it.images : [];
    itemsHtml +=
      '<div class="item-row"><div class="i-left"><span style="font-size:22px">' + def.emoji + "</span><span>" + def.name + "</span>" +
      '<span class="st-pill ' + (done ? (it.skipped ? "skip" : "done") : "todo") + '">' + (done ? (it.skipped ? "无内容" : "已完成") : "未完成") + "</span></div>" +
      (imgs.length ? '<div class="img-thumbs" style="width:100%">' + imgs.map(img =>
        '<img class="img-thumb" data-img="' + esc(img.id) + '" src="' + esc(imgSrc(img, state.childInfo.id)) + '">').join("") + "</div>" : "") +
      "</div>";
  });

  $app.innerHTML =
    '<button class="back-link" id="h-back">‹ 返回首页</button>' +
    '<div class="card"><h3>📚 历史打卡记录</h3>' +
    '<div class="row wrap"><input type="date" id="h-date" value="' + date + '" style="max-width:190px"><span class="muted">或选择日期：</span></div>' +
    '<div class="day-pills">' + (d.days || []).slice(0, 30).map(k =>
      '<span class="day-pill' + (k === date ? " active" : "") + '" data-d="' + k + '">' + k.slice(5) + "</span>").join("") + "</div>" +
    scoreViz(rec.score || 0, "当日得分") + "</div>" +
    '<div class="card" style="margin-top:14px"><h3>📋 ' + date + " 打卡详情</h3><div class='items-panel'>" + itemsHtml + "</div></div>" +
    (rec.comment ? '<div class="card" style="margin-top:14px"><h3>💬 当日家长评语</h3><div class="comment-box"><div class="cb-head">家长评语</div>' + esc(rec.comment.text) + "</div></div>" : "");

  $app.querySelector("#h-back").onclick = async () => {
    const rh = await window.Api.get("/child/home");
    renderChildHome(rh.data);
  };
  $app.querySelector("#h-date").onchange = e => { if (e.target.value) renderChildHistory(e.target.value); };
  $app.querySelectorAll(".day-pill").forEach(p => p.onclick = () => renderChildHistory(p.dataset.d));
  $app.querySelectorAll(".img-thumb").forEach(t => {
    t.onclick = () => {
      const imgs = [];
      BB.REQUIRED.concat(BB.OPTIONAL).forEach(k => {
        const it = rec.items && rec.items[k];
        if (it && Array.isArray(it.images)) imgs.push(...it.images);
      });
      const img = imgs.find(x => x.id === t.dataset.img);
      if (img) openViewer(img, state.childInfo.id, canSeeMarks);
    };
  });
}
})();
