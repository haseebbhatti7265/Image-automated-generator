const express = require("express");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

// Resolve the Chrome executable path robustly across local + cloud (Railway/Render).
// Puppeteer's postinstall downloads Chrome to its cache; puppeteer.executablePath()
// points there. On cloud hosts that path is sometimes missing or the binary lives
// under PUPPETEER_EXECUTABLE_PATH, so we fall back to env, then to common system
// Chrome locations.
function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/opt/render/.cache/puppeteer/chrome/*/chrome-linux64/chrome",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Glob fallback for wildcarded candidate
  try {
    const glob = "/opt/render/.cache/puppeteer/chrome";
    if (fs.existsSync(glob)) {
      const versions = fs.readdirSync(glob);
      for (const v of versions) {
        const candidate = path.join(glob, v, "chrome-linux64", "chrome");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(input) {
  if (!/^https?:\/\//i.test(input)) return "https://" + input;
  return input;
}

async function capture(url) {
  const jobId = crypto.randomBytes(6).toString("hex");
  const workDir = path.join(__dirname, "tmp", jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const executablePath = resolveExecutablePath();
  const launchOptions = {
    headless: "new",
    args: LAUNCH_ARGS,
  };
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await puppeteer.launch(launchOptions);

  try {
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 2,
    });
    await desktopPage.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await sleep(2000);

    const desktopHero = path.join(workDir, "desktop-hero.webp");
    await desktopPage.screenshot({
      path: desktopHero,
      type: "webp",
      quality: 100,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1920, height: 1080 },
    });

    const desktopFull = path.join(workDir, "desktop-fullpage.webp");
    await desktopPage.screenshot({
      path: desktopFull,
      type: "webp",
      quality: 100,
      fullPage: true,
    });
    await desktopPage.close();

    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await mobilePage.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
    await mobilePage.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await sleep(2000);

    const mobileHero = path.join(workDir, "mobile-hero.webp");
    await mobilePage.screenshot({
      path: mobileHero,
      type: "webp",
      quality: 100,
      fullPage: false,
      clip: { x: 0, y: 0, width: 390, height: 844 },
    });
    await mobilePage.close();

    return { workDir, files: [desktopHero, desktopFull, mobileHero] };
  } finally {
    await browser.close();
  }
}

function cleanup(workDir) {
  fs.rm(workDir, { recursive: true, force: true }, () => {});
}

app.post("/api/generate", async (req, res) => {
  const raw = (req.body && req.body.url) || "";
  if (!raw || typeof raw !== "string") {
    return res.status(400).json({ error: "URL is required." });
  }

  let target;
  try {
    target = new URL(normalizeUrl(raw.trim())).toString();
  } catch {
    return res.status(400).json({ error: "Invalid URL." });
  }

  let workDir;
  try {
    const result = await capture(target);
    workDir = result.workDir;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="portfolio-assets.zip"'
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      try { res.status(500).end(); } catch {}
    });

    res.on("close", () => cleanup(workDir));
    res.on("finish", () => cleanup(workDir));

    archive.pipe(res);
    for (const file of result.files) {
      archive.file(file, { name: path.basename(file) });
    }
    await archive.finalize();
  } catch (err) {
    console.error("Capture failed:", err);
    if (workDir) cleanup(workDir);
    if (!res.headersSent) {
      res.status(500).json({ error: "Screenshot generation failed.", detail: String(err.message || err) });
    } else {
      try { res.end(); } catch {}
    }
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`ASSET_BOT running on :${PORT}`);
});
