# Dynamic Boat Response: Gust, Lull & Wind Shift Compensation

A unified vessel inertia and dynamic acceleration model for the SignalK Polar Performance Plugin. This eliminates erratic jumping of polar performance percentages during wind gusts, lulls, and wind shifts (lifts and headers to faster or slower angles) by modeling the physical time lag required for the hull to reach new steady-state polar targets.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Direction from User Clarifications:**
> - **Unified Mechanism for TWS and TWA**: When the wind gusts/drops (TWS changes) or shifts to a faster/slower angle (TWA changes), the steady-state target $V_{\text{polar}}(TWS, TWA)$ changes immediately. The dynamic target $V_{\text{target, dynamic}}$ will continuously track this target via the vessel inertia time constant ($\tau_{\text{boat}}$).
> - **No Artificial Tack/Gybe Special Cases**: The user confirmed that competent crews steer with shifts and adjust course; an unexpected tack from a massive unadjusted shift can be ignored. A clean, continuous inertia equation governs all angle and speed transitions seamlessly.
> - **Single Configurable Time Constant**: A single response time constant $\tau_{\text{boat}}$ (default 18 seconds, range 5s–60s) governs both acceleration and deceleration phases.
> - **Decoupled Input Filtering**: Wind vector damping and boat speed damping are decoupled so sensor noise can be tuned independently of hull momentum.

---

### 1. Overview & Core Concept

- **The Problem**: A sailboat's polar table specifies equilibrium boat speed under steady-state conditions. In real sailing:
  1. **Gusts & Lulls (TWS)**: True wind speed jumps or drops in seconds. Polar target speed immediately jumps, but the hull requires 15–30 seconds of acceleration or deceleration to catch up. Polar performance ($BSP / V_{\text{polar}}$) artificially plummets at gust onset, then spikes above 100% in a lull.
  2. **Wind Shifts (TWA)**: When a wind shift occurs (e.g. bearing away into a reach where polar speed is 8 knots, or pinching up where polar speed is 6 knots), the steady-state target steps instantly, but the boat takes time to accelerate or bleed off speed.
- **The Solution**: Maintain a dynamic polar target $V_{\text{target, dynamic}}(t)$ updated continuously via:
  $$\tau_{\text{boat}} \frac{d V_{\text{target, dynamic}}}{dt} + V_{\text{target, dynamic}} = V_{\text{polar}}(TWS, TWA)$$
  In discrete time:
  $$V_{\text{target, dynamic}}[t] = V_{\text{target, dynamic}}[t - \Delta t] + \left(1 - e^{-\Delta t / \tau_{\text{boat}}}\right) \cdot \left(V_{\text{polar}}(TWS, TWA) - V_{\text{target, dynamic}}[t - \Delta t]\right)$$
- **Key Value**: Polar performance reflects genuine sailing and trimming efficiency, eliminating false drops and false spikes without requiring sluggish 0.008 Kalman gains that deaden raw instruments.

---

### 2. User Experience & Visual Design

#### 1. Inputs Tab Controls
The *Inputs* tab receives a dedicated **Dynamic Boat Response & Vessel Inertia** card:
- **Enable Dynamic Response**: Toggle switch (`ON` / `OFF`, default `ON`).
- **Hull Response Time ($\tau$)**: Numeric input and slider in seconds (5.0s to 60.0s, default 18.0s).
- **Vessel Type Presets**: Quick-select buttons:
  - `Light / Sportsboat` (8s)
  - `Club Racer (30–40ft)` (18s)
  - `Cruiser / Heavy Displacement` (32s)
- **Decoupled Sensor Damping**: Separate controls for:
  - **Wind Vector Damping** (smoother type & parameter)
  - **Boat Speed Damping** (smoother type & parameter)

#### 2. Overview Tab & Plotter
- **Live Performance Metrics**: Displays actual speed, steady-state polar speed, dynamic target speed, and stabilized polar performance ratio.
- **Visual Feedback**: When a gust hits or a shift opens up the angle, the user sees the dynamic target smoothly track toward the new steady-state target at the vessel's natural acceleration pace.

```
+-------------------------------------------------------------------------+
| POLAR PERFORMANCE - INPUTS                                              |
+-------------------------------------------------------------------------+
| SENSOR DAMPING                                                          |
| Smoother Type          [ Kalman                          v ]            |
| Wind Damping Gain      [ - ] [ 0.040 ] [ + ]                            |
| Boat Speed Damping Gain[ - ] [ 0.040 ] [ + ]                            |
+-------------------------------------------------------------------------+
| DYNAMIC BOAT RESPONSE (GUST, LULL & WIND SHIFT COMPENSATION)             |
| Dynamic Response       [ ON  / off ]                                    |
| Vessel Presets         [ Light (8s) ] [ Racer (18s) ] [ Cruiser (32s) ] |
| Hull Response Time     [ - ] [ 18.0 s ] [ + ]                           |
| Tracks Changes In      (x) Gusts & Lulls (TWS)   (x) Wind Shifts (TWA)  |
+-------------------------------------------------------------------------+
```

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Continuous First-Order Differential vs. Step Approximations**
  - *Chosen Approach*: Continuous exponential lag model updated with exact elapsed time $\Delta t$ on each delta.
  - *Why*: Sample arrival rates from SignalK can vary from 1 Hz to 10 Hz; integrating with elapsed $\Delta t$ guarantees identical, time-consistent behavior regardless of sensor update frequency.
- **Decision 2: Unified Handling of TWS and TWA**
  - *Chosen Approach*: Feed the steady-state polar lookup $V_{\text{polar}}(TWS, TWA)$ as the driving input to the dynamic target integrator.
  - *Why*: A boat's kinetic energy and hydrodynamic drag respond to the delta between actual velocity and equilibrium velocity, regardless of whether the equilibrium changed due to wind strength (TWS) or wind direction (TWA).
- **Decision 3: Retaining Steady Polar in Output Metadata**
  - *Chosen Approach*: Compute and expose both `performance.targetSpeed` (dynamic active target) and `performance.polarSpeed` (instantaneous steady-state), plus a dedicated indicator `performance.dynamicTargetSpeed`.
  - *Why*: Allows plotters and tactical displays to optionally show both instantaneous ceiling and current dynamic expectation.

---

### 4. Technical Architecture & Data Strategy

```
  +------------------+         +--------------------+
  | Wind Delta       |         | Boat Speed Delta   |
  | (speedTrue, TWA) |         | (speedThroughWater)|
  +--------+---------+         +---------+----------+
           |                             |
           v                             v
  +------------------+         +--------------------+
  | Wind Smoother    |         | BSP Smoother       |
  | (Vector Damping) |         | (Speed Damping)    |
  +--------+---------+         +---------+----------+
           |                             |
           v                             |
  +--------------------------------+     |
  | Steady Polar Lookup            |     |
  | V_polar = f(TWS_smooth,        |     |
  |             TWA_smooth)        |     |
  +----------------+---------------+     |
                   |                     |
                   v                     |
  +--------------------------------+     |
  | Dynamic Boat Response Engine   |     |
  | dV_dyn/dt = (V_polar-V_dyn)/tau|     |
  +----------------+---------------+     |
                   |                     |
                   v                     v
         +----------------------------------+
         | Performance Calculation Engine   |
         | Ratio = BSP / V_target,dynamic   |
         | Outputs: targetSpeed, ratio, etc.|
         +-----------------+----------------+
                           |
                           v
         +----------------------------------+
         | SignalK Bus & REST Endpoints     |
         | (/live, /status, /settings)      |
         +----------------------------------+
```

#### Detailed Execution Steps
1. **Plugin Core (`plugin/index.js`)**:
   - Add new settings to `DEFAULT_SETTINGS`:
     - `dynamicResponseEnabled`: `true`
     - `vesselResponseTau`: `18.0` (seconds)
     - `windSmootherParamKalman`: `0.04` (separate from BSP)
     - `bspSmootherParamKalman`: `0.04`
     - `windSmootherParamTau`: `2.0` (for exponential)
     - `bspSmootherParamTau`: `2.0`
   - Implement `DynamicTargetModel` class:
     - Maintains current dynamic speed and last update timestamp.
     - Steps with `(1 - Math.exp(-dt / tau)) * (target - current)`.
     - Provides instant bootstrap on first polar lock or after prolonged idle periods.
   - Update computation loop to calculate dynamic target and update performance ratio `BSP / dynamicTarget`.
2. **REST Endpoints (`plugin/index.js`)**:
   - `/settings` and `PUT /settings`: Accept and validate new dynamic response and decoupled damping parameters.
   - `/live` and `/status`: Include `dynamicTargetSpeed`, `steadyPolarSpeed`, and `performance`.
3. **Frontend (`public/app.js` and `public/index.html`)**:
   - Add Dynamic Boat Response card with enable switch, presets, and tau slider.
   - Add separate wind and boat speed damping controls on Inputs page.
   - Update Overview page metrics and canvas to display stabilized performance.
4. **Validation & Verification**:
   - Run unit test suite (`npm test`).
   - Run simulation test validating that during sudden 6 kt wind gusts or 20° TWA shifts, dynamic target ramps smoothly and performance percentage remains stable around 100%.
   - Verify compilation (`compile_applet`).
