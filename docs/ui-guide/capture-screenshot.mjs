#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function captureScreenshot() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1440, height: 900 }
  });

  const page = await browser.newPage();

  console.log('Navigating to MKG Claims Detector...');
  await page.goto('http://localhost:5174/mkg', { waitUntil: 'networkidle0' });

  // Wait for page to fully load
  await new Promise(r => setTimeout(r, 1000));

  // Upload a PDF file
  const pdfPath = join(__dirname, '../../MKG Knowledge Base/Test Doc/SanaTest.pdf');
  console.log(`Uploading PDF: ${pdfPath}`);

  // Find the file input and upload
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.uploadFile(pdfPath);
    console.log('PDF uploaded, waiting for render...');
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log('File input not found');
  }

  // Take screenshot
  const screenshotPath = join(__dirname, 'screenshot.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  await browser.close();
}

captureScreenshot().catch(console.error);
