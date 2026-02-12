const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PDFParse } = require('pdf-parse');

const pdfPath = 'c:/Users/Daria/Downloads/GOLDNER.pdf';
const outTextPath = 'c:/Users/Daria/Documents/Claude code experience/GOLDNER_ocr_full.txt';
const tempDir = 'c:/Users/Daria/Documents/Claude code experience/temp_pdf/ocr_tmp';
const tessPath = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const tessData = 'c:/Users/Daria/Documents/Claude code experience/tessdata';

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

(async () => {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const info = await parser.getInfo();
  const total = info.total || 242;

  const out = fs.createWriteStream(outTextPath, { encoding: 'utf8' });
  out.write(`# OCR export for GOLDNER.pdf\n# total_pages=${total}\n\n`);

  for (let p = 1; p <= total; p++) {
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

    out.write(`\n\n===== PAGE ${p} / ${total} =====\n`);
    out.write(text);

    try { fs.unlinkSync(imgPath); } catch {}
    try { fs.unlinkSync(txtPath); } catch {}

    if (p % 10 === 0 || p === total) {
      console.log(`processed ${p}/${total}`);
    }
  }

  out.end();
  await parser.destroy();
  console.log(`DONE -> ${outTextPath}`);
})();
