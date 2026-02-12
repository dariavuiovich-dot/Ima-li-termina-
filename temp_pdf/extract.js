const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const inPath = 'c:/Users/Daria/Downloads/GOLDNER.pdf';
const outPath = 'c:/Users/Daria/Documents/Claude code experience/GOLDNER_extracted.txt';

(async () => {
  const dataBuffer = fs.readFileSync(inPath);
  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  await parser.destroy();
  fs.writeFileSync(outPath, result.text, 'utf8');
  console.log(JSON.stringify({ pages: result.total ?? null, chars: result.text.length, outPath }, null, 2));
})();
