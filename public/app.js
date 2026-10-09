// app.js — Polar Performance Plugin webapp
// Pages: Overview | Inputs | Outputs
// The active polar and performance factor are selected in a separate polar
// management webapp (e.g. signalk-polar-management) and read here via SK paths
// — this webapp only displays them, it does not manage polar storage/selection.
// No build step. Uses window.PolarCanvas from polar-canvas.js (loaded before this module).
// Live data is updated in-place every second — DOM is only rebuilt on page switch.

'use strict'

const API = '/plugins/signalk-polar-performance-plugin'

// ── Unit conversion ───────────────────────────────────────────────────────────
let meta = {}

const SPEED_DEFAULT = { formula: 'value * 1.943844',          symbol: 'kn', displayFormat: '0.0' }
const ANGLE_DEFAULT = { formula: 'value * 57.29577951308231', symbol: '°',  displayFormat: '0'   }
const RATIO_DEFAULT = { formula: 'value * 100',               symbol: '%',  displayFormat: '0.1' }

function isSafeFormula(f) {
  return typeof f === 'string' && /^[\d\s+\-*/.()eE]*$/.test(f.replace(/\bvalue\b/g, '0'))
}

const _fmtCache = new Map()
function getConverter(displayUnits) {
  if (!displayUnits || !isSafeFormula(displayUnits.formula)) return null
  const key = displayUnits.formula + '|' + (displayUnits.symbol || '') + '|' + (displayUnits.displayFormat || '')
  if (_fmtCache.has(key)) return _fmtCache.get(key)
  let fn
  try { fn = new Function('value', 'return ' + displayUnits.formula); fn(1) }
  catch (_) { _fmtCache.set(key, null); return null }
  const parts = (displayUnits.displayFormat || '0.0').split('.')
  const decimals = parts.length > 1 ? parts[1].length : 0
  const conv = { fn, symbol: displayUnits.symbol || '', decimals }
  _fmtCache.set(key, conv)
  return conv
}

function fmtVal(value, metaKey, fallback) {
  if (value === null || value === undefined || !Number.isFinite(+value)) return '—'
  const v = +value
  const du = meta[metaKey]?.displayUnits ?? fallback
  const c = getConverter(du)
  if (!c) return v.toFixed(2)
  return c.fn(v).toFixed(c.decimals) + '\u00a0' + c.symbol
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function apiGet(path, opts = {}) {
  try {
    const res = await fetch(API + path, { credentials: 'same-origin' })
    if (!res.ok) {
      if (!(opts.silentStatuses || []).includes(res.status)) showMessage('API error ' + res.status + ': ' + path)
      return null
    }
    return res.json()
  } catch (e) { showMessage('Server unreachable: ' + e.message); return null }
}

async function apiPut(path, body) {
  try {
    const res = await fetch(API + path, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) { showMessage('Save failed: ' + res.status); return null }
    return res.json()
  } catch (e) { showMessage('Save failed: ' + e.message); return null }
}

// Fetch a single scalar value from the SK REST API
// ── Message bar ───────────────────────────────────────────────────────────────
let _msgTimer = null
function showMessage(text) {
  const el = document.getElementById('message')
  if (!el) return
  el.textContent = text
  clearTimeout(_msgTimer)
  _msgTimer = setTimeout(() => { el.textContent = '' }, 5000)
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function sectionHeading(text) {
  const h = document.createElement('h6')
  h.className = 'text-uppercase fw-bold text-muted border-bottom pb-1 mb-2 mt-3 small'
  h.textContent = text
  return h
}

// Set text of a span by id (fast in-place update, no DOM rebuild)
function setVal(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

// Toggle 'stale' class on the <tr> ancestor of an element by id
function setStale(id, stale) {
  const el = document.getElementById(id)
  const row = el?.closest('tr')
  if (row) row.classList.toggle('stale', stale)
}

// Build a two-column table. Each row has { label, id?, control?, desc? }
// When id is provided, a <span id="...">—</span> is placed in the value cell
// for in-place updates via setVal().
function buildTable(rows) {
  const tbl = document.createElement('table')
  tbl.className = 'table table-sm table-borderless mb-0'
  const tbody = document.createElement('tbody')
  rows.forEach(r => {
    const tr = document.createElement('tr')
    if (r.rowClass) tr.className = r.rowClass
    const tdL = document.createElement('td')
    tdL.textContent = r.label
    if (r.desc) {
      const s = document.createElement('small'); s.className = 'text-muted d-block'; s.textContent = r.desc
      tdL.appendChild(s)
    }
    const tdV = document.createElement('td')
    if (r.id) {
      const span = document.createElement('span'); span.id = r.id; span.textContent = '—'
      tdV.appendChild(span)
    } else if (r.control) {
      tdV.appendChild(r.control)
    }
    tr.appendChild(tdL); tr.appendChild(tdV)
    tbody.appendChild(tr)
  })
  tbl.appendChild(tbody)
  return tbl
}

function createToggle(checked, onChange) {
  const lbl = document.createElement('label')
  lbl.className = 'switch switch-text switch-primary mb-0'
  const cb = document.createElement('input')
  cb.type = 'checkbox'; cb.className = 'switch-input form-check-input'; cb.checked = !!checked
  cb.addEventListener('change', () => onChange(cb.checked))
  const sl = document.createElement('span')
  sl.className = 'switch-label'; sl.setAttribute('data-on', 'On'); sl.setAttribute('data-off', 'Off')
  const sh = document.createElement('span'); sh.className = 'switch-handle'
  lbl.appendChild(cb); lbl.appendChild(sl); lbl.appendChild(sh)
  return lbl
}

function createNumberInput(key, value, opts, showRevert, onSaved) {
  const wrap = document.createElement('span')
  const inp = document.createElement('input')
  inp.type = 'number'
  inp.className = 'form-control form-control-sm d-inline-block'
  inp.style.width = '90px'
  inp.value = value !== undefined ? value : (opts.default ?? '')
  if (opts.min  !== undefined) inp.min  = opts.min
  if (opts.max  !== undefined) inp.max  = opts.max
  if (opts.step !== undefined) inp.step = opts.step
  const revertBtn = document.createElement('button')
  revertBtn.className = 'btn btn-link btn-sm p-0 ms-1'
  revertBtn.title = `Reset to default (${opts.default})`
  revertBtn.textContent = '↺'
  revertBtn.style.display = (showRevert && opts.default !== undefined && value !== opts.default) ? '' : 'none'
  revertBtn.addEventListener('click', () => {
    apiPut('/settings', { [key]: opts.default }).then(s => {
      if (s) { settings = s; inp.value = opts.default; revertBtn.style.display = 'none' }
    })
  })
  inp.addEventListener('change', () => {
    const v = Number(inp.value)
    if (!Number.isFinite(v)) return
    apiPut('/settings', { [key]: v }).then(s => {
      if (s) {
        settings = s
        revertBtn.style.display = (showRevert && opts.default !== undefined && v !== opts.default) ? '' : 'none'
        if (typeof onSaved === 'function') onSaved(s)
      }
    })
  })
  wrap.appendChild(inp); wrap.appendChild(revertBtn)
  return wrap
}

// Update warnings container in-place. Skips DOM write when content unchanged.
function updateWarnings(el, items) {
  if (!el) return
  const key = items.join('\n')
  if (el._lastKey === key) return
  el._lastKey = key
  el.innerHTML = ''
  if (!items.length) return
  el.appendChild(sectionHeading('Warnings'))
  const ul = document.createElement('ul')
  ul.className = 'list-unstyled text-danger small ps-3 mb-0'
  items.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li) })
  el.appendChild(ul)
}

// ── App state ─────────────────────────────────────────────────────────────────
let liveData     = null  // from /live — smoothed values (tws, twa, bsp, polarSpeed, performance)
let statusData   = null  // from /status — raw inputs + computed outputs
let rawValues    = {}    // raw sensor values from /status, keyed by short name (tws/twa/bsp/hdg)
let waveValues   = {}    // wave sensor values from /status and /live (signalk-wave-estimator)
let outputValues = {}    // computed output values from /status, keyed by SK path string
let settings     = null
let lifecycleWarnings = []

// Canvas state
let polar          = null
let twsList        = []
let curves         = {}
let libraryVersion = ''
let liveTws        = null
let liveCurve      = null
const STEP = (2 * Math.PI / 180).toFixed(6)

let activePage = 'overview'

// ── Output path definitions ───────────────────────────────────────────────────
const OUTPUT_DEFS = [
  { key: 'beatAngle',        label: 'Beat & run angles',
    paths: [
      { sk: 'performance/beatAngle',  label: 'Beat angle',           mk: 'twa',         fb: ANGLE_DEFAULT },
      { sk: 'performance/gybeAngle',  label: 'Gybe angle',           mk: 'twa',         fb: ANGLE_DEFAULT },
    ]},
  { key: 'beatVMG',          label: 'Beat & run VMG',
    paths: [
      { sk: 'performance/beatAngleVelocityMadeGood', label: 'Beat VMG',  mk: 'bsp', fb: SPEED_DEFAULT },
      { sk: 'performance/gybeAngleVelocityMadeGood', label: 'Gybe VMG',  mk: 'bsp', fb: SPEED_DEFAULT },
    ]},
  { key: 'targetTWA',        label: 'Target TWA & VMG',
    paths: [
      { sk: 'performance/targetAngle',              label: 'Target angle', mk: 'twa', fb: ANGLE_DEFAULT },
      { sk: 'performance/targetVelocityMadeGood',    label: 'Target VMG',   mk: 'bsp', fb: SPEED_DEFAULT },
    ]},
  { key: 'optimumWindAngle', label: 'Optimum wind angle',
    paths: [
      { sk: 'performance/optimumWindAngle', label: 'Optimum angle',  mk: 'twa',         fb: ANGLE_DEFAULT },
    ]},
  { key: 'VMG',              label: 'VMG & polar VMG',
    paths: [
      { sk: 'performance/velocityMadeGood',              label: 'VMG',             mk: 'bsp',         fb: SPEED_DEFAULT },
      { sk: 'performance/polarVelocityMadeGood',         label: 'Polar VMG',       mk: 'bsp',         fb: SPEED_DEFAULT },
      { sk: 'performance/polarVelocityMadeGoodRatio',    label: 'Polar VMG ratio', mk: 'performance', fb: RATIO_DEFAULT },
    ]},
  { key: 'polarSpeed',        label: 'Polar speed & ratio',
    paths: [
      { sk: 'performance/polarSpeed',         label: 'Steady-state polar speed', mk: 'bsp', fb: SPEED_DEFAULT },
      { sk: 'performance/dynamicTargetSpeed', label: 'Dynamic target speed',     mk: 'bsp', fb: SPEED_DEFAULT },
      { sk: 'performance/targetSpeed',        label: 'Target boat speed',        mk: 'bsp', fb: SPEED_DEFAULT },
      { sk: 'performance/polarSpeedRatio',    label: 'Speed ratio',              mk: 'performance', fb: RATIO_DEFAULT },
    ]},
  { key: 'waveCorrection',    label: 'Sea-state wave correction',
    paths: [
      { sk: 'performance/polarSpeedSeaState',    label: 'Sea-state polar speed', mk: 'bsp',         fb: SPEED_DEFAULT },
      { sk: 'performance/wavePerformanceFactor', label: 'Wave factor (multiplier)', mk: 'performance', fb: RATIO_DEFAULT },
      { sk: 'performance/waveDragPenalty',        label: 'Wave drag penalty',       mk: 'performance', fb: RATIO_DEFAULT },
    ]},
  { key: 'maxSpeed',         label: 'Max polar speed',
    paths: [
      { sk: 'performance/maxSpeed',      label: 'Max speed',         mk: 'bsp',         fb: SPEED_DEFAULT },
      { sk: 'performance/maxSpeedAngle', label: 'Max speed angle',   mk: 'twa',         fb: ANGLE_DEFAULT },
    ]},
  { key: 'tackTrue',         label: 'Opposite tack heading',
    paths: [
      { sk: 'performance/tackTrue',     label: 'Tack heading',       mk: 'twa',         fb: ANGLE_DEFAULT },
    ]},
  { key: 'smoothedInputs',   label: 'Smoothed inputs',
    paths: [
      { sk: 'environment/wind/angleTrueWaterDamped', label: 'True wind angle (smoothed)', mk: 'twa', fb: ANGLE_DEFAULT },
      { sk: 'performance/boatSpeedDamped',           label: 'Boat speed (smoothed)',      mk: 'bsp', fb: SPEED_DEFAULT },
    ]},
]

// Unique SK path id used as DOM element id (slashes → dashes)
function skId(sk) { return 'out-' + sk.replace(/\//g, '-') }

// ── Data loaders ──────────────────────────────────────────────────────────────
async function loadMeta() {
  const m = await apiGet('/meta')
  if (m) { meta = m; if (polar) polar.setMeta(meta) }
}

async function refreshSettings() {
  const s = await apiGet('/settings')
  if (s) settings = s
}

async function refreshLibrary() {
  const newList = await apiGet('/polar/axes/tws', { silentStatuses: [404] })
  if (!newList) {
    // No active polar — clear any previously displayed curves
    if (libraryVersion !== '') {
      libraryVersion = ''; twsList = []; curves = {}
      if (polar) polar.setLibraryData([], {}, null)
    }
    return
  }
  const version = JSON.stringify(newList)
  if (version === libraryVersion) return
  libraryVersion = version; twsList = newList; curves = {}
  await Promise.all(twsList.map(async tws => {
    try {
      const c = await apiGet(
        '/polar/queries/curve?tws=' + tws.toFixed(5) + '&step=' + STEP,
        { silentStatuses: [404] }
      )
      if (c) curves[tws] = c
    } catch (_) {}
  }))
  if (polar) polar.setLibraryData(twsList, curves, liveCurve)
}

// Main 1-second refresh: all data from plugin endpoints only
async function refreshLive() {
  // 1. Plugin live snapshot (smoothed wind/bsp + polar state)
  const d = await apiGet('/live')
  if (d) liveData = d

  // 2. Plugin status snapshot (raw inputs + smoothed inputs + outputs)
  const st = await apiGet('/status')
  if (st) {
    statusData = st
    lifecycleWarnings = Array.isArray(st.lifecycleWarnings) ? st.lifecycleWarnings : []
    // Populate rawValues and outputValues from /status for the Inputs/Outputs pages
    if (st.inputs) {
      rawValues.tws = st.inputs.raw.tws
      rawValues.twa = st.inputs.raw.twa
      rawValues.bsp = st.inputs.raw.bsp
      rawValues.hdg = st.inputs.raw.hdg ?? null
      if (st.inputs.waves) {
        waveValues = {
          ...(st.inputs.waves.raw || {}),
          ...(st.inputs.waves.correction || {})
        }
      }
    }
    if (d?.wave) {
      Object.assign(waveValues, d.wave)
    }
    if (st.outputs) {
      const converted = {}
      Object.entries(st.outputs).forEach(([k, v]) => { converted[k.replace(/\./g, '/')] = v })
      Object.assign(outputValues, converted)
    }
  }

  // 3. Update live TWS curve for canvas
  if (liveData && polar) {
    const tws = liveData.tws
    if (tws !== null && (!liveTws || Math.abs(tws - liveTws) > 0.05)) {
      liveTws = tws
      try {
        liveCurve = await apiGet('/polar/queries/curve?tws=' + tws.toFixed(5) + '&step=' + STEP, { silentStatuses: [404] })
      }
      catch (_) {}
    }
    polar.setLiveData(liveData, liveCurve)
  }

  // 4. Tick active page
  _tickActivePage()
}

// ── Polar state warnings ──────────────────────────────────────────────────────
// Returns an array of warning strings based on getInterpolationState() result.
function polarStateWarnings(d) {
  const s = d?.polarState
  if (!s) return []
  const msgs = []
  if (s.tws === 'below_range') msgs.push('Wind speed is below the polar table range — values are extrapolated')
  if (s.tws === 'above_range') msgs.push('Wind speed is above the polar table range — values are extrapolated')
  if (s.twa === 'in_irons')    msgs.push('Sailing in irons — too close to the wind for polar data')
  if (s.twa === 'pinching')    msgs.push('Pinching — sailing closer to wind than the polar beat angle')
  if (s.twa === 'extrapolated') msgs.push('Running deeper than the polar table — values are extrapolated beyond run angle')
  if (s.twa === 'above_range') msgs.push('Wind angle is beyond the polar table range — values are extrapolated')
  return msgs
}

// ── Live-tick dispatcher ──────────────────────────────────────────────────────
function _tickActivePage() {
  if (activePage === 'overview') _tickOverview()
  else if (activePage === 'inputs')  _tickInputs()
  else if (activePage === 'outputs') _tickOutputs()
}

// ── PAGE: Overview ────────────────────────────────────────────────────────────
function _buildOverviewPage() {
  const row = document.createElement('div')
  row.className = 'row g-3'

  // Canvas (left)
  const left = document.createElement('div')
  left.className = 'col-md-6'
  const canvasEl = document.createElement('canvas')
  canvasEl.id = 'polar-canvas'
  canvasEl.className = 'polar-canvas'
  left.appendChild(canvasEl)

  // Live numbers (right) — skeleton built once; values updated in-place via setVal()
  const right = document.createElement('div')
  right.className = 'col-md-6'

  // Active polar — read-only; selected in a separate polar management webapp
  right.appendChild(sectionHeading('Active Polar'))
  const polarInfoDiv = document.createElement('div'); polarInfoDiv.id = 'ov-polar-info'
  right.appendChild(polarInfoDiv)

  // Live Performance header with quick Sea State Derating toggle
  const perfHeader = document.createElement('div')
  perfHeader.className = 'd-flex align-items-center justify-content-between border-bottom pb-1 mb-2 mt-3'
  const perfTitle = document.createElement('h6')
  perfTitle.className = 'text-uppercase fw-bold text-muted mb-0 small'
  perfTitle.textContent = 'Live Performance'
  perfHeader.appendChild(perfTitle)

  const seaStateWrap = document.createElement('div')
  seaStateWrap.className = 'd-flex align-items-center gap-2'
  const seaStateLabel = document.createElement('span')
  seaStateLabel.className = 'text-muted small'
  seaStateLabel.textContent = 'Wave Derating:'
  const seaStateToggle = createToggle(!!settings?.waveCorrectionEnabled, v => {
    apiPut('/settings', { waveCorrectionEnabled: v }).then(s => {
      if (s) { settings = s; switchPage('overview') }
    })
  })
  seaStateWrap.appendChild(seaStateLabel)
  seaStateWrap.appendChild(seaStateToggle)
  perfHeader.appendChild(seaStateWrap)
  right.appendChild(perfHeader)

  right.appendChild(buildTable([
    { label: 'True Wind Speed',        id: 'ov-tws'  },
    { label: 'True Wind Angle',        id: 'ov-twa'  },
    { label: 'Boat Speed',             id: 'ov-bsp'  },
    { label: 'Flat Polar Target',      id: 'ov-pol'  },
    { label: 'Sea-State Target',       id: 'ov-sea-pol', desc: 'Adjusted for added wave resistance' },
    { label: 'Dynamic Target (Active)',id: 'ov-dyn'  },
    { label: 'Performance',            id: 'ov-perf' },
    { label: 'Sea State',              id: 'ov-sea-desc' },
  ]))

  // Targets and warnings — appended lazily by _tickOverview
  const targetsDiv = document.createElement('div'); targetsDiv.id = 'ov-targets'
  const warningsDiv = document.createElement('div'); warningsDiv.id = 'ov-warnings'
  right.appendChild(targetsDiv); right.appendChild(warningsDiv)

  row.appendChild(left); row.appendChild(right)

  if (window.PolarCanvas) {
    polar = new window.PolarCanvas(canvasEl, { showLibrary: false })
  }

  function _applyPolarData() {
    if (!polar) return
    if (Object.keys(meta).length) polar.setMeta(meta)
    if (twsList.length) polar.setLibraryData(twsList, curves, liveCurve)
    if (liveData)       polar.setLiveData(liveData, liveCurve)
  }

  // Use ResizeObserver to resize and redraw the canvas whenever its CSS size
  // changes — this handles both the async CoreUI stylesheet arriving and any
  // later window resize events. We debounce with one RAF so the aspect-ratio
  // constraint has settled before we read offsetWidth.
  if (window.ResizeObserver) {
    let _rafPending = false
    const obs = new ResizeObserver(() => {
      if (_rafPending) return
      _rafPending = true
      requestAnimationFrame(() => {
        _rafPending = false
        if (canvasEl.offsetWidth > 0 && polar) {
          polar.resize()
          _applyPolarData()
          _tickOverview()
        }
      })
    })
    obs.observe(canvasEl)
    row._cleanup = () => {
      obs.disconnect()
      window.removeEventListener('resize', onResize)
    }
  } else {
    // Fallback for browsers without ResizeObserver
    requestAnimationFrame(() => {
      if (polar) polar.resize()
      _applyPolarData()
      _tickOverview()
    })
    row._cleanup = () => window.removeEventListener('resize', onResize)
  }

  const onResize = () => { if (activePage === 'overview' && polar) polar.resize() }
  window.addEventListener('resize', onResize)
  return row
}

function _tickOverview() {
  const d = liveData

  const infoEl = document.getElementById('ov-polar-info')
  if (infoEl) {
    const p = meta?.activePolar
    if (!p) {
      infoEl.innerHTML = ''
      const none = document.createElement('p'); none.className = 'text-muted small mb-2'
      none.textContent = 'No active polar — select one in the polar management webapp.'
      infoEl.appendChild(none)
    } else if (!document.getElementById('ov-polar-name')) {
      infoEl.innerHTML = ''
      infoEl.appendChild(buildTable([
        { label: 'Name',        id: 'ov-polar-name' },
        { label: 'Boat type',   id: 'ov-polar-boatType' },
        { label: 'Sail number', id: 'ov-polar-sailnumber' },
        { label: 'Year',        id: 'ov-polar-year' },
        { label: 'Source',      id: 'ov-polar-source' },
        { label: 'Performance factor', id: 'ov-polar-perf' },
      ]))
    }
    if (p) {
      setVal('ov-polar-name',        p.name || '—')
      setVal('ov-polar-boatType',    p.boatType || '—')
      setVal('ov-polar-sailnumber',  p.sailnumber || '—')
      setVal('ov-polar-year',        p.year ? String(p.year) : '—')
      setVal('ov-polar-source',      p.source || '—')
      setVal('ov-polar-perf',        fmtVal(meta?.performanceFactor, 'performance', RATIO_DEFAULT))
    }
  }

  setVal('ov-tws',  fmtVal(d?.tws,         'tws',         SPEED_DEFAULT))
  setVal('ov-twa',  fmtVal(d?.twa  != null  ? Math.abs(d.twa)  : null, 'twa', ANGLE_DEFAULT))
  setVal('ov-bsp',  fmtVal(d?.bsp,         'bsp',         SPEED_DEFAULT))
  setVal('ov-pol',  fmtVal(d?.polarSpeed,  'polarSpeed',  SPEED_DEFAULT))

  const wave = d?.wave
  const waveActive = !!settings?.waveCorrectionEnabled
  if (waveActive && wave?.polarSpeedSeaState != null) {
    const penStr = (wave.penalty && wave.penalty > 0.001) ? ` (-${(wave.penalty * 100).toFixed(1)}%)` : ''
    setVal('ov-sea-pol', fmtVal(wave.polarSpeedSeaState, 'polarSpeed', SPEED_DEFAULT) + penStr)
  } else {
    setVal('ov-sea-pol', waveActive ? '—' : 'Off (Flat Water)')
  }

  setVal('ov-dyn',  fmtVal(d?.dynamicTargetSpeed ?? d?.polarSpeed, 'polarSpeed', SPEED_DEFAULT))
  setVal('ov-perf', fmtVal(d?.performance, 'performance', RATIO_DEFAULT))

  if (wave?.significantHeight != null) {
    const penStr = (wave.penalty && wave.penalty > 0.001) ? ` · -${(wave.penalty * 100).toFixed(1)}% drag` : ''
    setVal('ov-sea-desc', `${wave.significantHeight.toFixed(2)} m · ${wave.state || 'Active'}${penStr}`)
  } else {
    setVal('ov-sea-desc', wave?.state || '—')
  }

  // Targets — build sub-table on first appearance, then update in-place
  const tEl = document.getElementById('ov-targets')
  if (tEl && (liveCurve?.beat || liveCurve?.run)) {
    if (!document.getElementById('ov-beat-twa')) {
      tEl.appendChild(sectionHeading('Targets'))
      tEl.appendChild(buildTable([
        { label: 'Beat angle', id: 'ov-beat-twa' },
        { label: 'Beat VMG',   id: 'ov-beat-vmg' },
        { label: 'Run angle',  id: 'ov-run-twa'  },
        { label: 'Run VMG',    id: 'ov-run-vmg'  },
      ]))
    }
    setVal('ov-beat-twa', liveCurve?.beat ? fmtVal(liveCurve.beat.twa, 'curve.twa', ANGLE_DEFAULT) : '—')
    setVal('ov-beat-vmg', liveCurve?.beat ? fmtVal(liveCurve.beat.vmg, 'curve.vmg', SPEED_DEFAULT) : '—')
    setVal('ov-run-twa',  liveCurve?.run  ? fmtVal(liveCurve.run.twa,  'curve.twa', ANGLE_DEFAULT) : '—')
    setVal('ov-run-vmg',  liveCurve?.run  ? fmtVal(liveCurve.run.vmg,  'curve.vmg', SPEED_DEFAULT) : '—')
  }

  const warns = []
  if (d?.tws        == null) warns.push('True wind speed — no data (environment.wind.speedTrue)')
  if (d?.twa        == null) warns.push('True wind angle — no data (environment.wind.angleTrueWater)')
  if (d?.bsp        == null) warns.push('Boat speed — no data')
  if (d?.tws != null && d?.polarState == null) warns.push('No active polar — select one in the polar management webapp')
  warns.push(...polarStateWarnings(d))
  updateWarnings(document.getElementById('ov-warnings'), warns)
}

const SMOOTHER_PARAMS = {
  Exponential:   { key: 'smootherParamExponential',   label: 'Time constant τ (s)',      min: 0.1,   max: 60,  step: 0.1,   default: 1    },
  MovingAverage: { key: 'smootherParamMovingAverage', label: 'Window size (s)',           min: 1,     max: 120, step: 1,     default: 10   },
  Kalman:        { key: 'smootherParamKalman',        label: 'Steady-state gain (0–1)',   min: 0.001, max: 1,   step: 0.001, default: 0.04 },
}

function _settingsTable(rows) {
  const tbl = document.createElement('table')
  tbl.className = 'table table-sm table-borderless mb-0'
  const tbody = document.createElement('tbody')
  rows.forEach(r => {
    const tr = document.createElement('tr')
    const tdL = document.createElement('td'); tdL.textContent = r.label
    if (r.desc) {
      const s = document.createElement('small'); s.className = 'text-muted d-block'; s.textContent = r.desc
      tdL.appendChild(s)
    }
    const tdC = document.createElement('td')
    if (r.control) tdC.appendChild(r.control)
    tr.appendChild(tdL); tr.appendChild(tdC)
    tbody.appendChild(tr)
  })
  tbl.appendChild(tbody); return tbl
}

function _vesselPresets() {
  const group = document.createElement('div')
  group.className = 'd-flex gap-2 flex-wrap'
  const presets = [
    { label: 'Sportsboat (8s)', tau: 8 },
    { label: 'Vision 444 (12s)', tau: 12 },
    { label: 'Club Racer (18s)', tau: 18 },
    { label: 'Cruiser (32s)', tau: 32 }
  ]
  presets.forEach(p => {
    const btn = document.createElement('button')
    btn.type = 'button'
    const isSelected = Math.abs((settings?.vesselResponseTau ?? 18) - p.tau) < 0.5
    btn.className = isSelected ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-secondary'
    btn.textContent = p.label
    btn.addEventListener('click', () => {
      apiPut('/settings', { vesselResponseTau: p.tau }).then(s => {
        if (s) { settings = s; switchPage('inputs') }
      })
    })
    group.appendChild(btn)
  })
  return group
}

function _vesselLengthPresets() {
  const group = document.createElement('div')
  group.className = 'd-flex gap-2 flex-wrap'
  const presets = [
    { label: 'Beneteau 36.7 (10.7m)', len: 10.7 },
    { label: 'Vision 444 (13.5m)', len: 13.5 },
    { label: '40ft Cruiser (12.2m)', len: 12.2 },
    { label: '50ft Yacht (15.2m)', len: 15.2 }
  ]
  presets.forEach(p => {
    const btn = document.createElement('button')
    btn.type = 'button'
    const isSelected = Math.abs((settings?.vesselLength ?? 12) - p.len) < 0.3
    btn.className = isSelected ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-secondary'
    btn.textContent = p.label
    btn.addEventListener('click', () => {
      apiPut('/settings', { vesselLength: p.len }).then(s => {
        if (s) { settings = s; switchPage('inputs') }
      })
    })
    group.appendChild(btn)
  })
  return group
}

function _channelSmootherSelector(channel) {
  const typeKey = channel + 'SmootherType'
  const sel = document.createElement('select')
  sel.className = 'form-select form-select-sm'
  sel.style.width = '100%'
  ;['None', 'Exponential', 'MovingAverage', 'Kalman'].forEach(opt => {
    const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o)
  })
  sel.value = settings?.[typeKey] || settings?.smootherType || 'Kalman'
  sel.addEventListener('change', () => {
    apiPut('/settings', { [typeKey]: sel.value }).then(s => {
      if (s) { settings = s; switchPage('inputs') }
    })
  })
  return sel
}

function _channelSmootherParam(channel) {
  const type = settings?.[channel + 'SmootherType'] || settings?.smootherType || 'Kalman'
  const baseParam = SMOOTHER_PARAMS[type]
  if (!baseParam) return null
  const paramKey = channel + baseParam.key.charAt(0).toUpperCase() + baseParam.key.slice(1)
  const val = settings?.[paramKey] ?? settings?.[baseParam.key] ?? baseParam.default
  return {
    label: baseParam.label,
    control: createNumberInput(paramKey, val, { ...baseParam, default: baseParam.default }, true, s => {
      settings = s
    })
  }
}

// ── PAGE: Inputs ──────────────────────────────────────────────────────────────
function _buildInputsPage() {
  const wrap = document.createElement('div'); wrap.id = 'inputs-wrap'

  // Dynamic Boat Response (Gust & Wind Shift Compensation)
  wrap.appendChild(sectionHeading('Dynamic Boat Response (Gust & Wind Shift Compensation)'))
  const dynRows = [
    {
      label: 'Enable Dynamic Response',
      desc: 'Compensates for vessel inertia lag during wind gusts, lulls, and wind angle shifts (TWA)',
      control: createToggle(settings?.dynamicResponseEnabled !== false, v =>
        apiPut('/settings', { dynamicResponseEnabled: v }).then(s => { if (s) { settings = s; switchPage('inputs') } })
      )
    },
    {
      label: 'Vessel Presets (Response Time)',
      desc: 'Quick presets for boat mass and acceleration characteristics',
      control: _vesselPresets()
    },
    {
      label: 'Hull Response Time τ (s)',
      desc: 'Vessel time constant for accelerating / decelerating to new polar targets',
      control: createNumberInput('vesselResponseTau', settings?.vesselResponseTau ?? 18, { min: 1, max: 120, step: 0.5, default: 18 }, true)
    }
  ]
  wrap.appendChild(_settingsTable(dynRows))

  // Sea State & Wave Compensation (signalk-wave-estimator)
  wrap.appendChild(sectionHeading('Sea State & Wave Compensation (signalk-wave-estimator)'))
  const waveRows = [
    {
      label: 'Enable Sea State Wave Correction',
      desc: 'Derates polar speed targets based on real-time wave encounter angle, height, and steepness',
      control: createToggle(!!settings?.waveCorrectionEnabled, v =>
        apiPut('/settings', { waveCorrectionEnabled: v }).then(s => { if (s) { settings = s; switchPage('inputs') } })
      )
    },
    {
      label: 'Vessel Presets (Length)',
      desc: 'Quick waterline length presets for wave-to-hull scaling ratio',
      control: _vesselLengthPresets()
    },
    {
      label: 'Vessel Waterline Length Lwl (m)',
      desc: 'Waterline length used to compute relative wave height and pitching susceptibility',
      control: createNumberInput('vesselLength', settings?.vesselLength ?? 12, { min: 6, max: 50, step: 0.5, default: 12 }, true)
    },
    {
      label: 'Wave Drag Sensitivity',
      desc: 'Multiplier for added wave resistance power loss (1.0 = standard Gerritsma-Beukelman)',
      control: createNumberInput('waveDragSensitivity', settings?.waveDragSensitivity ?? 1.0, { min: 0.2, max: 3.0, step: 0.1, default: 1.0 }, true)
    }
  ]
  wrap.appendChild(_settingsTable(waveRows))

  // Live Wave State Table
  wrap.appendChild(sectionHeading('Live Wave State (signalk-wave-estimator)'))
  wrap.appendChild(buildTable([
    { label: 'Significant Wave Height (Hs) — environment.water.waves.significantHeight', id: 'in-wave-hs' },
    { label: 'Maximum Wave Height (Hmax) — environment.water.waves.maximumHeight',       id: 'in-wave-hmax' },
    { label: 'Apparent Encounter Direction — environment.water.waves.apparentDirection',  id: 'in-wave-app-dir' },
    { label: 'True Wave Direction — environment.water.waves.direction',                   id: 'in-wave-true-dir' },
    { label: 'Apparent Encounter Period — environment.water.waves.apparentPeriod',        id: 'in-wave-app-period' },
    { label: 'True Wave Period — environment.water.waves.period',                         id: 'in-wave-period' },
    { label: 'Sea State Descriptor — environment.water.waves.state',                      id: 'in-wave-state' },
    { label: 'Effective Encounter Angle (Bow)',                                           id: 'in-wave-enc-angle' },
    { label: 'Calculated Wave Drag Penalty',                                              id: 'in-wave-penalty' },
    { label: 'Sea-State Performance Factor',                                              id: 'in-wave-factor' }
  ]))

  // Decoupled sensor smoothers
  wrap.appendChild(sectionHeading('Sensor Damping (Decoupled)'))
  const smRows = [
    { label: 'Wind Damping Type', desc: 'Vector filter on TWS and TWA', control: _channelSmootherSelector('wind') }
  ]
  const windParam = _channelSmootherParam('wind')
  if (windParam) smRows.push({ label: 'Wind ' + windParam.label, control: windParam.control })

  smRows.push({ label: 'Boat Speed Damping Type', desc: 'Scalar filter on boat speed', control: _channelSmootherSelector('bsp') })
  const bspParam = _channelSmootherParam('bsp')
  if (bspParam) smRows.push({ label: 'Boat Speed ' + bspParam.label, control: bspParam.control })

  wrap.appendChild(_settingsTable(smRows))

  wrap.appendChild(sectionHeading('True Wind Speed'))
  wrap.appendChild(buildTable([
    { label: 'Raw  — environment.wind.speedTrue',      id: 'in-tws-raw' },
    { label: 'Smoothed — plugin',                      id: 'in-tws-smo' },
  ]))

  wrap.appendChild(sectionHeading('True Wind Angle'))
  wrap.appendChild(buildTable([
    { label: 'Raw  — environment.wind.angleTrueWater', id: 'in-twa-raw' },
    { label: 'Smoothed — plugin',                      id: 'in-twa-smo' },
  ]))

  wrap.appendChild(sectionHeading('Boat Speed'))
  // SOG toggle sits above the data paths
  wrap.appendChild(_settingsTable([
    { label: 'Use speed over ground (SOG)', desc: 'Off = navigation.speedThroughWater',
      control: createToggle(!!settings?.useSOG, v =>
        apiPut('/settings', { useSOG: v }).then(s => { if (s) { settings = s; switchPage('inputs') } })
      )},
  ]))
  // Row labels updated on tick to reflect useSOG setting
  wrap.appendChild(buildTable([
    { label: 'Raw', id: 'in-bsp-raw' },
    { label: 'Smoothed — plugin', id: 'in-bsp-smo' },
  ]))

  // Heading — only if tackTrue enabled
  if (settings?.tackTrue) {
    wrap.appendChild(sectionHeading('Heading (True)'))
    wrap.appendChild(buildTable([
      { label: 'Raw — navigation.headingTrue', id: 'in-hdg-raw' },
    ]))
  }

  const warningsDiv = document.createElement('div'); warningsDiv.id = 'in-warnings'
  wrap.appendChild(warningsDiv)

  _tickInputs()
  return wrap
}

function _tickInputs() {
  const d = liveData
  const w = d?.wave || waveValues

  setVal('in-tws-raw', fmtVal(rawValues.tws, 'tws', SPEED_DEFAULT))
  setVal('in-tws-smo', fmtVal(d?.tws,        'tws', SPEED_DEFAULT))
  setVal('in-twa-raw', fmtVal(rawValues.twa !== null && rawValues.twa !== undefined ? Math.abs(rawValues.twa) : null, 'twa', ANGLE_DEFAULT))
  setVal('in-twa-smo', fmtVal(d?.twa !== null && d?.twa !== undefined ? Math.abs(d.twa) : null, 'twa', ANGLE_DEFAULT))
  setVal('in-bsp-raw', fmtVal(rawValues.bsp, 'bsp', SPEED_DEFAULT))
  setVal('in-bsp-smo', fmtVal(d?.bsp,        'bsp', SPEED_DEFAULT))
  if (settings?.tackTrue) setVal('in-hdg-raw', fmtVal(rawValues.hdg, 'twa', ANGLE_DEFAULT))

  // Wave inputs from signalk-wave-estimator
  const hs = w?.significantHeight ?? waveValues?.significantHeight
  const hmax = w?.maximumHeight ?? waveValues?.maximumHeight
  const appDir = w?.apparentDirection ?? waveValues?.apparentDirection
  const trueDir = w?.direction ?? waveValues?.direction
  const appPer = w?.apparentPeriod ?? waveValues?.apparentPeriod
  const period = w?.period ?? waveValues?.period
  const state = w?.state ?? waveValues?.state
  const encAngle = w?.encounterAngle ?? (appDir != null ? Math.abs(appDir) : null)
  const penalty = w?.penalty ?? waveValues?.penalty ?? 0
  const factor = w?.factor ?? waveValues?.factor ?? 1.0

  setVal('in-wave-hs', hs != null ? hs.toFixed(2) + '\u00a0m' : '—')
  setVal('in-wave-hmax', hmax != null ? hmax.toFixed(2) + '\u00a0m' : '—')
  setVal('in-wave-app-dir', appDir != null ? (appDir * 180 / Math.PI).toFixed(1) + '°' : '—')
  setVal('in-wave-true-dir', trueDir != null ? (trueDir * 180 / Math.PI).toFixed(0) + '°' : '—')
  setVal('in-wave-app-period', appPer != null ? appPer.toFixed(1) + '\u00a0s' : '—')
  setVal('in-wave-period', period != null ? period.toFixed(1) + '\u00a0s' : '—')
  setVal('in-wave-state', state || '—')
  setVal('in-wave-enc-angle', encAngle != null ? (encAngle * 180 / Math.PI).toFixed(1) + '°' : '—')

  if (settings?.waveCorrectionEnabled) {
    setVal('in-wave-penalty', (penalty * 100).toFixed(1) + '%')
    setVal('in-wave-factor', (factor * 100).toFixed(1) + '%')
  } else {
    setVal('in-wave-penalty', 'Off (0.0%)')
    setVal('in-wave-factor', 'Off (100.0%)')
  }

  // Update boat speed raw label to show actual path
  const bspLabelEl = document.querySelector('#in-bsp-raw')?.closest('tr')?.cells?.[0]
  if (bspLabelEl) bspLabelEl.textContent = 'Raw — ' + (settings?.useSOG ? 'navigation.speedOverGround' : 'navigation.speedThroughWater')

  setStale('in-tws-raw', rawValues.tws == null)
  setStale('in-tws-smo', d?.tws        == null)
  setStale('in-twa-raw', rawValues.twa == null)
  setStale('in-twa-smo', d?.twa        == null)
  setStale('in-bsp-raw', rawValues.bsp == null)
  setStale('in-bsp-smo', d?.bsp        == null)
  setStale('in-wave-hs', hs == null)

  const warns = []
  lifecycleWarnings.forEach(w => {
    if (w && typeof w.message === 'string') warns.push(w.message)
  })
  updateWarnings(document.getElementById('in-warnings'), warns)
}

// ── PAGE: Outputs ──────────────────────────────────────────────────────────────
function _buildOutputsPage() {
  const wrap = document.createElement('div'); wrap.id = 'outputs-wrap'
  wrap.appendChild(sectionHeading('Output Paths'))

  OUTPUT_DEFS.forEach(def => {
    const block = document.createElement('div'); block.className = 'mb-2'

    // Header row: label left, toggle right — same two-column layout as settings tables
    const enabled = !!(settings && settings[def.key])
    const toggle = createToggle(enabled, checked => {
      apiPut('/settings', { [def.key]: checked }).then(s => {
        if (!s) return
        settings = s
        const sub = document.getElementById('out-sub-' + def.key)
        if (sub) sub.style.display = checked ? '' : 'none'
      })
    })
    block.appendChild(buildTable([{ label: def.label, control: toggle, rowClass: 'fw-semibold' }]))

    // Sub-table: individual paths + live values (shown only when enabled)
    const sub = document.createElement('div')
    sub.id = 'out-sub-' + def.key
    sub.style.display = enabled ? '' : 'none'
    sub.style.display = enabled ? '' : 'none'
    sub.appendChild(buildTable(def.paths.map(p => ({
      label: p.label + '\u2002(' + p.sk.replace(/\//g, '.') + ')',
      id: skId(p.sk),
    }))))
    block.appendChild(sub)
    wrap.appendChild(block)
  })

  const warningsDiv = document.createElement('div'); warningsDiv.id = 'out-warnings'
  wrap.appendChild(warningsDiv)

  _tickOutputs()
  return wrap
}

function _tickOutputs() {
  OUTPUT_DEFS.forEach(def => {
    if (!settings || !settings[def.key]) return
    def.paths.forEach(p => {
      setVal(skId(p.sk), fmtVal(outputValues[p.sk], p.mk, p.fb))
    })
  })
  updateWarnings(document.getElementById('out-warnings'), polarStateWarnings(liveData))
}

// ── Navigation ────────────────────────────────────────────────────────────────
const PAGES = {
  overview: { title: 'Overview', build: _buildOverviewPage },
  inputs:   { title: 'Inputs',   build: _buildInputsPage  },
  outputs:  { title: 'Outputs',  build: _buildOutputsPage },
}

let _currentPageEl = null

function switchPage(page) {
  if (_currentPageEl?._cleanup) _currentPageEl._cleanup()
  if (activePage === 'overview') polar = null
  activePage = page

  document.querySelectorAll('#main-nav .nav-link').forEach(l =>
    l.classList.toggle('active', l.dataset.page === page)
  )
  const title = document.getElementById('card-title')
  const body = document.getElementById('card-body')
  title.textContent = PAGES[page].title
  body.innerHTML = ''
  body.classList.toggle('polar-layout', page === 'overview')

  _currentPageEl = PAGES[page].build()
  body.appendChild(_currentPageEl)
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  setInterval(refreshLive, 1000)
  setInterval(async () => {
    await refreshLibrary()
    if (activePage === 'overview' && polar) polar.setLibraryData(twsList, curves, liveCurve)
  }, 5000)
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const isMobile = () => window.matchMedia('(max-width: 767.98px)').matches
  document.querySelectorAll('#main-nav .nav-link').forEach(link =>
    link.addEventListener('click', e => {
      e.preventDefault()
      switchPage(link.dataset.page)
      if (isMobile()) document.body.classList.remove('sidebar-mobile-show')
    })
  )
  document.getElementById('sidebarMinimizer')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-minimized')
    document.body.classList.toggle('brand-minimized')
  })
  document.getElementById('sidebarToggler')?.addEventListener('click', () => {
    if (isMobile()) {
      document.body.classList.toggle('sidebar-mobile-show')
    } else {
      document.body.classList.toggle('sidebar-hidden')
    }
  })

  await refreshSettings()
  await loadMeta()
  switchPage('overview')
  await refreshLibrary()
  await refreshLive()
  startPolling()
}

init()

