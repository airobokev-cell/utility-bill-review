const puppeteer = require('puppeteer');

const WP_TIMEOUT_MS = 30000;

/**
 * Look up a person on Whitepages and return their listed addresses.
 *
 * Flow: search page → find best matching person → navigate to profile → extract full address
 *
 * @param {string} name - Full name (e.g. "Georgia Browning")
 * @param {string} city - City (e.g. "Glenview")
 * @param {string} state - State abbreviation (e.g. "IL")
 * @param {AbortSignal} [signal] - Abort signal for client disconnect
 * @returns {Promise<{name: string, addresses: Array<{street: string, city: string, state: string, zip: string}>} | null>}
 */
async function lookupWhitepages(name, city, state, signal) {
  if (!name || !city || !state) {
    console.warn('[whitepages] Missing name, city, or state — skipping lookup');
    return null;
  }

  // Build direct search URL: whitepages.com/name/First-Last/City-State
  const nameParts = name.trim().split(/\s+/);
  const urlName = nameParts.map((p) => capitalize(p)).join('-');
  const urlCity = city.trim().split(/\s+/).map((p) => capitalize(p)).join('-');
  const url = `https://www.whitepages.com/name/${encodeURIComponent(urlName)}/${encodeURIComponent(urlCity)}-${state.toUpperCase()}`;

  console.log(`[whitepages] Looking up: ${name} in ${city}, ${state}`);
  console.log(`[whitepages] URL: ${url}`);

  let browser;
  try {
    if (signal?.aborted) throw new Error('Whitepages lookup aborted: client disconnected');

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Set up abort listener
    const onAbort = () => {
      console.log('[whitepages] Client disconnected, closing browser');
      browser?.close().catch(() => {});
    };
    if (signal) signal.addEventListener('abort', onAbort);

    try {
      // Step 1: Navigate to search results page
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: WP_TIMEOUT_MS });
      await new Promise((r) => setTimeout(r, 3000));

      if (signal?.aborted) throw new Error('Whitepages lookup aborted: client disconnected');

      // Step 2: Accept TOS modal if present
      await acceptTosModal(page);

      if (signal?.aborted) throw new Error('Whitepages lookup aborted: client disconnected');

      // Step 3: Extract person cards from search results
      const people = await page.evaluate(() => {
        const cards = document.querySelectorAll('.serp-card[data-qa-selector="organic-card"]');
        return Array.from(cards).map((card) => {
          const nameEl = card.querySelector('a[href*="/name/"]');
          const locEl = card.querySelector('[class*="location"]');
          const profileLink = nameEl ? nameEl.href : null;

          // Parse location: "City East Peoria, IL" → "East Peoria, IL"
          let location = locEl ? locEl.textContent.trim() : '';
          location = location.replace(/^City\s*/i, '').replace(/\s*Neighborhood\s*\(.+\)/, '').trim();

          return {
            name: nameEl ? nameEl.textContent.trim() : null,
            location,
            profileUrl: profileLink,
          };
        }).filter((p) => p.name && p.profileUrl);
      });

      console.log(`[whitepages] Found ${people.length} person result(s) on search page`);

      if (people.length === 0) {
        console.log('[whitepages] No results found');
        return null;
      }

      // Step 4: Find the best matching person
      const bestPerson = findBestMatch(people, name, city, state);
      if (!bestPerson) {
        console.log('[whitepages] No person matched the search criteria');
        return null;
      }

      console.log(`[whitepages] Best match: ${bestPerson.name} — ${bestPerson.location}`);
      console.log(`[whitepages] Navigating to profile: ${bestPerson.profileUrl}`);

      if (signal?.aborted) throw new Error('Whitepages lookup aborted: client disconnected');

      // Step 5: Navigate to the person's profile page
      await page.goto(bestPerson.profileUrl, { waitUntil: 'domcontentloaded', timeout: WP_TIMEOUT_MS });
      await new Promise((r) => setTimeout(r, 3000));

      if (signal?.aborted) throw new Error('Whitepages lookup aborted: client disconnected');

      // Step 6: Extract the full address from the profile page
      const profileData = await page.evaluate(() => {
        const text = document.body.innerText;

        // The profile page shows the full address in a prominent location
        // Pattern: "Name\n293 E Far Hills Dr, East Peoria, IL 61611"
        // Look for address pattern: number + street, city, state zip
        const addressPattern = /(\d+\s+[A-Za-z0-9\s.]+(?:St|Ave|Dr|Blvd|Rd|Ln|Ct|Pl|Way|Cir|Ter|Pkwy|Trl)[^,]*),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5})/gi;
        const matches = [];
        let match;
        while ((match = addressPattern.exec(text)) !== null) {
          matches.push({
            full: match[0],
            street: match[1].trim(),
            city: match[2].trim(),
            state: match[3],
            zip: match[4],
          });
        }

        // Also look for a broader address pattern (catches addresses without standard suffixes)
        if (matches.length === 0) {
          const broadPattern = /(\d+\s+[A-Za-z0-9\s.]+),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5})/g;
          while ((match = broadPattern.exec(text)) !== null) {
            // Skip if it looks like a phone number or non-address
            if (match[1].length > 5 && match[1].length < 60) {
              matches.push({
                full: match[0],
                street: match[1].trim(),
                city: match[2].trim(),
                state: match[3],
                zip: match[4],
              });
            }
          }
        }

        // Deduplicate by street+zip and filter out prose false positives
        const seen = new Set();
        const unique = matches.filter((m) => {
          // Skip entries where the "street" contains prose words
          if (/\b(years?|home|address|is|their|lived|has)\b/i.test(m.street)) return false;
          const key = `${m.street.toLowerCase()}|${m.zip}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        return unique;
      });

      console.log(`[whitepages] Found ${profileData.length} address(es) on profile page`);
      profileData.forEach((a) => console.log(`[whitepages]   - ${a.full}`));

      if (profileData.length === 0) {
        // Fallback: return the city-level location from the search results
        console.log('[whitepages] No street address found on profile, using city-level location');
        const parsed = parseLocation(bestPerson.location);
        return {
          name: bestPerson.name,
          addresses: parsed ? [parsed] : [],
        };
      }

      return {
        name: bestPerson.name,
        addresses: profileData.map((a) => ({
          street: a.street,
          city: a.city,
          state: a.state,
          zip: a.zip,
        })),
      };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new Error('Whitepages lookup aborted: client disconnected');
    }
    console.error(`[whitepages] Lookup failed: ${err.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Accept the Whitepages TOS/cookie modal if present.
 */
async function acceptTosModal(page) {
  try {
    const hasModal = await page.evaluate(() => !!document.getElementById('tos-checkbox'));
    if (!hasModal) return;

    await page.evaluate(() => {
      const checkbox = document.getElementById('tos-checkbox');
      if (checkbox) checkbox.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const continueBtn = buttons.find((b) => b.textContent.includes('Continue'));
      if (continueBtn) continueBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('[whitepages] TOS modal accepted');
  } catch {
    console.log('[whitepages] No TOS modal or already accepted');
  }
}

/**
 * Find the person result that best matches the search criteria.
 */
function findBestMatch(people, searchName, searchCity, searchState) {
  const nameLower = searchName.toLowerCase().trim();
  const nameParts = nameLower.split(/\s+/);
  const cityLower = searchCity.toLowerCase();

  let bestPerson = null;
  let bestScore = 0;

  for (const person of people) {
    const personNameLower = person.name.toLowerCase();
    let score = 0;

    // Check if search name parts appear in the result name
    for (const part of nameParts) {
      if (personNameLower.includes(part)) score += 1;
    }

    // Bonus for matching city/state in the location
    if (person.location) {
      const locLower = person.location.toLowerCase();
      if (locLower.includes(cityLower)) score += 3; // Strong city match
      if (locLower.includes(searchState.toLowerCase())) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPerson = person;
    }
  }

  // Require at least the first and last name to match
  return bestScore >= nameParts.length ? bestPerson : null;
}

/**
 * Parse a location string like "East Peoria, IL" into { street, city, state, zip }.
 */
function parseLocation(loc) {
  if (!loc) return null;
  const match = loc.match(/^(.+?),\s*([A-Z]{2})(?:\s+(\d{5}))?/);
  if (match) {
    return { street: '', city: match[1].trim(), state: match[2], zip: match[3] || '' };
  }
  return null;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = { lookupWhitepages };
