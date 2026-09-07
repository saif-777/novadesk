const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const DESK_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.appdata";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function postForm(urlStr, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) { return reject(new Error("token: bad response " + res.statusCode)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || j.error) {
          return reject(new Error("token: " + (j.error_description || j.error || res.statusCode)));
        }
        resolve(j);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* Desktop login: Google blocks OAuth inside Electron's embedded browser,
   so we open the SYSTEM browser and listen on a loopback (127.0.0.1)
   callback. PKCE means no client secret is needed. Works with a
   "Desktop app" OAuth client ID (GOOGLE_DESKTOP_CLIENT_ID in config.js). */
function desktopLogin(clientId) {
  return new Promise((resolve, reject) => {
    if (!clientId) return reject(new Error("NO_DESKTOP_CLIENT"));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let redirectUri = "";
    let settled = false;
    let server = null;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      try { if (server) server.close(); } catch (e) {}
      fn(val);
    };
    server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get("error");
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Sign-in cancelled. You can close this tab.</h2>");
        done(reject, new Error("google: " + err));
        return;
      }
      const code = u.searchParams.get("code");
      if (!code || u.searchParams.get("state") !== state) { res.writeHead(400); res.end("bad request"); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Signed in! Return to NovaDesk 3D.</h2><script>setTimeout(function(){window.close()},1500)</script>");
      postForm(GOOGLE_TOKEN, {
        grant_type: "authorization_code",
        code: code,
        client_id: clientId,
        code_verifier: verifier,
        redirect_uri: redirectUri
      }).then((t) => done(resolve, t), (e) => done(reject, e));
    });
    const kill = setTimeout(() => done(reject, new Error("Login timed out — try again")), 5 * 60 * 1000);
    server.on("error", (e) => done(reject, e));
    server.listen(0, "127.0.0.1", () => {
      redirectUri = "http://127.0.0.1:" + server.address().port + "/callback";
      const auth = GOOGLE_AUTH + "?" + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: DESK_SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "select_account",
        state: state
      }).toString();
      shell.openExternal(auth);
    });
  });
}

function desktopRefresh(clientId, refreshToken) {
  if (!clientId) return Promise.reject(new Error("NO_DESKTOP_CLIENT"));
  if (!refreshToken) return Promise.reject(new Error("NO_REFRESH_TOKEN"));
  return postForm(GOOGLE_TOKEN, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
}

ipcMain.handle("nd-login", (_e, clientId) => desktopLogin(clientId));
ipcMain.handle("nd-refresh", (_e, args) => desktopRefresh(args && args.clientId, args && args.refreshToken));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "NovaDesk 3D",
    backgroundColor: "#0b1020",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
