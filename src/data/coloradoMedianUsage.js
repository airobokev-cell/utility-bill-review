/**
 * Colorado Front Range median annual residential electricity consumption by zip code prefix.
 * Source: Xcel Energy territory averages, EIA Colorado residential data.
 * These are approximate but sufficient for peer comparison scoring.
 * Gas heating is dominant (~60% of Front Range homes), so electric usage
 * is primarily cooling, appliances, lighting, and water heating.
 */
const COLORADO_ZIP_MEDIANS = {
  '800': 7100,  // Denver central — older urban stock, smaller homes
  '801': 7400,  // Denver south — larger homes, more AC usage
  '802': 6800,  // Denver urban core — condos/townhomes mixed in
  '803': 7600,  // Boulder — altitude + older stock + university
  '804': 7200,  // Golden/Lakewood — suburban mix
  '805': 7800,  // Longmont/Fort Collins — newer but larger homes
  '806': 7500,  // Greeley/Weld County
  '807': 7300,  // Fort Morgan/Eastern Plains
  '808': 7000,  // Colorado Springs — slightly milder than Denver
  '809': 7200,  // Pueblo area
  '810': 6500,  // Mountain communities (smaller, less AC)
  '811': 6200,  // Alamosa/San Luis Valley
  '812': 6400,  // Salida/Buena Vista
  '813': 6600,  // Durango/SW Colorado
  '814': 7100,  // Grand Junction/Western Slope
  'default': 7200,
};

/**
 * Get median annual kWh for a zip code.
 */
function getMedianForZip(zip) {
  if (!zip) return COLORADO_ZIP_MEDIANS['default'];
  const prefix = String(zip).slice(0, 3);
  return COLORADO_ZIP_MEDIANS[prefix] || COLORADO_ZIP_MEDIANS['default'];
}

module.exports = { COLORADO_ZIP_MEDIANS, getMedianForZip };
