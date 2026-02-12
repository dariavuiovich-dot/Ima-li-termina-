const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PDFParse } = require('pdf-parse');

const pdfPath = 'c:/Users/Daria/Downloads/GOLDNER.pdf';
const outTextPath = 'c:/Users/Daria/Documents/Claude code experience/GOLDNER_ocr_full.txt';
const tempDir = 'c:/Users/Daria/Documents/Claude code experience/temp_pdf/ocr_tmp';
const tessPath = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const tessData = 'c:/Users/Daria/Documents/Claude code experience/tessdata';

const start = parseInt(process.argv[2] || '50', 10);
const end = parseInt(process.argv[3] || '90', 10);

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

(async () => {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });

  const out = fs.createWriteStream(outTextPath, { encoding: 'utf8', flags: 'a' });

  for (let p = start; p <= end; p++) {
    const shot = await parser.getScreenshot({ partial: [p], scale: 2, imageDataUrl: false, imageBuffer: true });
    const imgPath = path.join(tempDir, `p_${String(p).padStart(3, '0')}.png`);
    const baseOut = path.join(tempDir, `p_${String(p).padStart(3, '0')}`);
    fs.writeFileSync(imgPath, shot.pages[0].data);

    const ocr = spawnSync(tessPath, [
      imgPath,
      baseOut,
      '--tessdata-dir', tessData,
      '-l', 'srp_latn+hrv+eng',
      '--psm', '6'
    ], { stdio: 'ignore' });

    let text = '';
    const txtPath = baseOut + '.txt';
    if (ocr.status === 0 && fs.existsSync(txtPath)) {
      text = fs.readFileSync(txtPath, 'utf8');
    }

    out.write(`\n\n===== PAGE ${p} =====\n`);
    out.write(text);

    try { fs.unlinkSync(imgPath); } catch {}
    try { fs.unlinkSync(txtPath); } catch {}

    if (p % 5 === 0 || p === end) {
      console.log(`processed ${p}/${end}`);
    }
  }

  out.end();
  await parser.destroy();
})();
