const express = require('express');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const os = require('os'); // Added to find the safe system temporary directory

const app = express();
// Hugging Face strictly routes all traffic through internal port 7860
const PORT = process.env.PORT || 7860;

app.use(express.json());
app.use(express.static('public'));

app.post('/api/screenshot', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const timestamp = Date.now();
  // Find the system temp directory where the 'node' user account has absolute write permissions
  const tmpDir = os.tmpdir();
  
  const files = {
    hero: path.join(tmpDir, `desktop-hero-${timestamp}.webp`),
    full: path.join(tmpDir, `desktop-fullpage-${timestamp}.webp`),
    mobile: path.join(tmpDir, `mobile-hero-${timestamp}.webp`),
    zip: path.join(tmpDir, `portfolio-assets-${timestamp}.zip`)
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // 1. Desktop Hero Capture (1920x1080 @ 2x Retina Resolution)
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 2000)); // wait for animations
    await page.screenshot({ path: files.hero, type: 'webp', quality: 100 });

    // 2. Desktop Full Page Capture
    await page.screenshot({ path: files.full, type: 'webp', quality: 100, fullPage: true });

    // 3. Mobile Hero Capture (390x844 @ 2x Resolution)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.screenshot({ path: files.mobile, type: 'webp', quality: 100 });

    await browser.close();

    // Create ZIP package inside the writable temporary directory
    const output = fs.createWriteStream(files.zip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      res.download(files.zip, 'portfolio-assets.zip', (err) => {
        // Clean up all cached files from the system temp directory
        try {
          if (fs.existsSync(files.hero)) fs.unlinkSync(files.hero);
          if (fs.existsSync(files.full)) fs.unlinkSync(files.full);
          if (fs.existsSync(files.mobile)) fs.unlinkSync(files.mobile);
          if (fs.existsSync(files.zip)) fs.unlinkSync(files.zip);
        } catch (cleanupErr) {
          console.error('Cleanup error:', cleanupErr);
        }
      });
    });

    archive.on('error', (err) => { throw err; });
    archive.pipe(output);
    archive.file(files.hero, { name: 'desktop-hero.webp' });
    archive.file(files.full, { name: 'desktop-fullpage.webp' });
    archive.file(files.mobile, { name: 'mobile-hero.webp' });
    await archive.finalize();

  } catch (error) {
    console.error(error);
    if (browser) await browser.close();
    res.status(500).json({ error: 'Screenshot generation failed.' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
