# Campaign Optimizer — Utility Bill Review Google Ads

Weekly campaign review and optimization workflow. Analyzes performance data and produces actionable recommendations.

## Campaign Context

- **Account**: 502-499-5293 (your@utilitybillreview.com)
- **Campaign**: Search Campaign 1 — Proposal Evaluation
- **Goal**: Lead form submissions (email capture)
- **Conversion tracking**: gtag.js, AW-18059144504/sYfTCKyMypQcELjaoqND
- **Budget**: $50/day ($1,500/month)
- **Bid strategy**: Maximize Clicks with $5 max CPC
- **Location**: Colorado
- **Keywords**: 17 high-intent solar evaluation keywords
- **Landing page**: https://www.utilitybillreview.com

## Weekly Review Checklist

When invoked, run through this entire checklist using the Google Ads dashboard (navigate in browser):

### 1. Budget & Spend Analysis
- [ ] Check daily spend vs $50 budget — are we hitting the cap?
- [ ] Calculate impression share (Search IS) — are we losing impressions to budget?
- [ ] If IS < 80%, budget is likely the constraint — recommend increase
- [ ] If IS > 90% with low conversions, budget isn't the problem — it's targeting/creative
- [ ] Check day-of-week performance — should we use ad scheduling?

### 2. Keyword Performance
- [ ] Sort keywords by cost (descending) — where is money going?
- [ ] Check Quality Score for each keyword (aim for 7+)
- [ ] Identify keywords with spend > $20 and zero conversions — pause candidates
- [ ] Identify keywords with CTR < 2% — ad relevance issue
- [ ] Identify keywords with CPC > $3 — bid too high or low quality
- [ ] Check search terms report — run /search-term-mining if 7+ days of data

### 3. Ad Performance
- [ ] Check RSA asset performance (headlines and descriptions rated "Best", "Good", "Low")
- [ ] Identify any pinned assets underperforming
- [ ] Check ad strength score — aim for "Good" or "Excellent"
- [ ] Compare CTR across ad variations
- [ ] Recommend new headlines/descriptions to test — run /ad-hooks if needed

### 4. Conversion Funnel
- [ ] Check conversion rate (conversions / clicks)
- [ ] If conversion rate < 3%, investigate landing page issues
- [ ] Check Plausible Analytics for on-site behavior (bounce rate, time on page)
- [ ] Compare conversion rates by keyword — which keywords convert best?
- [ ] Calculate cost per lead (total spend / total conversions)

### 5. Geographic & Device Analysis
- [ ] Check performance by location within Colorado
- [ ] Check mobile vs desktop performance
- [ ] If mobile CPC is significantly higher with lower conversion, consider bid adjustment

### 6. Competitive Analysis
- [ ] Check Auction Insights — who else is bidding on these terms?
- [ ] Check average position / impression share vs competitors
- [ ] If losing to specific competitors, note their ads for creative inspiration

## Decision Framework

### When to INCREASE budget:
- Impression share < 70% AND conversion rate > 5% AND cost per lead < $30

### When to DECREASE budget:
- Cost per lead > $75 after 50+ clicks with conversion data
- Quality scores dropping below 5 across multiple keywords

### When to PAUSE a keyword:
- Spend > $50 with zero conversions
- CTR < 1% after 500+ impressions
- Quality Score < 4

### When to ADD new keywords:
- Search term report shows high-intent terms not in keyword list
- Competitor analysis reveals gaps
- After running /ad-hooks, identify new angle-based keywords

### When to change BID STRATEGY:
- After 30+ conversions → switch from Maximize Clicks to Maximize Conversions
- After 50+ conversions → test Target CPA bidding

## Output Format

Produce a structured weekly report:

```
## Campaign Performance Report — Week of [Date]

### Key Metrics
| Metric | This Week | Last Week | Change |
|--------|-----------|-----------|--------|
| Spend | | | |
| Clicks | | | |
| Impressions | | | |
| CTR | | | |
| Avg CPC | | | |
| Conversions | | | |
| Conv Rate | | | |
| Cost/Lead | | | |
| Search IS | | | |

### Top Performing Keywords
[table]

### Underperforming Keywords (Action Needed)
[table with recommended action]

### Recommendations
1. [Prioritized action items]
2. ...
3. ...

### Next Week Focus
[What to test/change]
```

## Integration with Other Skills

- Use `/ad-hooks` to generate new headline/description variations for testing
- Use `/search-term-mining` to analyze search term report and build negative keyword lists
- Check Plausible Analytics (https://plausible.io/utilitybillreview.com) for on-site metrics
