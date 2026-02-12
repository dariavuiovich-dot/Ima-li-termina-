const fs = require('fs');
const { PDFParse } = require('pdf-parse');

(async () => {
  const dataBuffer = fs.readFileSync('c:/Users/Daria/Downloads/GOLDNER.pdf');
  const parser = new PDFParse({ data: dataBuffer });
  const shot = await parser.getScreenshot({ partial: [50], scale: 2, imageDataUrl: false, imageBuffer: true });
  await parser.destroy();
  const out='c:/Users/Daria/Documents/Claude code experience/temp_pdf/page50.png';
  fs.writeFileSync(out, shot.pages[0].data);
  console.log(out, shot.pages.length, shot.pages[0].width, shot.pages[0].height);
})();
