# Smart Right-Click

An **in-page intelligence layer for the web**.

Smart Right-Click turns any highlighted text into an instant research surface. Instead of sending users to a separate results page, it injects a premium same-page overlay directly into the current tab, letting them analyze people, places, companies, and topics without breaking context.

Highlight text.  
Right-click.  
Analyze instantly.

---

## Why It Matters

Most browser workflows still force users into a disruptive loop:

1. copy text  
2. open a new tab  
3. search manually  
4. compare sources  
5. come back to the original page  

Smart Right-Click removes that loop.

It brings structured context, summary data, and on-demand news signals into the page the user is already viewing, creating a faster and more immersive way to research what matters.

---

## Core Product Idea

This extension is built around a simple belief:

> the browser should understand what the user is looking at, and respond in place

Instead of behaving like a traditional extension popup or redirect flow, Smart Right-Click injects a cinematic overlay into the active webpage and turns the selected text into a live intelligence panel.

That same-page experience is the core product.

---

## What It Does

When a user highlights text and clicks **Analyze Selection**, the extension:

- captures the selected text from the page
- classifies the selection into a lightweight entity type
- injects a full-screen overlay into the current webpage
- fetches summary information from Wikipedia
- fetches structured fields from Wikidata when available
- displays an image, data card, and description in a premium UI
- scans negative-news style signals on demand using connected news providers
- opens results in a right-side animated drawer without leaving the page

---

## Product Experience

### 1. Same-Page Overlay Injection
The primary UX is an in-page overlay, not a separate tab.

Users stay inside the page they were already reading while the extension renders a structured intelligence view over that content.

### 2. Contextual Summary
Wikipedia provides a quick intro summary and image support when available.

### 3. Structured Entity Data
Wikidata powers the dynamic data card, allowing the UI to show useful fields such as:
- nationality
- occupation
- residence
- education
- awards
- official website

### 4. On-Demand News Scanner
Users can trigger **Scan Negative News** to pull recent signals from configured news APIs. Results open in an animated right-side drawer and are labeled by source/provider.

### 5. Premium Interface
The extension is designed as a product experience, not a developer utility:
- glassmorphism panels
- animated transitions
- cinematic lighting/orbs
- responsive same-page layout
- drawer-based expansion
- reduced-motion friendly behavior

---

## Why This Is Different

Most browser extensions either:
- open a popup
- redirect to a results page
- show minimal utility UI

Smart Right-Click instead behaves like an **intelligence layer embedded into the browsing experience**.

That changes the feel of the product completely:
- faster workflow
- better context retention
- less tab switching
- more immersive analysis
- stronger perceived product quality

---

## Demo

<video src="demo/smart-right-click-demo.mp4" controls width="100%"></video>

If the embedded video does not render in GitHub view, open it directly:

[demo/smart-right-click-demo.mp4](demo/smart-right-click-demo.mp4)

---

## How It Works

### User Flow

1. Highlight text on any webpage
2. Right-click
3. Choose **Analyze Selection**
4. Overlay is injected into the same page
5. Summary + structured data load into the overlay
6. User optionally clicks **Scan Negative News**
7. Drawer opens with aggregated news results

---

## Architecture

### `manifest.json`
Defines the extension as a Manifest V3 browser extension with:
- context menu access
- scripting support
- tab access
- storage access
- required host permissions for external providers

### `background.js`
Acts as the service worker and orchestration layer.

Responsibilities:
- creates the context menu item
- captures selected text
- creates the request payload
- stores payload in session storage
- injects the same-page overlay
- handles provider requests for Wikipedia, Wikidata, and news APIs
- falls back when injection is not allowed

### `contentScript.js`
Owns the primary product experience.

Responsibilities:
- renders the injected overlay
- controls overlay interactions
- manages image, summary, card, and drawer states
- sends background messages for external data
- keeps the UX inside the current page

### `overlay.css`
Defines the visual language of the in-page interface.

Responsibilities:
- scoped overlay styling
- responsive layout
- animation system
- premium dark/violet UI
- drawer transitions
- image/data card presentation

### `results.html`, `results.js`, `results.css`
Legacy fallback interface.

These files are **not the main product flow anymore**.

They exist only as a fallback for cases where the browser blocks same-page injection, such as protected browser pages.

---

## File Tree

```text
smart-right-click/
  manifest.json
  background.js
  contentScript.js
  overlay.css
  results.html
  results.js
  results.css
  config.example.js
  demo/
    smart-right-click-demo.mp4
  icons/
    icon16.png
    icon48.png
    icon128.png
  NOTICE.md
  README.md
