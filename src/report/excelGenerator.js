const ExcelJS = require('exceljs');
const constants = require('../constants');

// ── Color palette ─────────────────────────────────────────────────────
const COLORS = {
  darkHeader: '0F172A',
  headerText: 'FFFFFF',
  green: '16A34A',
  greenLight: 'DCFCE7',
  red: 'DC2626',
  redLight: 'FEE2E2',
  yellow: 'FEF9C3',
  yellowBorder: 'F59E0B',
  blue: '3B82F6',
  blueLight: 'DBEAFE',
  gray: '64748B',
  grayLight: 'F8FAFC',
  border: 'E2E8F0',
};

// ── Styles ────────────────────────────────────────────────────────────
const headerFont = { bold: true, color: { argb: COLORS.headerText }, size: 11 };
const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.darkHeader } };
const currencyFmt = '$#,##0';
const currencyFmt2 = '$#,##0.00';
const kwhFmt = '#,##0';
const pctFmt = '0.0%';
const pctFmt2 = '0.00%';
const yearsFmt = '0.0';

const thinBorder = {
  top: { style: 'thin', color: { argb: COLORS.border } },
  bottom: { style: 'thin', color: { argb: COLORS.border } },
  left: { style: 'thin', color: { argb: COLORS.border } },
  right: { style: 'thin', color: { argb: COLORS.border } },
};

function applyHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });
  row.height = 24;
}

function applyDataRow(row, altRow = false) {
  row.eachCell((cell) => {
    cell.border = thinBorder;
    cell.alignment = { vertical: 'middle' };
    if (altRow) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grayLight } };
    }
  });
}

function labelValuePair(ws, row, label, value, fmt) {
  const labelCell = ws.getCell(`A${row}`);
  const valueCell = ws.getCell(`B${row}`);
  labelCell.value = label;
  labelCell.font = { bold: true, size: 11 };
  labelCell.border = thinBorder;
  valueCell.value = value;
  valueCell.border = thinBorder;
  if (fmt) valueCell.numFmt = fmt;
  return row + 1;
}

function sectionHeader(ws, row, title, cols = 2) {
  const cell = ws.getCell(`A${row}`);
  cell.value = title;
  cell.font = { bold: true, size: 13, color: { argb: COLORS.darkHeader } };
  ws.mergeCells(`A${row}:${String.fromCharCode(64 + cols)}${row}`);
  return row + 1;
}

// ── Main generator ────────────────────────────────────────────────────
async function generateExcelReport({ mode, savingsResult, proposalData, score, billData }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Solar Savings Analyzer';
  wb.created = new Date();

  // Build sheets in display order (Summary first)
  if (savingsResult) {
    buildSummarySheet(wb, savingsResult, billData, mode);
    buildMonthlySheet(wb, savingsResult);
    buildProjectionSheet(wb, savingsResult);
  }

  // If proposal-only mode (no savingsResult), build a simpler summary
  if (mode === 'proposal' && !savingsResult && score) {
    buildProposalSummarySheet(wb, score, proposalData);
  }

  if ((mode === 'proposal' || mode === 'combined') && score) {
    buildComparisonSheet(wb, score, proposalData);
    buildIssuesSheet(wb, score);
  }

  // Assumptions last (reference sheet)
  buildAssumptionsSheet(wb, savingsResult);

  return wb.xlsx.writeBuffer();
}

// ── Assumptions Sheet ─────────────────────────────────────────────────
function buildAssumptionsSheet(wb, savingsResult) {
  const ws = wb.addWorksheet('Assumptions', { properties: { tabColor: { argb: COLORS.yellowBorder } } });
  ws.columns = [
    { header: 'Assumption', key: 'label', width: 35 },
    { header: 'Value', key: 'value', width: 18 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];

  applyHeaderRow(ws.getRow(1));

  const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.yellow } };

  const assumptions = [
    { label: 'System Cost per Watt', value: constants.SYSTEM_COST_PER_WATT, fmt: currencyFmt2, notes: 'Our installed price — no ITC, no dealer markup' },
    { label: 'Panel Wattage', value: constants.PANEL_WATTAGE, fmt: '#,##0', notes: 'Watts per panel (modern standard)' },
    { label: 'Annual Panel Degradation', value: constants.ANNUAL_DEGRADATION, fmt: pctFmt2, notes: 'Production decreases this much per year' },
    { label: 'Annual Utility Rate Escalation', value: constants.ANNUAL_RATE_ESCALATION, fmt: pctFmt, notes: 'How much utility rates increase per year (Xcel avg)' },
    { label: 'Loan Interest Rate (APR)', value: constants.DEFAULT_LOAN_RATE, fmt: pctFmt, notes: 'Our financing rate — no dealer fee baked in' },
    { label: 'Loan Term (Years)', value: constants.DEFAULT_LOAN_TERM_YEARS, fmt: '#,##0', notes: 'Standard loan term' },
    { label: 'Discount Rate (for NPV)', value: constants.DISCOUNT_RATE, fmt: pctFmt, notes: 'Used to calculate net present value of savings' },
    { label: 'Net Metering Credit Rate', value: constants.NET_METERING_CREDIT_RATE, fmt: pctFmt, notes: '100% = full retail credit for exported energy' },
    { label: 'Analysis Period (Years)', value: constants.ANALYSIS_YEARS, fmt: '#,##0', notes: 'Standard solar warranty / analysis period' },
    { label: 'Battery Cost (13.5 kWh)', value: constants.BATTERY_COST_13KWH, fmt: currencyFmt, notes: 'Installed battery price' },
  ];

  // Add year-1 baseline values if we have savings data
  if (savingsResult) {
    assumptions.push(
      { label: '', value: '', notes: '' }, // spacer
      { label: 'BASELINE VALUES (from your analysis)', value: '', notes: '' },
      { label: 'Year 1 Annual Production (kWh)', value: savingsResult.system?.annualProductionKwh || 0, fmt: kwhFmt, notes: 'From NREL PVWatts estimate for your location' },
      { label: 'Year 1 Pre-Solar Annual Bill', value: savingsResult.year1?.preSolarAnnualBill || 0, fmt: currencyFmt, notes: 'Based on your current utility rates' },
    );
  }

  assumptions.forEach((a, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = a.label;
    row.getCell(1).font = { bold: a.label.includes('BASELINE') ? true : false, size: 11 };
    row.getCell(2).value = a.value;
    if (a.fmt) row.getCell(2).numFmt = a.fmt;
    row.getCell(3).value = a.notes;
    row.getCell(3).font = { italic: true, color: { argb: COLORS.gray }, size: 10 };

    // Yellow highlight on editable value cells
    if (a.value !== '' && !a.label.includes('BASELINE') && a.label !== '') {
      row.getCell(2).fill = yellowFill;
      row.getCell(2).font = { bold: true, size: 11 };
    }

    applyDataRow(row, i % 2 === 0);
  });

  // Add note at top
  ws.insertRow(1, []);
  const noteCell = ws.getCell('A1');
  noteCell.value = 'Change the yellow cells below to see how different assumptions affect your savings.';
  noteCell.font = { bold: true, italic: true, size: 11, color: { argb: COLORS.blue } };
  ws.mergeCells('A1:C1');
  ws.getRow(1).height = 28;

  // Re-apply header to row 2
  applyHeaderRow(ws.getRow(2));

  return ws;
}

// ── Summary Sheet ─────────────────────────────────────────────────────
function buildSummarySheet(wb, savingsResult, billData, mode) {
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: COLORS.green } } });
  ws.columns = [
    { width: 32 },
    { width: 22 },
  ];

  let row = 1;

  // Title
  const titleCell = ws.getCell(`A${row}`);
  titleCell.value = 'Solar Savings Analysis';
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.darkHeader } };
  ws.mergeCells(`A${row}:B${row}`);
  ws.getRow(row).height = 32;
  row += 1;

  // Customer info
  if (billData?.customer) {
    const c = billData.customer;
    ws.getCell(`A${row}`).value = c.name || '';
    ws.getCell(`A${row}`).font = { size: 11, color: { argb: COLORS.gray } };
    row++;
    const addr = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
    ws.getCell(`A${row}`).value = addr;
    ws.getCell(`A${row}`).font = { size: 11, color: { argb: COLORS.gray } };
    row++;
  }
  row++;

  // System Details
  row = sectionHeader(ws, row, 'System Details');
  const sys = savingsResult.system || {};
  row = labelValuePair(ws, row, 'System Size (kW)', sys.sizeKw || 0, '#,##0.0');
  row = labelValuePair(ws, row, 'Number of Panels', sys.panels || 0, '#,##0');
  row = labelValuePair(ws, row, 'Annual Production (kWh)', sys.annualProductionKwh || 0, kwhFmt);
  row = labelValuePair(ws, row, 'Offset Percentage', (sys.offsetPercentage || 0) / 100, pctFmt);
  row++;

  // Costs
  row = sectionHeader(ws, row, 'System Cost');
  const costs = savingsResult.costs || {};
  row = labelValuePair(ws, row, 'Gross Cost', costs.grossCost || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Federal ITC', costs.federalITC || 0, currencyFmt);
  row = labelValuePair(ws, row, 'State Incentives', costs.stateIncentives || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Net Cost', costs.netCost || 0, currencyFmt);
  // Bold the net cost
  ws.getCell(`B${row - 1}`).font = { bold: true, size: 12, color: { argb: COLORS.green } };
  row++;

  // Year 1 Savings
  row = sectionHeader(ws, row, 'Year 1 Savings');
  const y1 = savingsResult.year1 || {};
  row = labelValuePair(ws, row, 'Current Annual Electric Bill', y1.preSolarAnnualBill || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Post-Solar Annual Bill', y1.postSolarAnnualBill || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Annual Savings', y1.annualSavings || 0, currencyFmt);
  ws.getCell(`B${row - 1}`).font = { bold: true, size: 12, color: { argb: COLORS.green } };
  row = labelValuePair(ws, row, 'Average Monthly Savings', y1.avgMonthlySavings || 0, currencyFmt);
  row++;

  // Payback & Long-term
  row = sectionHeader(ws, row, 'Payback & Long-Term Value');
  const pb = savingsResult.payback || {};
  const lt = savingsResult.twentyFiveYear || {};
  row = labelValuePair(ws, row, 'Simple Payback (Years)', pb.simpleYears || 0, yearsFmt);
  row = labelValuePair(ws, row, 'Actual Payback (Years)', pb.actualYears || 0, yearsFmt);
  row = labelValuePair(ws, row, '25-Year Total Savings', lt.totalSavings || 0, currencyFmt);
  ws.getCell(`B${row - 1}`).font = { bold: true, size: 12, color: { argb: COLORS.green } };
  row = labelValuePair(ws, row, '25-Year NPV (at 4% discount)', lt.npv || 0, currencyFmt);
  row = labelValuePair(ws, row, '25-Year ROI', (lt.roi || 0) / 100, pctFmt);
  row++;

  // Battery
  if (savingsResult.battery) {
    const bat = savingsResult.battery;
    row = sectionHeader(ws, row, 'Battery Analysis');
    row = labelValuePair(ws, row, 'Battery Size', bat.batterySize || '13.5 kWh');
    row = labelValuePair(ws, row, 'Estimated Cost', bat.estimatedCost || 0, currencyFmt);
    row = labelValuePair(ws, row, 'Total Annual Value', bat.totalAnnualValue || 0, currencyFmt);
    row = labelValuePair(ws, row, 'Battery Payback (Years)', bat.simplePaybackYears || 0, yearsFmt);
    row = labelValuePair(ws, row, 'Recommendation', bat.recommendation || 'N/A');
  }

}

// ── Monthly Breakdown Sheet ───────────────────────────────────────────
function buildMonthlySheet(wb, savingsResult) {
  const ws = wb.addWorksheet('Monthly Breakdown', { properties: { tabColor: { argb: COLORS.blue } } });

  const headers = ['Month', 'Consumption (kWh)', 'Solar Gen (kWh)', 'Net Grid (kWh)', 'Bill Before', 'Bill After', 'Monthly Savings'];
  ws.columns = [
    { width: 14 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
  ];

  // Header row
  const headerRow = ws.getRow(1);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  applyHeaderRow(headerRow);

  // Data rows
  const breakdown = savingsResult.monthlyBreakdown || [];
  breakdown.forEach((m, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = m.month || '';
    row.getCell(2).value = m.consumptionKwh || 0;
    row.getCell(2).numFmt = kwhFmt;
    row.getCell(3).value = m.solarGenKwh || 0;
    row.getCell(3).numFmt = kwhFmt;
    row.getCell(4).value = m.netGridKwh || 0;
    row.getCell(4).numFmt = kwhFmt;
    row.getCell(5).value = m.billBefore || 0;
    row.getCell(5).numFmt = currencyFmt;
    row.getCell(6).value = m.billAfter || 0;
    row.getCell(6).numFmt = currencyFmt;
    row.getCell(7).value = m.savings || 0;
    row.getCell(7).numFmt = currencyFmt;
    row.getCell(7).font = { color: { argb: COLORS.green } };
    applyDataRow(row, i % 2 === 0);
  });

  // Totals row
  const totalsRowNum = breakdown.length + 2;
  const totalsRow = ws.getRow(totalsRowNum);
  totalsRow.getCell(1).value = 'TOTAL';
  totalsRow.getCell(1).font = { bold: true };
  for (let col = 2; col <= 7; col++) {
    const colLetter = String.fromCharCode(64 + col);
    totalsRow.getCell(col).value = { formula: `SUM(${colLetter}2:${colLetter}${totalsRowNum - 1})` };
    totalsRow.getCell(col).numFmt = col >= 5 ? currencyFmt : kwhFmt;
    totalsRow.getCell(col).font = { bold: true };
  }
  totalsRow.getCell(7).font = { bold: true, color: { argb: COLORS.green }, size: 12 };
  applyDataRow(totalsRow);

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 25-Year Projection Sheet ──────────────────────────────────────────
function buildProjectionSheet(wb, savingsResult) {
  const ws = wb.addWorksheet('25-Year Projection', { properties: { tabColor: { argb: COLORS.green } } });

  const headers = ['Year', 'Production (kWh)', 'Pre-Solar Bill', 'Post-Solar Bill', 'Annual Savings', 'Cumulative Savings'];
  ws.columns = [
    { width: 8 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
  ];

  const headerRow = ws.getRow(1);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  applyHeaderRow(headerRow);

  // We'll use formulas that reference the Assumptions sheet
  // Assumptions sheet layout (after the inserted note row):
  // Row 3: System Cost per Watt (B3)
  // Row 4: Panel Wattage (B4)
  // Row 5: Annual Degradation (B5)
  // Row 6: Annual Rate Escalation (B6)
  // Row 7: Loan Rate (B7)
  // Row 8: Loan Term (B8)
  // Row 9: Discount Rate (B9)
  // Row 10: Net Metering Credit Rate (B10)
  // Row 11: Analysis Period (B11)
  // Row 12: Battery Cost (B12)
  // Row 13: spacer
  // Row 14: BASELINE header
  // Row 15: Year 1 Production (B15)
  // Row 16: Year 1 Pre-Solar Bill (B16)

  const projection = savingsResult.yearlyProjection || [];
  const hasAssumptionsBaseline = savingsResult.system?.annualProductionKwh && savingsResult.year1?.preSolarAnnualBill;

  projection.forEach((yr, i) => {
    const rowNum = i + 2;
    const row = ws.getRow(rowNum);

    row.getCell(1).value = yr.year;

    if (hasAssumptionsBaseline) {
      // Production: Year1Production * (1 - degradation)^(year-1)
      row.getCell(2).value = { formula: `Assumptions!B15*(1-Assumptions!B5)^(A${rowNum}-1)` };
      // Pre-solar bill: Year1Bill * (1 + escalation)^(year-1)
      row.getCell(3).value = { formula: `Assumptions!B16*(1+Assumptions!B6)^(A${rowNum}-1)` };
    } else {
      row.getCell(2).value = yr.production || 0;
      row.getCell(3).value = yr.preSolarBill || 0;
    }

    row.getCell(2).numFmt = kwhFmt;
    row.getCell(3).numFmt = currencyFmt;

    // Post-solar bill (use actual values — hard to formula-ize net metering)
    row.getCell(4).value = yr.postSolarBill || 0;
    row.getCell(4).numFmt = currencyFmt;

    // Annual savings = pre - post
    row.getCell(5).value = { formula: `C${rowNum}-D${rowNum}` };
    row.getCell(5).numFmt = currencyFmt;
    row.getCell(5).font = { color: { argb: COLORS.green } };

    // Cumulative
    if (i === 0) {
      row.getCell(6).value = { formula: `E${rowNum}` };
    } else {
      row.getCell(6).value = { formula: `F${rowNum - 1}+E${rowNum}` };
    }
    row.getCell(6).numFmt = currencyFmt;
    row.getCell(6).font = { bold: true };

    applyDataRow(row, i % 2 === 0);

    // Highlight the payback year
    const paybackYear = savingsResult.payback?.actualYears ? Math.ceil(savingsResult.payback.actualYears) : null;
    if (paybackYear && yr.year === paybackYear) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenLight } };
        cell.font = { ...cell.font, bold: true };
      });
      // Add note
      row.getCell(6).note = 'Payback year! Your system has paid for itself.';
    }
  });

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── Proposal Comparison Sheet ─────────────────────────────────────────
function buildComparisonSheet(wb, score, proposalData) {
  const ws = wb.addWorksheet('Proposal Comparison', { properties: { tabColor: { argb: COLORS.red } } });
  ws.columns = [
    { width: 24 },
    { width: 20 },
    { width: 20 },
    { width: 18 },
  ];

  const compName = score.competitor?.name || 'Competitor';

  const headerRow = ws.getRow(1);
  ['Metric', compName, 'Our Offer', 'You Save'].forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderRow(headerRow);

  const comp = score.comparison || {};
  const rows = [
    { label: 'System Size (kW)', theirs: comp.systemSize?.theirs, ours: comp.systemSize?.ours, fmt: '#,##0.0' },
    { label: 'Total Price', theirs: comp.totalPrice?.theirs, ours: comp.totalPrice?.ours, save: comp.totalPrice?.savings, fmt: currencyFmt },
    { label: 'Price per Watt', theirs: comp.pricePerWatt?.theirs, ours: comp.pricePerWatt?.ours, fmt: currencyFmt2 },
    { label: 'Monthly Payment', theirs: comp.monthlyPayment?.theirs, ours: comp.monthlyPayment?.ours, fmt: currencyFmt },
    { label: 'Annual Production (kWh)', theirs: comp.annualProduction?.theirs, ours: comp.annualProduction?.ours, fmt: kwhFmt },
  ];

  if (comp.escalator?.theirs) {
    rows.push({ label: 'Annual Escalator', theirs: comp.escalator.theirs / 100, ours: 0, fmt: pctFmt });
  }
  if (comp.dealerFee?.theirs) {
    rows.push({ label: 'Dealer Fee', theirs: comp.dealerFee.theirs, ours: 0, fmt: currencyFmt });
  }

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const row = ws.getRow(rowNum);
    row.getCell(1).value = r.label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = r.theirs || 0;
    row.getCell(2).numFmt = r.fmt;
    row.getCell(3).value = r.ours || 0;
    row.getCell(3).numFmt = r.fmt;

    if (r.save != null) {
      row.getCell(4).value = r.save;
      row.getCell(4).numFmt = r.fmt;
      row.getCell(4).font = { bold: true, color: { argb: r.save > 0 ? COLORS.green : COLORS.red } };
    } else if (r.label === 'Total Price') {
      row.getCell(4).value = { formula: `B${rowNum}-C${rowNum}` };
      row.getCell(4).numFmt = r.fmt;
      row.getCell(4).font = { bold: true, color: { argb: COLORS.green } };
    }

    applyDataRow(row, i % 2 === 0);

    // Color theirs red if worse, ours green if better
    if (r.label.includes('Price') || r.label.includes('Payment') || r.label.includes('Fee') || r.label.includes('Escalator')) {
      if ((r.theirs || 0) > (r.ours || 0)) {
        row.getCell(2).font = { color: { argb: COLORS.red } };
        row.getCell(3).font = { color: { argb: COLORS.green } };
      }
    }
  });

  // Verdict banner
  const verdictRow = rows.length + 3;
  const verdictCell = ws.getCell(`A${verdictRow}`);
  const verdictLabels = {
    'bad-deal': 'BAD DEAL',
    'below-average': 'BELOW AVERAGE',
    'average': 'AVERAGE DEAL',
    'fair': 'FAIR DEAL',
  };
  verdictCell.value = `Overall Verdict: ${verdictLabels[score.overallVerdict] || score.overallVerdict}`;
  verdictCell.font = { bold: true, size: 14, color: { argb: score.overallVerdict === 'fair' ? COLORS.green : COLORS.red } };
  ws.mergeCells(`A${verdictRow}:D${verdictRow}`);
}

// ── Issues Sheet ──────────────────────────────────────────────────────
function buildIssuesSheet(wb, score) {
  const issues = score.issues || [];
  if (issues.length === 0) return;

  const ws = wb.addWorksheet('Issues Found', { properties: { tabColor: { argb: COLORS.red } } });
  ws.columns = [
    { width: 12 },
    { width: 20 },
    { width: 60 },
  ];

  const headerRow = ws.getRow(1);
  ['Severity', 'Category', 'Issue'].forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderRow(headerRow);

  const severityColors = {
    high: COLORS.redLight,
    medium: COLORS.yellow,
    low: COLORS.blueLight,
  };

  issues.forEach((issue, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = (issue.severity || 'medium').toUpperCase();
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = issue.category || '';
    row.getCell(3).value = issue.message || '';
    row.getCell(3).alignment = { wrapText: true };

    const bgColor = severityColors[issue.severity] || severityColors.medium;
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.border = thinBorder;
    });
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── Proposal-Only Summary (when no bill data) ────────────────────────
function buildProposalSummarySheet(wb, score, proposalData) {
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: COLORS.green } } });
  ws.columns = [{ width: 32 }, { width: 22 }];

  let row = 1;

  const titleCell = ws.getCell(`A${row}`);
  titleCell.value = 'Proposal Analysis Summary';
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.darkHeader } };
  ws.mergeCells(`A${row}:B${row}`);
  row += 2;

  if (proposalData?.customer?.name) {
    row = labelValuePair(ws, row, 'Customer', proposalData.customer.name);
  }
  if (proposalData?.installer?.name) {
    row = labelValuePair(ws, row, 'Installer', proposalData.installer.name);
  }
  row++;

  row = sectionHeader(ws, row, 'Their System');
  const sys = proposalData?.system || {};
  row = labelValuePair(ws, row, 'System Size (kW)', sys.sizeKw || 0, '#,##0.0');
  row = labelValuePair(ws, row, 'Panels', `${sys.panelCount || 0}x ${sys.panelType || 'Unknown'}`);
  row = labelValuePair(ws, row, 'Inverter', sys.inverterType || 'Unknown');
  row++;

  row = sectionHeader(ws, row, 'Their Pricing');
  const pricing = proposalData?.pricing || {};
  row = labelValuePair(ws, row, 'Total Price', pricing.totalPrice || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Price per Watt', pricing.pricePerWatt || 0, currencyFmt2);
  if (pricing.dealerFee) row = labelValuePair(ws, row, 'Hidden Dealer Fee', pricing.dealerFee, currencyFmt);
  row++;

  row = sectionHeader(ws, row, 'Our Counter-Offer');
  const cp = score.counterProposal || {};
  row = labelValuePair(ws, row, 'Our System Size (kW)', cp.systemSizeKw || 0, '#,##0.0');
  row = labelValuePair(ws, row, 'Our Total Price', cp.totalPrice || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Our Monthly Payment', cp.monthlyPayment || 0, currencyFmt);
  row = labelValuePair(ws, row, 'Payback (Years)', cp.paybackYears || 0, yearsFmt);

  wb.moveWorksheet('Summary', 0);
}

module.exports = { generateExcelReport };
