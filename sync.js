/* BB星 · 一键「自查 → 同步到服务器」工作流
 * 流程：
 *   1) 语法检查所有 JS
 *   2) 本地临时启动 server（隔离 DATA_DIR），跑端到端 selftest
 *   3) 跑本地演示引擎同构测试 test-local
 *   4) 全部通过后，调用 push-to-github.js 推到 GitHub（触发 Render 自动重部署）
 * 用法: node sync.js
 */
"use strict";
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const NODE = process.execPath; // 沿用当前 node，环境一致

function log(t) { console.log(t); }

// 1) 语法检查
function syntaxCheck() {
  const files = [
    "server.js", "public/js/shared.js", "public/js/engine-local.js",
    "public/js/api.js", "public/js/app.js", "selftest.js",
    "test-local.js", "sync.js", "push-to-github.js"
  ];
  for (const f of files) {
    try {
      execFileSync(NODE, ["--check", path.join(ROOT, f)], { stdio: "pipe" });
      log("  ✅ 语法 " + f);
    } catch (e) {
      throw new Error("语法错误 " + f + "：" + e.stderr.toString().slice(0, 200));
    }
  }
}

function get(url) {
  return new Promise((res, rej) => {
    const r = http.get(url, x => { res(x.statusCode); x.resume(); });
    r.on("error", rej);
    r.setTimeout(3000, () => { r.destroy(new Error("timeout")); });
  });
}

async function waitHealthy(base, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await get(base + "/api/ping")) === 200) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  log("\n=== 阶段 1/3 · 语法检查 ===");
  syntaxCheck();

  log("\n=== 阶段 2/3 · 本地端到端自查（隔离测试数据）===");
  const PORT = 3100;
  const BASE = `http://localhost:${PORT}`;
  const dataDir = path.join(ROOT, ".selftest-data");
  fs.rmSync(dataDir, { recursive: true, force: true });
  const srv = spawn(NODE, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATA_DIR: dataDir,
      UPLOADS_DIR: path.join(dataDir, "uploads")
    }),
    stdio: "ignore"
  });

  let healthy = false;
  try {
    healthy = await waitHealthy(BASE, 20000);
    if (!healthy) throw new Error("本地服务启动超时，请检查 server.js");
    log("  ✅ 本地服务已就绪 (" + BASE + ")");

    log("  · 运行后端 selftest …");
    execFileSync(NODE, [path.join(ROOT, "selftest.js")], {
      cwd: ROOT, env: Object.assign({}, process.env, { BASE }), stdio: "inherit"
    });

    log("  · 运行本地引擎 test-local …");
    execFileSync(NODE, [path.join(ROOT, "test-local.js")], { cwd: ROOT, stdio: "inherit" });
  } finally {
    try { srv.kill(); } catch (_) {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }

  log("\n=== 阶段 3/3 · 同步到 GitHub（触发 Render 自动重部署）===");
  execFileSync(NODE, [path.join(ROOT, "push-to-github.js")], { cwd: ROOT, stdio: "inherit" });

  log("\n✅ 同步完成！Render 正在自动重新部署，约 1-2 分钟后访问：");
  log("   https://bbx-j7my.onrender.com");
  log("   建议验证：浏览器打开 → 家长注册 → 创建孩子 → 打卡 → 查看评分/星星/能量条。");
})().catch(e => {
  console.error("\n❌ 同步失败，未推送到服务器（已安全中止）：", e.message);
  process.exit(1);
});
