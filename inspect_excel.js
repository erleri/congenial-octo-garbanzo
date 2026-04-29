import * as XLSX from 'xlsx';
import fs from 'fs';

const filePath = 'C:\\Users\\Koo Imjun\\Documents\\a-0. Daily Exchange Rate 현황  (26.04.20).xlsx';

try {
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  
  if (workbook.Sheets['Summary']) {
    console.log('\n--- Summary Sheet Preview (First col) ---');
    const summaryData = XLSX.utils.sheet_to_json(workbook.Sheets['Summary'], { header: 1, defval: null });
    const firstCol = summaryData.slice(0, 30).map(row => row[0]);
    console.log(firstCol);
  }
  
  const currencySheets = ['BRL'];
  for (const cur of currencySheets) {
    if (workbook.Sheets[cur]) {
      console.log(`\n--- ${cur} Sheet Preview (First col) ---`);
      const curData = XLSX.utils.sheet_to_json(workbook.Sheets[cur], { header: 1, defval: null });
      const firstCol = curData.slice(0, 40).map(row => row[0]);
      console.log(firstCol);
    }
  }
} catch (e) {
  console.error('Failed to read excel file:', e);
}
