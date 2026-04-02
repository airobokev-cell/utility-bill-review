# Utility Bill Review -- Design Update Plan

**Date:** April 1, 2026
**Scope:** Full visual redesign of utilitybillreview.com landing page and matching report output
**Files affected:** `public/styles.css`, `public/index.html`, `public/favicon.svg`, `src/report/template*.html`

---

## 1. Intent Definition

**Who is this for?**
A Colorado homeowner (age 35-60, household income $80K-$180K) who just received a $30K-$50K solar proposal and feels uncertain. They are educated, skeptical of salespeople, and looking for a second opinion -- not another pitch. They may have already gotten multiple quotes and feel more confused, not less.

**How should they feel?**
- Confident: "This tool knows more about my situation than the salesperson did."
- Safe: "This is not trying to sell me anything."
- Respected: "This treats me like an adult making a major financial decision."

**The feeling we are NOT going for:**
- Startup-y excitement
- Gamified or playful
- Generic SaaS "get started free!"

**Design metaphor:**
_"A Bloomberg terminal meets an architectural firm's lobby."_
Data-dense credibility with material warmth. Think: the cover page of a Morningstar investment report printed on heavy cotton stock, with a single accent line in amber.

---

## 2. Design Language

**Tangible aesthetic vocabulary:**

| Instead of...       | We say...                                           |
|---------------------|-----------------------------------------------------|
| Clean               | "Matte cotton bond paper"                           |
| Modern              | "Architectural elevation drawing"                   |
| Professional        | "Financial prospectus cover page"                   |
| Trustworthy         | "Notarized document weight"                         |
| Friendly            | "Warm graphite pencil on cream stock"               |

**Material references:**
- The weight of an appraisal document
- The grid precision of an engineering site plan
- The restrained confidence of a Vanguard fund fact sheet
- The single warm accent of a Colorado mesa at golden hour

**What this means in practice:**
- Generous whitespace (the page breathes like a printed document)
- Type does the heavy lifting -- no decorative elements
- One accent color used sparingly, like a highlighter on a contract
- Borders and dividers feel like ruled lines on ledger paper, not CSS decoration
- Cards have subtle depth, like sheets of paper stacked on a desk

---

## 3. Color Hierarchy

### 3-Tier System

| Tier       | Role                        | Color           | Hex       | Usage                                           |
|------------|-----------------------------|-----------------|-----------|--------------------------------------------------|
| **Neutral** | Canvas / background         | Warm off-white  | `#FAFAF7` | Page background                                  |
| **Neutral** | Card / elevated surface     | Pure white      | `#FFFFFF` | Cards, drop zones, form fields                   |
| **Neutral** | Subtle border / rule        | Warm gray       | `#E8E6E1` | Dividers, card borders, table rules              |
| **Neutral** | Secondary surface           | Light warm gray | `#F3F2EF` | Tab bar background, code blocks, alt rows        |
| **Primary** | Ink / heading text          | Deep charcoal   | `#1C1C1A` | H1, H2, strong labels, nav logo                  |
| **Primary** | Body text                   | Warm dark gray  | `#3D3D3A` | Paragraph text, descriptions                     |
| **Primary** | Secondary text              | Medium warm gray| `#7A7A72` | Subtitles, captions, helper text                 |
| **Primary** | Tertiary text               | Light warm gray | `#A3A39B` | Privacy notes, fine print                        |
| **Tertiary**| Accent (attention)          | Mesa amber      | `#D97706` | CTA button, step numbers, active tab indicator   |
| **Tertiary**| Accent hover                | Deep amber      | `#B45309` | Button hover states                              |
| **Tertiary**| Accent surface (light)      | Pale amber      | `#FEF8EC` | Social proof bar, Colorado callout bg            |
| Support    | Success / positive          | Sage green      | `#3D7A4A` | File selected, savings positive indicators       |
| Support    | Success surface             | Pale sage       | `#F0F7F1` | File selected background                         |
| Support    | Error                       | Muted red       | `#B91C1C` | Error states only                                |
| Support    | Link / interactive          | Deep blue-gray  | `#3B5998` | Text links (not buttons), underline on hover     |

### Why these colors?

- **Warm neutrals** instead of blue-gray Tailwind defaults: Cream/warm gray feels like paper, not like a SaaS dashboard. It signals "document" not "app."
- **Mesa amber** as the single accent: Connects to Colorado landscape (golden hour on Red Rocks), connects to energy/sun without being literal yellow, and connects to financial caution/attention (amber = "pay attention here"). It is warm without being aggressive.
- **No blue primary:** Blue is the default SaaS color. Every solar calculator uses it. Removing it immediately differentiates the page and breaks the "template" feel.
- **Sage green for success states only:** Green is reserved for positive confirmation (file uploaded, savings found). It never competes with the amber accent.

---

## 4. Typography Plan

### Font Pairing

| Role         | Font                          | Google Fonts URL                                        | Weights        |
|--------------|-------------------------------|--------------------------------------------------------|----------------|
| **Headings** | **DM Serif Display**          | `family=DM+Serif+Display:ital@0;1`                    | 400            |
| **Body**     | **Inter**                     | `family=Inter:wght@400;500;600;700`                    | 400, 500, 600, 700 |

**Why DM Serif Display?**
- It has the authority of a newspaper masthead or financial report title
- Pairs the "prospectus cover page" aesthetic with readability
- The subtle serif adds gravitas that system sans-serif lacks
- Used ONLY for h1 and h2 -- everything else stays in Inter

**Why Inter?**
- Best-in-class screen legibility at small sizes (crucial for data-dense reports)
- Tabular number support for financial figures
- Extensive weight range for clear hierarchy
- Already feels "native" to users on Apple/Google devices

### Type Scale

```
--font-heading:   'DM Serif Display', Georgia, serif;
--font-body:      'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

h1:       36px / 1.15 line-height / --font-heading / #1C1C1A / letter-spacing: -0.5px
h2:       26px / 1.25 line-height / --font-heading / #1C1C1A / letter-spacing: -0.3px
h3:       16px / 1.4  line-height / --font-body    / #1C1C1A / font-weight: 600
Body:     15px / 1.6  line-height / --font-body    / #3D3D3A / font-weight: 400
Small:    13px / 1.5  line-height / --font-body    / #7A7A72 / font-weight: 400
Caption:  12px / 1.4  line-height / --font-body    / #A3A39B / font-weight: 400
```

### Google Fonts Link Tag (replace current system font approach)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## 5. Icon Strategy

### Remove all emoji icons. Replace with inline SVGs.

**Icon style:** 1.5px stroke weight, rounded line caps, 24x24 viewbox. Matches the "architectural line drawing" aesthetic. No fills -- outlines only, like a technical drawing.

**Icon color:** `#7A7A72` (secondary text) by default, `#D97706` (amber) when used as a feature highlight.

### Icon Replacements

| Current Emoji | Context                    | Replacement SVG concept           |
|---------------|----------------------------|-----------------------------------|
| `&#128196;`   | Solar proposal drop zone   | Document with arrow-up            |
| `&#9889;`     | Electric bill drop zone    | Lightning bolt (stroke only)      |
| `&#127968;`   | Property tax exempt        | House outline                     |
| `&#128176;`   | No phantom tax credits     | Dollar sign with strikethrough    |
| `&#9878;`     | Updated net metering       | Scale/balance                     |

### Implementation

Create a `public/icons.svg` sprite sheet using `<symbol>` elements, then reference with `<svg><use href="/icons.svg#icon-name"/></svg>`. This approach:
- Zero external requests (inline the SVG sprite in the HTML `<body>` top)
- Cacheable
- Styleable via CSS (stroke color, size)
- No icon font overhead

**Example icon markup:**
```html
<!-- Hidden SVG sprite at top of <body> -->
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="icon-document-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="18" x2="12" y2="12"/>
    <polyline points="9 15 12 12 15 15"/>
  </symbol>
  <symbol id="icon-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </symbol>
  <symbol id="icon-house" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </symbol>
  <symbol id="icon-dollar-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    <line x1="4" y1="4" x2="20" y2="20" stroke="#B91C1C" stroke-width="2"/>
  </symbol>
  <symbol id="icon-scale" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="3" x2="12" y2="21"/>
    <polyline points="1 12 5 8 9 12"/>
    <polyline points="15 12 19 8 23 12"/>
    <line x1="5" y1="8" x2="19" y2="8"/>
  </symbol>
  <symbol id="icon-upload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </symbol>
  <symbol id="icon-cpu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <rect x="9" y="9" width="6" height="6"/>
    <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
    <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
    <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
    <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
  </symbol>
  <symbol id="icon-bar-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="20" x2="12" y2="10"/>
    <line x1="18" y1="20" x2="18" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="16"/>
  </symbol>
  <symbol id="icon-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </symbol>
  <symbol id="icon-check-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </symbol>
</svg>

<!-- Usage in HTML -->
<svg class="icon" width="24" height="24"><use href="#icon-document-up"/></svg>
```

---

## 6. Section-by-Section Changes

### 6A. Global / CSS Custom Properties

**File:** `public/styles.css`

Replace the current `*` and `body` rules with:

```css
:root {
  /* Neutral tier */
  --canvas:           #FAFAF7;
  --surface:          #FFFFFF;
  --surface-alt:      #F3F2EF;
  --border:           #E8E6E1;
  --border-strong:    #D4D2CC;

  /* Primary tier (ink) */
  --ink:              #1C1C1A;
  --ink-body:         #3D3D3A;
  --ink-secondary:    #7A7A72;
  --ink-tertiary:     #A3A39B;

  /* Tertiary tier (accent) */
  --accent:           #D97706;
  --accent-hover:     #B45309;
  --accent-surface:   #FEF8EC;
  --accent-border:    #FDE68A;

  /* Support */
  --success:          #3D7A4A;
  --success-surface:  #F0F7F1;
  --success-border:   #B7D4BC;
  --error:            #B91C1C;
  --link:             #3B5998;

  /* Typography */
  --font-heading:     'DM Serif Display', Georgia, 'Times New Roman', serif;
  --font-body:        'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* Spacing scale (8px base) */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Radius */
  --radius-sm:  6px;
  --radius-md:  10px;
  --radius-lg:  14px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  background: var(--canvas);
  color: var(--ink-body);
  min-height: 100vh;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

**Why:** Establishes the full design token system. Every color, spacing, and font decision flows from these variables. Warm canvas (`#FAFAF7`) immediately breaks the "SaaS template" feel. (Principle 3: Color Hierarchy)

---

### 6B. Layout Container

```css
#app {
  max-width: 880px;   /* Slightly narrower for better reading measure */
  margin: 0 auto;
  padding: var(--space-12) var(--space-5);
}
```

**Why:** 880px gives a tighter, more "printed document" column width. The wider 960px felt like a web app. (Principle 2: Design Language -- "financial prospectus")

---

### 6C. Site Header

**HTML change:** None required.

**CSS change:**
```css
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-12);
  padding-bottom: var(--space-5);
  border-bottom: 2px solid var(--ink);  /* Bold rule, like a document header */
}
.site-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
}
.site-logo span {
  font-family: var(--font-heading);
  font-size: 18px;
  font-weight: 400;
  letter-spacing: 0;
}
.site-nav a {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-secondary);
  text-decoration: none;
  transition: color 0.2s;
}
.site-nav a:hover { color: var(--ink); }
```

**Why:** The 2px solid dark border instead of 1px light gray gives the header the weight of a printed document header rule. Logo in serif font establishes authority immediately. (Principle 2: "notarized document weight")

---

### 6D. Hero / H1 Section

**CSS change:**
```css
h1 {
  font-family: var(--font-heading);
  font-size: 36px;
  line-height: 1.15;
  margin-bottom: var(--space-3);
  color: var(--ink);
  letter-spacing: -0.5px;
  font-weight: 400;   /* DM Serif Display only has 400 */
}

.subtitle {
  color: var(--ink-secondary);
  margin-bottom: var(--space-5);
  font-size: 16px;
  line-height: 1.6;
  max-width: 640px;   /* Constrain for optimal reading width */
}
```

**Why:** Serif h1 gives it the weight of a newspaper headline or prospectus title. Constraining subtitle width improves readability. (Principle 1: Intent -- "expert counsel")

---

### 6E. Trust Bar (below subtitle)

**CSS change:**
```css
.trust-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: var(--space-6);
  font-size: 13px;
  color: var(--ink-secondary);
  letter-spacing: 0.3px;
  text-transform: uppercase;
  font-weight: 500;
}
.trust-sep {
  width: 1px;
  height: 14px;
  background: var(--border-strong);
}
```

**Why:** Uppercase small caps with vertical bar separators (not dots) feel like the header of a printed financial document. (Principle 2: "financial prospectus")

---

### 6F. Social Proof Bar

**CSS change:**
```css
.social-proof {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: var(--space-8);
  font-size: 14px;
  color: var(--ink-body);
  background: var(--accent-surface);
  padding: 12px 20px;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-border);
}
.proof-stat strong {
  font-weight: 700;
  color: var(--accent);
}
.proof-sep {
  width: 1px;
  height: 14px;
  background: var(--accent-border);
}
```

**Why:** Moving from green to amber surface ties the social proof to the accent color system. The amber "pay attention" signal highlights credibility without the "startup growth metrics" green. (Principle 3: Color Hierarchy -- accent tier for what demands attention)

---

### 6G. Tab Selector

**CSS change:**
```css
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: var(--space-5);
  background: var(--surface-alt);
  border-radius: var(--radius-md);
  padding: 4px;
  border: 1px solid var(--border);
}
.tab {
  flex: 1;
  padding: 10px 12px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.tab.active {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border-bottom: 2px solid var(--accent);  /* Amber indicator line */
}
.tab:hover:not(.active) { color: var(--ink); }
```

**Why:** Active tab gets an amber bottom accent line instead of just a white background. This is the accent color doing its job -- marking the active state as the "loudest" element in the tabs. (Principle 3: Tertiary accent for attention)

---

### 6H. Drop Zones

**CSS change:**
```css
.drop-zone {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: var(--surface);
}
.drop-zone:hover, .drop-zone.dragover {
  border-color: var(--accent);
  background: var(--accent-surface);
}

.drop-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto var(--space-3);
  color: var(--ink-secondary);
}
.drop-zone:hover .drop-icon,
.drop-zone.dragover .drop-icon {
  color: var(--accent);
}

.drop-content p {
  margin: 4px 0;
  color: var(--ink-body);
}
.drop-sub {
  color: var(--ink-tertiary);
  font-size: 13px;
}

.browse-btn {
  background: none;
  border: 1px solid var(--border-strong);
  color: var(--ink-secondary);
  cursor: pointer;
  font-weight: 500;
  font-size: 13px;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  margin-top: var(--space-2);
  transition: all 0.2s;
}
.browse-btn:hover {
  background: var(--accent-surface);
  border-color: var(--accent);
  color: var(--accent);
}
```

**HTML change for drop-icon:** Replace emoji `<div class="drop-icon">&#128196;</div>` with:
```html
<div class="drop-icon">
  <svg width="32" height="32"><use href="#icon-document-up"/></svg>
</div>
```

And replace `&#9889;` with:
```html
<div class="drop-icon">
  <svg width="32" height="32"><use href="#icon-bolt"/></svg>
</div>
```

**Why:** Hover state shifts to amber instead of blue -- reinforcing the accent hierarchy. SVG icons replace emoji for consistency and professionalism. The drop zone background is white (surface) against the cream canvas, creating subtle paper-on-desk layering. (Principle 2: "sheets of paper stacked on a desk")

---

### 6I. Analyze Button (CTA)

```css
#analyze-btn {
  display: block;
  width: 100%;
  margin-top: var(--space-4);
  padding: 16px;
  background: var(--accent);
  color: #FFFFFF;
  border: none;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  letter-spacing: 0.2px;
}
#analyze-btn:hover { background: var(--accent-hover); }
```

**Why:** The ONE element on the page that screams for attention. Amber CTA against warm white/cream background creates maximum contrast without relying on generic blue. (Principle 3: Tertiary = loudest accent)

---

### 6J. Colorado Callout Section

**CSS change:**
```css
.colorado-callout {
  margin-top: var(--space-12);
  padding: var(--space-8);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  border-left: 4px solid var(--accent);  /* Document margin accent */
}
.colorado-callout h2 {
  font-family: var(--font-heading);
  font-size: 24px;
  color: var(--ink);
  margin-bottom: var(--space-5);
  text-align: left;   /* Left-align for document feel */
}
.callout-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: var(--accent-surface);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-2);
  color: var(--accent);
}
.callout-item {
  padding: var(--space-4);
  background: transparent;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
}
.callout-item:last-child { border-bottom: none; }
.callout-item strong {
  font-size: 14px;
  color: var(--ink);
  display: block;
  margin-bottom: 2px;
}
.callout-item p {
  font-size: 13px;
  color: var(--ink-secondary);
  line-height: 1.5;
  margin: 0;
}
```

**HTML change for callout layout:** Change from 2x2 grid to a single-column list:
```html
<div class="colorado-callout">
  <h2>Built for Colorado Homeowners</h2>
  <div class="callout-list">
    <div class="callout-item">
      <div class="callout-icon">
        <svg width="20" height="20"><use href="#icon-bolt"/></svg>
      </div>
      <strong>Xcel Energy rates analyzed</strong>
      <p>We model your actual Xcel rate schedule including TOU-R on-peak and off-peak periods.</p>
    </div>
    <!-- ... repeat for other items ... -->
  </div>
</div>
```

Replace the grid layout:
```css
.callout-list {
  display: flex;
  flex-direction: column;
}
```

**Why:** The left amber border makes this feel like a margin annotation on a printed document. Single-column list is easier to scan and feels more authoritative than a grid of tiles. Icons in amber squares create consistent visual anchors. (Principle 2: "architectural line drawing" / Principle 3: accent used for attention in icons)

---

### 6K. How It Works Section

**CSS change:**
```css
.how-it-works {
  margin-top: var(--space-12);
  text-align: center;
}
.how-it-works h2 {
  font-family: var(--font-heading);
  font-size: 26px;
  color: var(--ink);
  margin-bottom: var(--space-6);
}
.steps-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--space-4);
}
.step {
  padding: var(--space-6) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  position: relative;
}
.step-number {
  width: 36px;
  height: 36px;
  background: var(--accent);
  color: #FFFFFF;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  margin-bottom: var(--space-3);
}
.step h3 {
  font-size: 16px;
  color: var(--ink);
  margin-bottom: var(--space-2);
  font-weight: 600;
}
.step p {
  font-size: 13px;
  color: var(--ink-secondary);
  line-height: 1.5;
}
```

**Why:** Step numbers in amber make them the visual anchor of the section. White cards on cream canvas create the paper-on-desk depth. (Principle 3: accent for step numbers)

---

### 6L. Trust Section

**CSS change:**
```css
.trust-section {
  margin-top: var(--space-12);
  padding-top: var(--space-12);
  border-top: 2px solid var(--ink);  /* Strong document divider */
}
.trust-section h2 {
  font-family: var(--font-heading);
  font-size: 26px;
  color: var(--ink);
  margin-bottom: var(--space-6);
  text-align: center;
}
.trust-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.trust-card {
  padding: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.trust-card strong {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 14px;
  color: var(--ink);
  margin-bottom: var(--space-2);
}
.trust-card p {
  font-size: 13px;
  color: var(--ink-secondary);
  line-height: 1.6;
  margin: 0;
}
```

**HTML change:** Add an SVG icon before each trust card heading:
```html
<div class="trust-card">
  <strong>
    <svg class="trust-icon" width="18" height="18"><use href="#icon-shield"/></svg>
    Independent analysis, not another sales pitch
  </strong>
  <p>...</p>
</div>
```

Icon assignments:
- Independent analysis -> `#icon-shield`
- Colorado-specific -> `#icon-house` (the Colorado marker)
- Conservative assumptions -> `#icon-bar-chart`
- Free because... -> `#icon-check-circle`

**Why:** Adding the 2px dark top border creates a strong visual break (like a new section of a printed report). Icons before headings add visual proof without adding imagery. (Principle 1: "confident, like expert counsel")

---

### 6M. FAQ Section

**CSS change:**
```css
.faq-section {
  margin-top: var(--space-12);
  padding-top: var(--space-8);
  border-top: 1px solid var(--border);
}
.faq-section h2 {
  font-family: var(--font-heading);
  font-size: 26px;
  color: var(--ink);
  margin-bottom: var(--space-6);
}
.faq-item {
  margin-bottom: 0;
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--border);
}
.faq-item:last-child { border-bottom: none; }
.faq-item h3 {
  font-size: 15px;
  color: var(--ink);
  margin-bottom: var(--space-1);
  font-weight: 600;
}
.faq-item p {
  font-size: 14px;
  color: var(--ink-secondary);
  line-height: 1.6;
}
```

**Why:** Ruled lines between FAQ items (like a legal document Q&A section) instead of stacked blocks. (Principle 2: "ledger paper rules")

---

### 6N. Email Gate Card

**CSS change:**
```css
.gate-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  margin-top: var(--space-5);
  text-align: center;
  border-top: 3px solid var(--accent);  /* Amber top accent */
}
.gate-card h3 {
  font-family: var(--font-heading);
  font-size: 22px;
  margin-bottom: var(--space-2);
  color: var(--ink);
}
.gate-card > p {
  font-size: 14px;
  color: var(--ink-secondary);
  margin-bottom: var(--space-5);
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}
#gate-form input {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
  font-family: var(--font-body);
}
#gate-form input:focus { border-color: var(--accent); }  /* Amber focus ring */
#gate-submit {
  padding: 14px;
  background: var(--accent);
  color: #FFFFFF;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
#gate-submit:hover { background: var(--accent-hover); }
#gate-submit:disabled { background: var(--ink-tertiary); cursor: default; }
.gate-fine-print {
  font-size: 11px;
  color: var(--ink-tertiary);
  margin-top: var(--space-3);
}
```

**Why:** Amber top border draws the eye to the conversion point. Focus rings match accent color instead of default browser blue. (Principle 3: Accent = conversion moments)

---

### 6O. Footer

```css
.site-footer {
  margin-top: var(--space-16);
  padding-top: var(--space-6);
  border-top: 2px solid var(--ink);
  text-align: center;
  font-size: 12px;
  color: var(--ink-tertiary);
}
.site-footer a { color: var(--ink-secondary); text-decoration: none; }
.site-footer a:hover { color: var(--ink); }
```

**Why:** Matching the header's 2px rule creates visual bookends -- "this is a complete document." (Principle 2: "document weight")

---

### 6P. Loading Spinner

```css
.spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto var(--space-5);
}
#loading-status { color: var(--ink-secondary); font-size: 16px; }
```

---

### 6Q. Home Details Section

```css
.home-details-toggle {
  width: 100%;
  padding: 12px 16px;
  background: var(--surface-alt);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-secondary);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.home-details-toggle:hover {
  background: var(--accent-surface);
  border-color: var(--accent);
  color: var(--accent);
}
.home-details-fields {
  padding: var(--space-4);
  background: var(--surface-alt);
  border: 1px solid var(--border-strong);
  border-top: none;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}
.field-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.field-group input,
.field-group select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--ink);
  background: var(--surface);
  font-family: var(--font-body);
}
.field-group input:focus,
.field-group select:focus {
  border-color: var(--accent);
  outline: none;
}
```

**Why:** Form labels in uppercase with letter-spacing feel like form field labels on a government or financial document. Focus states use amber. (Principle 2: "appraisal document")

---

## 7. Visual Elements and Imagery

### 7A. Subtle Background Pattern

Add a very faint grid/dot pattern to the canvas to reinforce the "graph paper" / "architectural plan" feel:

```css
body {
  /* existing styles, plus: */
  background-image: radial-gradient(circle, #E8E6E1 0.5px, transparent 0.5px);
  background-size: 24px 24px;
  background-position: 0 0;
}
```

This creates a barely-visible dot grid (like engineering paper) that adds texture without visual noise. Test at multiple screen sizes -- it should be nearly invisible but create a subtle "this is a precise document" feeling.

### 7B. Card Shadows (Depth)

Instead of flat cards with only borders, add a subtle shadow to create the "paper on desk" layering:

```css
.step, .trust-card, .gate-card, .drop-zone {
  box-shadow: 0 1px 2px rgba(28, 28, 26, 0.04), 0 1px 4px rgba(28, 28, 26, 0.02);
}
```

This is extremely subtle -- just enough to create the impression of paper depth without looking like Material Design elevation.

### 7C. Section Divider Pattern

Between major sections (Colorado callout, How It Works, Trust), use a subtle horizontal rule with a center dot accent:

```css
.section-divider {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: var(--space-12) 0;
}
.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.section-divider::after { content: ''; }
.divider-dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
}
```

```html
<div class="section-divider"><span class="divider-dot"></span></div>
```

This is optional but adds the "printed document section break" feel.

### 7D. NO Stock Photography

Do not add stock photos of solar panels, happy homeowners, or Colorado mountains. The absence of imagery is actually a strength for this aesthetic -- financial documents and Bloomberg terminals do not have hero images. The authority comes from typography, data, and whitespace.

If we ever add imagery, it should be:
- Data visualizations (charts from the actual report)
- A single hero illustration in a minimal line-drawing style matching the icon language
- NEVER stock photography

---

## 8. Favicon Update

The current favicon uses `#2563eb` blue. Update to match the new palette:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1C1C1A"/>
  <path d="M8 22L16 6l8 16H8z" fill="#D97706" stroke="#FAFAF7" stroke-width="1"/>
  <circle cx="16" cy="15" r="3" fill="#FAFAF7"/>
  <line x1="16" y1="9" x2="16" y2="11" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="20.5" y1="11" x2="19.2" y2="12.5" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="11.5" y1="11" x2="12.8" y2="12.5" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="22" y1="15" x2="20" y2="15" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="10" y1="15" x2="12" y2="15" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M10 21h12" stroke="#FAFAF7" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

Dark charcoal background with amber solar icon and cream strokes. Matches the new identity.

---

## 9. Mobile Considerations

### Breakpoint: 600px and below

```css
@media (max-width: 600px) {
  :root {
    /* Slightly tighter spacing on mobile */
  }

  #app {
    padding: var(--space-6) var(--space-4);
  }

  h1 {
    font-size: 28px;     /* Down from 36px */
    line-height: 1.2;
  }

  .subtitle {
    font-size: 15px;
  }

  .trust-bar {
    flex-direction: column;
    gap: 4px;
    text-align: center;
  }
  .trust-sep { display: none; }

  .social-proof {
    flex-direction: column;
    gap: 6px;
    text-align: center;
  }
  .proof-sep { display: none; }

  .dual-upload { grid-template-columns: 1fr; }

  .tab {
    font-size: 12px;
    padding: 8px 6px;
  }

  .callout-list {
    /* Already single column -- no change needed */
  }

  .steps-grid { grid-template-columns: 1fr; }

  .trust-grid { grid-template-columns: 1fr; }

  .home-details-grid { grid-template-columns: 1fr 1fr; }

  .site-header {
    margin-bottom: var(--space-6);
    padding-bottom: var(--space-4);
  }

  .site-nav { gap: 12px; }
  .site-nav a { font-size: 12px; }

  /* Drop zone should have less padding on mobile */
  .drop-zone { padding: 32px 16px; }

  /* Larger touch targets for mobile */
  #analyze-btn { padding: 18px; font-size: 17px; }
  #gate-submit { padding: 16px; font-size: 16px; }

  /* Background dot pattern too subtle on mobile, remove */
  body { background-image: none; }

  /* FAQ items need more breathing room on mobile */
  .faq-item { padding: var(--space-5) 0; }
}

/* Intermediate breakpoint for tablets */
@media (max-width: 768px) and (min-width: 601px) {
  h1 { font-size: 32px; }
  .steps-grid { grid-template-columns: 1fr 1fr; }
}
```

### Mobile-Specific Notes:
- Remove the dot grid background on mobile (too subtle to be intentional, just looks noisy)
- Increase button padding for touch targets (minimum 44px tap target)
- Trust bar and social proof stack vertically
- Colorado callout is already single-column in the new design
- Steps grid collapses to single column
- All font sizes stay readable (minimum 13px for any body text)

---

## 10. Report Page Alignment

The generated HTML reports (`src/report/template*.html`) should adopt the same design tokens. Key changes:

1. Add the same Google Fonts link
2. Use `--font-heading` for report title and section headers
3. Use `--accent` (`#D97706`) for the grade badges, key metrics highlights
4. Use `--canvas` (`#FAFAF7`) as report background
5. Use `--surface` (`#FFFFFF`) for data cards
6. Use `--border` (`#E8E6E1`) for table rules and card borders
7. Replace any `#3b82f6` blue with `--accent` amber or `--ink` charcoal

This ensures the report feels like a continuation of the same document, not a different website.

---

## 11. Implementation Order

Execute in this order to avoid breaking changes:

1. **Add Google Fonts link** to `<head>` in `index.html`
2. **Add SVG icon sprite** to top of `<body>` in `index.html`
3. **Replace CSS custom properties and global styles** (top of `styles.css`)
4. **Update header and typography** (h1, h2, subtitle, body text)
5. **Update color references** section by section (tabs, drop zones, buttons)
6. **Replace emoji icons with SVG** in HTML (drop zones, callout items)
7. **Update Colorado callout** from grid to list layout
8. **Add trust card icons** in HTML
9. **Update favicon.svg**
10. **Update report templates** to match new tokens
11. **Test all states:** hover, active, focus, loading, error, file-selected, email gate
12. **Mobile test** at 375px (iPhone SE), 390px (iPhone 14), 768px (iPad)

---

## 12. Summary: Before vs. After

| Aspect              | Before                              | After                                      |
|---------------------|-------------------------------------|--------------------------------------------|
| Typeface            | System sans-serif                   | DM Serif Display + Inter                   |
| Primary color       | #3b82f6 generic SaaS blue           | #D97706 mesa amber (accent only)           |
| Background          | #f8fafc cool blue-gray              | #FAFAF7 warm cream                         |
| Text color          | #0f172a cool slate                  | #1C1C1A warm charcoal                      |
| Icons               | Emoji (&#9889;&#128196;&#128176;)   | Stroke SVGs, 1.5px weight                  |
| Card treatment      | Flat white, light border            | White on cream, subtle shadow, paper depth  |
| Section dividers    | 1px light gray                      | 2px dark (header/footer), 1px with amber dot|
| CTA button          | Blue (#3b82f6)                      | Amber (#D97706)                            |
| Form focus ring     | Blue                                | Amber                                      |
| Overall feel        | "SaaS template"                     | "Financial prospectus on cotton stock"     |
| Emotional response  | "Another free tool"                 | "This is serious. I trust this."           |
