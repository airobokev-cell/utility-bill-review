# Search Term Mining Methodology — Utility Bill Review

Analyze search term reports from Google Ads to find negative keyword opportunities, new keyword candidates, and wasted spend. Inspired by performance marketing workflows used at scale.

## When to Use

Run this skill after the campaign has been live for 7+ days and has accumulated search term data. Use it weekly to optimize keyword targeting and reduce wasted spend.

## Input Required

When invoked, ask for ONE of:
1. A CSV export of the Search Terms report from Google Ads (paste path or content)
2. Or navigate to Google Ads > Campaigns > Search keywords > Search terms and read the data directly

## Search Term Mining Methodology

### Core Approach

The goal is not just "cost conversions = bad" — it's relevance to the campaign theme.

### Step 1: Filter to Actionable Terms

- Only look at search terms with status "None" (not already added as keywords or negatives)
- Use `get_search_terms` which applies this filter automatically
- If manual: filter out terms already in the keyword list

### Step 2: Evaluate Every Term Using the Three-Way Cross-Reference

For each search term, consider THREE things together:

1. **The search term itself** (what the user typed)
2. **The matched keyword** (what triggered the ad)
3. **The campaign + ad group theme** (our actual conversion/messaging campaign context)

### Step 3: For Each Term, Decide: Negative or Keep

**NEGATIVE if:**
- Term is completely irrelevant to solar proposal evaluation (e.g., "solar panel installation near me", "buy solar panels", "solar company reviews")
- Term indicates someone looking to BUY solar, not EVALUATE a quote they already have
- Term is for a different state/region (unless broad match brought in relevant nearby traffic)
- Term has high spend with zero conversions AND low relevance
- A term should be kept short if close-to-conversion — structure matters here too

**KEEP if:**
- Term shows HIGH EVALUATION INTENT: "is my solar quote fair", "check solar proposal", "solar quote review"
- Term shows COST COMPARISON intent: "solar cost per watt Colorado", "average solar price Denver"
- Term shows DISTRUST of sales process: "solar sales pressure", "are solar quotes accurate"
- Term relates to utility bill analysis: "Xcel Energy rate increase", "electricity bill too high"

### Step 4: Build the CSV

Output columns:
| Campaign | Ad Group | Keyword | Search Term | Match Type | Cost | Clicks | Impressions | CPC | CTR | Conversions | Reasoning |

### Step 5: Include Only Recommended Negatives

- Include only the terms recommended for negation
- Save as CSV file to the project directory
- Provide a summary count: X terms reviewed, Y negatives recommended, Z new keyword candidates

## Negative Keyword Categories for Utility Bill Review

Pre-built negative keyword themes to watch for:
- **Purchase intent**: "buy solar", "install solar", "solar company", "solar installer", "get solar"
- **Specific companies**: "[Company name] solar", unless it's a comparison query
- **DIY**: "DIY solar", "build solar panels"
- **Non-Colorado**: State-specific terms for other states
- **Unrelated utilities**: "gas bill", "water bill" (unless combined with solar)
- **Jobs/careers**: "solar jobs", "solar installer salary"
- **Academic**: "how do solar panels work", "solar energy science"

## Output Requirements

1. **Summary table** of all flagged terms with reasoning
2. **Recommended negative keywords list** (exact match and phrase match suggestions)
3. **New keyword candidates** — search terms showing high intent that aren't in the current keyword list
4. **Spend analysis** — total wasted spend on irrelevant terms
5. Save the full analysis as a CSV to `/Users/airobokev/Documents/solar-savings/reports/search-term-analysis-[date].csv`
