const { parseBill } = require('./billParser');
const { parseProposal } = require('./proposalParser');
const { parseProduction } = require('./productionParser');
const { scoreProposal } = require('./proposalScorer');
const { geocodeAddress } = require('./geocoder');
const { analyzeRoof } = require('./roofAnalysis');
const { estimateProduction } = require('./solarProduction');
const { extractCurrentRates, getPostSolarRates, calculateTOUImpact } = require('./rateStructure');
const { calculateIncentives } = require('./incentives');
const { analyzeBatteryValue } = require('./batteryAnalysis');
const { calculateSavings, estimateAnnualConsumption, calculateSystemSize } = require('./savingsCalculator');
const { computeActualSavings, computePromisedVsReality } = require('./actualSavings');
const { evaluateGuarantee, draftClaimLetter } = require('./guaranteeClaim');
const { generateReport } = require('../report/generator');
const { generateHaveSolarReport } = require('../report/haveSolarReport');
const { SYSTEM_COST_PER_WATT, ANNUAL_RATE_ESCALATION, XCEL_FLAT_RATE } = require('../constants');
const { defaultVerification, buildVerificationResult } = require('./verification');
const { lookupWhitepages } = require('./whitepages');
const { analyzeEfficiency } = require('./energyAudit');

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Analysis aborted: client disconnected');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Analyze a utility bill → full solar savings report.
 * Original pipeline, now generalized for any utility.
 */
async function analyzeBill(pdfPath, signal, options = {}) {
  console.log('[orchestrator] Starting bill analysis pipeline...');

  // Step 1: Parse the bill
  throwIfAborted(signal);
  console.log('[orchestrator] Step 1: Parsing utility bill...');
  const billData = await parseBill(pdfPath, signal);

  // Step 2: Extract rate structure
  throwIfAborted(signal);
  console.log('[orchestrator] Step 2: Extracting rate structure...');
  const currentRates = extractCurrentRates(billData);
  const postSolarRates = getPostSolarRates(currentRates);

  // Step 2.5: Verify property ownership
  throwIfAborted(signal);
  console.log('[orchestrator] Step 2.5: Verifying property ownership...');
  let verification;
  try {
    const wpData = await lookupWhitepages(
      billData.customer.name,
      billData.customer.city,
      billData.customer.state,
      signal
    );
    verification = buildVerificationResult(billData, wpData);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[orchestrator] Whitepages lookup failed, skipping: ${err.message}`);
    verification = defaultVerification();
    verification.status = 'error';
    verification.note = 'Whitepages lookup failed: ' + err.message;
  }

  // Step 3: Geocode
  throwIfAborted(signal);
  console.log('[orchestrator] Step 3: Geocoding address...');
  const { lat, lon } = await geocodeAddress(
    billData.customer.address,
    billData.customer.city,
    billData.customer.state,
    billData.customer.zip,
    signal
  );

  // Step 4: Roof analysis + NREL reference data (1kW) in parallel
  // We need NREL solar radiation data BEFORE consumption estimation
  // so we can build a location-specific seasonal curve for gap-filling.
  throwIfAborted(signal);
  console.log('[orchestrator] Step 4: Analyzing roof + fetching NREL climate data...');
  const [roofData, nrelReference] = await Promise.all([
    analyzeRoof(lat, lon, signal),
    estimateProduction(lat, lon, 1, signal), // 1kW reference for solrad data
  ]);

  // Step 4.1: Estimate annual consumption using all available bill history
  // + NREL solar radiation as a seasonal curve for any missing months
  throwIfAborted(signal);
  console.log('[orchestrator] Step 4.1: Building 12-month consumption profile...');
  const consumptionData = estimateAnnualConsumption(billData, nrelReference.solradMonthly);

  // Step 4.5: Energy efficiency analysis
  throwIfAborted(signal);
  console.log('[orchestrator] Step 4.5: Analyzing energy efficiency...');
  let efficiencyAnalysis = null;
  try {
    const propertyData = options.propertyData || null;
    efficiencyAnalysis = analyzeEfficiency(billData, consumptionData, { lat, lon }, propertyData);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[orchestrator] Energy audit failed, continuing without it: ${err.message}`);
  }

  // Step 5: System sizing
  throwIfAborted(signal);
  const roughProductionPerKw = lat > 40 ? 1250 : lat > 35 ? 1400 : 1550;
  const { systemKw, panels } = calculateSystemSize(
    consumptionData.annualConsumption,
    roofData,
    roughProductionPerKw
  );

  // Step 6: Solar production (now with correct system size)
  throwIfAborted(signal);
  console.log('[orchestrator] Step 5: Estimating solar production...');
  const productionData = await estimateProduction(lat, lon, systemKw, signal);

  // Step 7: Incentives
  throwIfAborted(signal);
  const grossCost = systemKw * 1000 * SYSTEM_COST_PER_WATT;
  const incentives = calculateIncentives(systemKw, grossCost, productionData.acAnnual);

  // Step 8: Battery
  throwIfAborted(signal);
  const batteryAnalysis = analyzeBatteryValue(currentRates);

  // Step 9: Savings calculation
  throwIfAborted(signal);
  console.log('[orchestrator] Step 6: Calculating savings...');
  const savingsResult = calculateSavings({
    billData,
    systemSizeKw: systemKw,
    panels,
    productionData,
    currentRates,
    postSolarRates,
    incentives,
    batteryAnalysis,
  });

  // Step 9.5: TOU impact analysis
  throwIfAborted(signal);
  console.log('[orchestrator] Step 6.5: Calculating TOU rate impact...');
  const touImpact = calculateTOUImpact(
    consumptionData.annualConsumption,
    productionData.acAnnual,
    currentRates
  );

  // Step 10: Generate report
  throwIfAborted(signal);
  console.log('[orchestrator] Step 7: Generating report...');
  const finalVerification = options.verification || verification;
  const reportHtml = await generateReport({
    billData,
    savingsResult,
    currentRates,
    postSolarRates,
    incentives,
    roofData,
    touImpact,
    efficiencyAnalysis,
    verification: finalVerification,
    mode: 'bill',
  });

  console.log('[orchestrator] Bill analysis complete!');
  return { html: reportHtml, billData, savingsResult, lat, lon, roofData, touImpact, efficiencyAnalysis };
}

/**
 * Analyze a competitor's solar proposal → scored comparison + our counter-offer.
 */
async function analyzeProposal(pdfPath, signal) {
  console.log('[orchestrator] Starting proposal analysis pipeline...');

  // Step 1: Parse the proposal
  throwIfAborted(signal);
  console.log('[orchestrator] Step 1: Parsing solar proposal...');
  const proposalData = await parseProposal(pdfPath, signal);

  // Step 2: Geocode the customer address from the proposal
  throwIfAborted(signal);
  let lat, lon;
  const customer = proposalData.customer || {};
  if (customer.address && customer.city && customer.state) {
    console.log('[orchestrator] Step 2: Geocoding address from proposal...');
    const geo = await geocodeAddress(customer.address, customer.city, customer.state, customer.zip, signal);
    lat = geo.lat;
    lon = geo.lon;
  } else {
    // Default to Denver if no address in proposal
    console.log('[orchestrator] Step 2: No address found, defaulting to Denver, CO...');
    lat = 39.7392;
    lon = -104.9903;
  }

  // Step 3: Analyze the roof using Google Solar API
  throwIfAborted(signal);
  console.log('[orchestrator] Step 3: Analyzing roof with Google Solar API...');
  const roofData = await analyzeRoof(lat, lon, signal);

  // Step 3b: Get solar production estimate for the same system size
  throwIfAborted(signal);
  const systemKw = proposalData.system.sizeKw || 8;
  console.log('[orchestrator] Step 3b: Estimating production for same system size...');
  const productionData = await estimateProduction(lat, lon, systemKw, signal);

  // Step 4: Build rate assumptions
  throwIfAborted(signal);
  // Use Xcel Energy Residential R rate schedule for Colorado comparison
  const currentRates = {
    supplyPerKwh: XCEL_FLAT_RATE.supplyPerKwh,
    deliveryVariablePerKwh: XCEL_FLAT_RATE.deliveryPerKwh,
    deliveryFixedMonthly: XCEL_FLAT_RATE.fixedChargeMonthly,
    taxPerKwh: 0.012,
    totalEffectiveRate: XCEL_FLAT_RATE.totalPerKwh,
    supplyTotal: 0,
    deliveryTotal: 0,
    taxesTotal: 0,
  };

  // Step 5: Score the proposal
  throwIfAborted(signal);
  console.log('[orchestrator] Step 4: Scoring proposal...');
  const score = scoreProposal(proposalData, productionData, currentRates);

  // Step 6: Battery analysis
  throwIfAborted(signal);
  const batteryAnalysis = analyzeBatteryValue(currentRates);

  // Step 7: Generate comparison report
  throwIfAborted(signal);
  console.log('[orchestrator] Step 5: Generating comparison report...');
  const reportHtml = await generateReport({
    proposalData,
    score,
    productionData,
    batteryAnalysis,
    mode: 'proposal',
  });

  console.log('[orchestrator] Proposal analysis complete!');
  return { html: reportHtml, proposalData, score, lat, lon, roofData };
}

/**
 * Analyze both a bill AND proposal together for the most complete comparison.
 */
async function analyzeBoth(billPdfPath, proposalPdfPath, signal) {
  console.log('[orchestrator] Starting combined bill + proposal analysis...');

  // Parse both in parallel
  throwIfAborted(signal);
  const [billData, proposalData] = await Promise.all([
    parseBill(billPdfPath, signal),
    parseProposal(proposalPdfPath, signal),
  ]);

  // Extract rates from the actual bill
  throwIfAborted(signal);
  const currentRates = extractCurrentRates(billData);
  const postSolarRates = getPostSolarRates(currentRates);

  // Geocode from bill address (more reliable)
  throwIfAborted(signal);
  const { lat, lon } = await geocodeAddress(
    billData.customer.address,
    billData.customer.city,
    billData.customer.state,
    billData.customer.zip,
    signal
  );

  // Use the competitor's system size for apples-to-apples comparison
  const systemKw = proposalData.system.sizeKw || 8;

  // Production, roof in parallel (need NREL solrad for consumption estimation)
  throwIfAborted(signal);
  const [productionData, roofData] = await Promise.all([
    estimateProduction(lat, lon, systemKw, signal),
    analyzeRoof(lat, lon, signal),
  ]);

  // Build consumption profile using real bill history + NREL seasonal curve
  const consumptionData = estimateAnnualConsumption(billData, productionData.solradMonthly);

  // Score the proposal with REAL rates from the bill
  throwIfAborted(signal);
  const score = scoreProposal(proposalData, productionData, currentRates);

  // Full savings calculation with our pricing
  throwIfAborted(signal);
  const panels = Math.ceil((systemKw * 1000) / 400);
  const grossCost = systemKw * 1000 * SYSTEM_COST_PER_WATT;
  const incentives = calculateIncentives(systemKw, grossCost, productionData.acAnnual);
  const batteryAnalysis = analyzeBatteryValue(currentRates);

  const savingsResult = calculateSavings({
    billData,
    systemSizeKw: systemKw,
    panels,
    productionData,
    currentRates,
    postSolarRates,
    incentives,
    batteryAnalysis,
  });

  // TOU impact analysis
  throwIfAborted(signal);
  const touImpact = calculateTOUImpact(
    consumptionData.annualConsumption,
    productionData.acAnnual,
    currentRates
  );

  // Energy efficiency analysis
  throwIfAborted(signal);
  let efficiencyAnalysis = null;
  try {
    efficiencyAnalysis = analyzeEfficiency(billData, consumptionData, { lat, lon }, null);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[orchestrator] Energy audit failed in combined mode: ${err.message}`);
  }

  // Generate combined report
  throwIfAborted(signal);
  const reportHtml = await generateReport({
    billData,
    proposalData,
    score,
    savingsResult,
    currentRates,
    postSolarRates,
    productionData,
    batteryAnalysis,
    incentives,
    roofData,
    touImpact,
    efficiencyAnalysis,
    mode: 'combined',
  });

  console.log('[orchestrator] Combined analysis complete!');
  return { html: reportHtml, billData, proposalData, score, savingsResult, lat, lon, roofData, touImpact, efficiencyAnalysis };
}

/**
 * Analyze a homeowner who ALREADY has solar — figure out what they've actually
 * saved, how the system is performing vs expected, compare to the original
 * proposal if provided, and surface a guarantee claim if eligible.
 */
async function analyzeHaveSolar({
  billPdfPath,
  productionFilePath,
  proposalPdfPath,
  formInput,
  signal,
}) {
  console.log('[orchestrator] Starting have-solar analysis...');
  console.log('[orchestrator] Form input:', JSON.stringify(formInput));

  // Step 1: Parse bill + production (+ proposal) in parallel
  throwIfAborted(signal);
  console.log('[orchestrator] Step 1: Parsing uploaded documents...');
  const parsePromises = [
    parseBill(billPdfPath, signal),
    parseProduction(productionFilePath, signal),
  ];
  if (proposalPdfPath) {
    parsePromises.push(parseProposal(proposalPdfPath, signal));
  }
  const parsed = await Promise.all(parsePromises);
  const billData = parsed[0];
  const productionData = parsed[1];
  const proposalData = proposalPdfPath ? parsed[2] : null;

  // Step 2: Current rate structure from the bill
  throwIfAborted(signal);
  console.log('[orchestrator] Step 2: Extracting current rate structure...');
  const currentRates = extractCurrentRates(billData);

  // Step 3: Geocode for PVWatts
  throwIfAborted(signal);
  console.log('[orchestrator] Step 3: Geocoding address...');
  const { lat, lon } = await geocodeAddress(
    billData.customer.address,
    billData.customer.city,
    billData.customer.state,
    billData.customer.zip,
    signal
  );

  // Step 4: Expected production (new-system baseline, pre-derate)
  throwIfAborted(signal);
  console.log('[orchestrator] Step 4: Computing expected production (PVWatts)...');
  // Fall back to bill-history consumption for sizing if user didn't supply system size
  let systemKw = Number(formInput?.systemSizeKw) || null;
  if (!systemKw) {
    systemKw = Number(productionData.systemSizeKw) || null;
  }
  if (!systemKw) {
    // Rough sizing from 12-month imports
    const consumption = estimateAnnualConsumption(billData, null);
    const kwhPerKw = lat > 40 ? 1250 : lat > 35 ? 1400 : 1550;
    systemKw = Math.max(4, Math.min(15, consumption.annualConsumption / kwhPerKw));
    console.log(`[orchestrator] No system size provided — estimating at ${systemKw.toFixed(1)} kW`);
  }
  const expectedProduction = await estimateProduction(lat, lon, systemKw, signal);

  // Step 5: Actual savings
  throwIfAborted(signal);
  console.log('[orchestrator] Step 5: Computing actual savings...');
  const actualSavings = computeActualSavings({
    billData,
    productionData,
    currentRates,
    formInput,
    expectedAnnualKwhUnderated: expectedProduction.acAnnual,
  });

  // Step 6: Promised vs reality (if proposal uploaded)
  const promisedVsReality = computePromisedVsReality({ proposalData, actualSavings });

  // Step 7: Guarantee check + claim letter (if eligible)
  const guaranteeEvaluation = evaluateGuarantee({ proposalData, actualSavings, billData });
  const claimLetter = draftClaimLetter({
    evaluation: guaranteeEvaluation,
    proposalData,
    billData,
    formInput,
  });

  // Step 8: Render report
  throwIfAborted(signal);
  console.log('[orchestrator] Step 6: Rendering have-solar report...');
  const html = generateHaveSolarReport({
    billData,
    productionData,
    proposalData,
    currentRates,
    actualSavings,
    promisedVsReality,
    guaranteeEvaluation,
    claimLetter,
  });

  console.log('[orchestrator] Have-solar analysis complete.');
  return {
    html,
    billData,
    productionData,
    proposalData,
    currentRates,
    actualSavings,
    promisedVsReality,
    guaranteeEvaluation,
    claimLetter,
    lat,
    lon,
    systemKw,
    expectedProduction,
  };
}

module.exports = { analyzeBill, analyzeProposal, analyzeBoth, analyzeHaveSolar };
