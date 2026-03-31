const VERIFICATION_STATUS = {
  VERIFIED: 'verified',
  PARTIAL_MATCH: 'partial',
  NOT_FOUND: 'not_found',
  NOT_PERFORMED: 'skipped',
  ERROR: 'error',
};

const ABBREVIATIONS = {
  street: 'st', avenue: 'ave', drive: 'dr', boulevard: 'blvd',
  road: 'rd', lane: 'ln', court: 'ct', place: 'pl',
  circle: 'cir', north: 'n', south: 's', east: 'e', west: 'w',
  northwest: 'nw', northeast: 'ne', southwest: 'sw', southeast: 'se',
};

function normalizeAddress(addr) {
  if (!addr) return '';
  let normalized = addr.toLowerCase().trim();
  normalized = normalized.replace(/\./g, '');
  normalized = normalized.replace(/\b(apt|unit|suite|ste|#)\s*\S+/gi, '');
  for (const [full, abbr] of Object.entries(ABBREVIATIONS)) {
    normalized = normalized.replace(new RegExp(`\\b${full}\\b`, 'g'), abbr);
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

function compareAddresses(billAddr, wpAddr) {
  const normBill = normalizeAddress(billAddr);
  const normWp = normalizeAddress(wpAddr);

  if (!normBill || !normWp) return 'none';
  if (normBill === normWp) return 'exact';

  const billParts = normBill.match(/^(\d+)\s+(.+)/);
  const wpParts = normWp.match(/^(\d+)\s+(.+)/);

  if (billParts && wpParts && billParts[1] === wpParts[1]) {
    if (billParts[2].includes(wpParts[2]) || wpParts[2].includes(billParts[2])) {
      return 'partial';
    }
  }

  return 'none';
}

function buildVerificationResult(billData, whitepagesData) {
  const fullBillAddr = `${billData.customer.address}, ${billData.customer.city}, ${billData.customer.state} ${billData.customer.zip}`;

  if (!whitepagesData || !whitepagesData.addresses || whitepagesData.addresses.length === 0) {
    return {
      status: VERIFICATION_STATUS.NOT_FOUND,
      nameSearched: billData.customer.name,
      addressOnBill: fullBillAddr,
      addressOnWhitepages: null,
      confidence: null,
      note: 'No matching person found on Whitepages for this name and location.',
      timestamp: new Date().toISOString(),
    };
  }

  // Check each Whitepages address against the bill address
  let bestMatch = 'none';
  let bestAddr = null;

  for (const wpAddr of whitepagesData.addresses) {
    const wpFull = `${wpAddr.street}, ${wpAddr.city}, ${wpAddr.state} ${wpAddr.zip}`;
    const result = compareAddresses(fullBillAddr, wpFull);
    if (result === 'exact') {
      bestMatch = 'exact';
      bestAddr = wpFull;
      break;
    }
    if (result === 'partial' && bestMatch !== 'exact') {
      bestMatch = 'partial';
      bestAddr = wpFull;
    }
    if (!bestAddr) bestAddr = wpFull;
  }

  if (bestMatch === 'exact') {
    return {
      status: VERIFICATION_STATUS.VERIFIED,
      nameSearched: billData.customer.name,
      addressOnBill: fullBillAddr,
      addressOnWhitepages: bestAddr,
      confidence: 'high',
      note: 'Property owner name matches the name on the utility bill.',
      timestamp: new Date().toISOString(),
    };
  }

  if (bestMatch === 'partial') {
    return {
      status: VERIFICATION_STATUS.PARTIAL_MATCH,
      nameSearched: billData.customer.name,
      addressOnBill: fullBillAddr,
      addressOnWhitepages: bestAddr,
      confidence: 'medium',
      note: 'Name found on Whitepages but the address is a partial match. The property may have a different format or unit number.',
      timestamp: new Date().toISOString(),
    };
  }

  return {
    status: VERIFICATION_STATUS.PARTIAL_MATCH,
    nameSearched: billData.customer.name,
    addressOnBill: fullBillAddr,
    addressOnWhitepages: bestAddr,
    confidence: 'low',
    note: 'Name found on Whitepages but the listed address does not match the utility bill address.',
    timestamp: new Date().toISOString(),
  };
}

function defaultVerification() {
  return {
    status: VERIFICATION_STATUS.NOT_PERFORMED,
    nameSearched: null,
    addressOnBill: null,
    addressOnWhitepages: null,
    confidence: null,
    note: 'Property ownership verification was not performed for this analysis.',
    timestamp: null,
  };
}

module.exports = {
  VERIFICATION_STATUS,
  normalizeAddress,
  compareAddresses,
  buildVerificationResult,
  defaultVerification,
};
