# Autoresearch: Utility Bill Review Optimization

## Goal
Maximize the conversion funnel: page load → file upload → analysis completion → email capture. Secondary: improve analysis quality, speed, and multi-utility support.

## Metric
Primary: Simulated end-to-end flow success (page serves, upload accepts PDF, analysis completes, teaser renders, email gate works, full report renders, Excel export works).
Secondary: Response time for analysis pipeline, code quality, error handling robustness.

## Scope
- `public/index.html` — landing page copy, UX flow, mobile responsiveness
- `public/styles.css` — visual polish, trust signals, conversion optimization
- `src/index.js` — server routes, error handling, performance
- `src/pipeline/` — analysis accuracy, speed, multi-utility support
- `src/report/` — report quality, teaser effectiveness
- `src/email/` — email deliverability and content
- `src/db.js` — data persistence

## Constraints
- Do NOT change API keys or environment variables
- Do NOT modify financial calculation logic in `savingsCalculator.js` or `constants.js` (pricing is intentional)
- Do NOT remove the email gate — it's the conversion point
- Do NOT add new npm dependencies without justification
- Keep the app as a single Express server (no microservices)
- All changes must be backward compatible with existing leads in SQLite

## Guard
```bash
node -e "require('./src/db'); require('./src/email/sendgrid'); require('./src/pipeline/orchestrator'); console.log('OK')"
```

## Iteration Ideas (seed list)
1. Add structured data (JSON-LD) for SEO
2. Optimize Claude Vision prompts for faster/cheaper bill parsing
3. Add loading skeleton instead of spinner for perceived performance
4. Compress satellite images for faster panel designer load
5. Add rate limiting middleware to prevent abuse
6. Add input sanitization on email/phone fields
7. Improve mobile layout for dual-upload mode
8. Add "Analyzing X utility bills this month" social proof counter
9. Pre-populate state-specific net metering rules (CO, AZ, FL, TX)
10. Add error recovery — if one pipeline step fails, still show partial results
