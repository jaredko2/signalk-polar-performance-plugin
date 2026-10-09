# Exact Changes: Steer-to-Target & B&G Zeus3S Integration

Clarification of what `signalk-polar-performance-plugin` already computes vs. the exact changes and fixes needed to get Target TWA & Target Speed onto the B&G Zeus3S via `signalk-bandg-performance-plugin`.

---

### What Is Already In Place vs. What Is Changing

| Metric / Feature | Current State | Specific Change Needed |
| :--- | :--- | :--- |
| **`performance.targetAngle`** (Target TWA) | Already computed (when `settings.targetTWA` is on) | Kept as-is. Set default to **ON** when B&G output is requested. |
| **`performance.targetSpeed`** (Target BSP) | **Buggy dependency**: currently only emitted if `settings.polarSpeed` is ON (lines 513–527) | **Decouple**: emit `performance.targetSpeed` directly when `settings.targetTWA` is enabled. |
| **`performance.optimumWindAngle`** | Already computed (when `settings.optimumWindAngle` is on) | Kept as-is. Feeds B&G "Optimum Wind Angle" field. |
| **`performance.targetSpeedDelta`** | **Not implemented** | **Add**: compute $BSP - V_{\text{target}}$ in m/s so users have a numeric +/- kn speed error on mast/cockpit displays. |
| **`performance.targetAngleDelta`** | **Not implemented** | **Add**: compute signed error between current TWA and target TWA in rad/deg. |
| **Vision 444 Preset (12s)** | **Not implemented** | **Add**: 12.0s one-click preset for dynamic boat acceleration on the Inputs tab. |
| **Zeus3S Integration Guide** | **Not implemented** | **Add**: interactive checklist on Outputs tab showing exact Signal K paths and Zeus3S menu steps. |

---

### Why It Wasn't Showing on Your Zeus3S:
1. **Disabled by default**: `targetTWA`, `polarSpeed`, and `optimumWindAngle` were all defaulted to `false` in the plugin configuration.
2. **Hidden dependency**: `performance.targetSpeed` was nested inside `if (settings.polarSpeed)`. If you enabled Target TWA without also enabling Polar Speed, `targetSpeed` was never broadcast on the Signal K bus.
3. **Signal K to B&G Translation**: `signalk-bandg-performance-plugin` requires these specific paths to populate B&G PGN 130824.

---

### Step-by-Step Implementation Plan

#### 1. Code Fixes in `plugin/index.js`
* Decouple `performance.targetSpeed` so it publishes whenever `targetAngle` is calculated and `settings.targetTWA` is active.
* Add calculation and publishing of:
  - `performance.targetSpeedDelta` ($BSP - V_{\text{target}}$ in m/s)
  - `performance.targetAngleDelta` ($TWAsigned - targetAngle$ in rad)
* Ensure dynamic vessel response is respected when computing target speed deltas.

#### 2. Settings & Presets in `public/app.js` and `plugin/index.js`
* Add **Vision 444 (12s)** button to the Dynamic Boat Response preset bar on the **Inputs** tab.
* Add new output toggles for `targetSpeedDelta` and `targetAngleDelta` on the **Outputs** tab.
* Add a **B&G Zeus3S / Instrument Guide** panel on the Outputs tab explaining the exact mapping to `signalk-bandg-performance-plugin` and Zeus3S menus.

#### 3. Overview Dashboard Updates
* Add live **Target Speed Delta** (kn) and **Target Angle Delta** (°) indicators to the Live Performance table on the **Overview** tab.

#### 4. Automated Tests
* Add unit tests verifying `performance.targetSpeed` publishes independently of `polarSpeed`, and tests for `targetSpeedDelta` and `targetAngleDelta`.
