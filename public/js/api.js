/* BB星 - API 门面：自动检测运行模式（服务端 / 本地演示） */
(function (global) {
"use strict";
var Api = {
  mode: null,          // 'server' | 'local'
  token: null,

  async init() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("/api/ping", { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (j && j.ok) { this.mode = "server"; return this.mode; } }
    } catch (e) { /* 无后端 */ }
    this.mode = "local";
    return this.mode;
  },

  setToken(t) { this.token = t; localStorage.setItem("bbstar_token", t || ""); },
  loadToken() { this.token = localStorage.getItem("bbstar_token") || null; return this.token; },
  clearToken() { this.token = null; localStorage.removeItem("bbstar_token"); },

  async request(method, path, data) {
    if (this.mode === "local") {
      const r = global.LocalEngine.handle(method, "/api" + path, data, this.token);
      if (r.status === 401) this.clearToken();
      return { status: r.status, data: r.body };
    }
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    const r = await fetch("/api" + path, { method: method, headers: headers, body: data ? JSON.stringify(data) : undefined });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401) this.clearToken();
    return { status: r.status, data: j };
  },
  get(p) { return this.request("GET", p); },
  post(p, d) { return this.request("POST", p, d); },
  del(p) { return this.request("DELETE", p); },

  // 图片地址（服务端模式需令牌；本地模式直接 dataUrl）
  imgUrl(childId, imgId) {
    return "/img/" + childId + "/" + imgId + "?t=" + encodeURIComponent(this.token || "");
  }
};
global.Api = Api;
})(typeof window !== "undefined" ? window : globalThis);
