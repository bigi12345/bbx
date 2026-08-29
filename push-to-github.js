/* 通过 GitHub REST API 把本地源码同步到 bigi12345/bbx（main 分支）
 * 幂等 upsert：每个文件先 GET sha 再 PUT，可重复运行。
 * Token 来源：环境变量 GITHUB_TOKEN 优先；其次读本地 .deploy-token（不入库）。
 * 用法: node push-to-github.js   （或 GITHUB_TOKEN=xxx node push-to-github.js）
 * 注意：只推源码；data/、uploads/、.deploy-token、.selftest-data/ 不推。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;

const OWNER = "bigi12345";
const REPO = "bbx";
const BRANCH = "main";

// ---- Token 解析 ----
let TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  const f = path.join(ROOT, ".deploy-token");
  if (fs.existsSync(f)) TOKEN = fs.readFileSync(f, "utf8").trim();
}
if (!TOKEN) {
  console.error("❌ 缺少 GitHub Token：请设置环境变量 GITHUB_TOKEN，或在 .deploy-token 写入（参考 .deploy-token.example）");
  process.exit(1);
}

// ---- 要同步的源码清单（相对仓库根）----
const FILES = [
  ".gitignore",
  "package.json",
  "render.yaml",
  "server.js",
  "README.md",
  "public/index.html",
  "public/css/style.css",
  "public/js/shared.js",
  "public/js/engine-local.js",
  "public/js/api.js",
  "public/js/app.js",
  "selftest.js",
  "test-local.js",
  "push-to-github.js",
  "sync.js"
];

const api = (method, p, body) => fetch("https://api.github.com" + p, {
  method,
  headers: {
    "Authorization": "Bearer " + TOKEN,
    "Accept": "application/vnd.github+json",
    "User-Agent": "bbstar-push",
    "Content-Type": "application/json"
  },
  body: body ? JSON.stringify(body) : undefined
});

function b64(content) { return Buffer.from(content, "utf8").toString("base64"); }

async function getSha(rel) {
  try {
    const r = await api("GET", `/repos/${OWNER}/${REPO}/contents/${rel}?ref=${BRANCH}`);
    if (r.ok) return (await r.json()).sha;
  } catch (_) {}
  return null;
}

async function putFile(rel, content) {
  const sha = await getSha(rel);
  const body = {
    message: `chore: sync ${rel} @ ${new Date().toISOString().slice(0, 19)}`,
    content: b64(content),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const r = await api("PUT", `/repos/${OWNER}/${REPO}/contents/${rel}`, body);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${rel} 失败 ${r.status}: ${t.slice(0, 400)}`);
  }
  console.log(`  ✅ ${rel}` + (sha ? " (更新)" : " (新建)"));
}

(async () => {
  console.log(`📤 同步源码到 github.com/${OWNER}/${REPO} (${BRANCH}) …`);
  let n = 0;
  for (const f of FILES) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) { console.log(`  ⏭️ 跳过不存在: ${f}`); continue; }
    await putFile(f, fs.readFileSync(abs, "utf8"));
    n++;
  }
  console.log(`\n🎉 已同步 ${n} 个文件。Render 将基于仓库自动重新部署（约 1-2 分钟）。`);
})().catch(e => { console.error("\n❌ 推送中断:", e.message); process.exit(1); });
