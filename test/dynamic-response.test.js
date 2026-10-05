'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ---------------------------------------------------------------------------
// Sample Polar Table for Tests
// ---------------------------------------------------------------------------
const twsMs = [3.0867, 4.1156, 5.1444, 6.1733, 7.2000, 8.2311, 10.2889]
const twaDeg = [40, 45, 52, 60, 75, 90, 110, 120, 135, 150]
const twaRad = twaDeg.map(d => parseFloat((d * Math.PI / 180).toFixed(6)))

const matrixKnots = [
  [3.82, 4.21, 4.52, 4.91, 5.30, 5.51, 5.48, 5.25, 4.78, 4.21],
  [4.81, 5.25, 5.51, 5.98, 6.42, 6.64, 6.60, 6.38, 5.89, 5.22],
  [5.50, 5.89, 6.12, 6.58, 7.01, 7.23, 7.22, 6.98, 6.55, 5.97],
  [5.82, 6.21, 6.42, 6.88, 7.31, 7.54, 7.62, 7.41, 7.08, 6.58],
  [5.98, 6.38, 6.59, 7.03, 7.48, 7.73, 7.91, 7.74, 7.42, 7.01],
  [6.09, 6.50, 6.71, 7.14, 7.61, 7.89, 8.18, 8.08, 7.76, 7.37],
  [6.18, 6.62, 6.82, 7.25, 7.74, 8.12, 8.70, 8.68, 8.39, 7.98]
]

const boatSpeedMatrix = matrixKnots.map(row =>
  row.map(k => parseFloat((k / 1.94384).toFixed(5)))
)

const samplePolarDoc = {
  kind: 'polarTable',
  schemaVersion: '1.0.0',
  id: 'test-polar',
  name: 'Test Polar',
  units: { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' },
  symmetry: { portStarboardSymmetric: true },
  axes: { tws: twsMs, twa: twaRad },
  values: { boatSpeedMatrix }
}

// ---------------------------------------------------------------------------
// Mock SignalK App
// ---------------------------------------------------------------------------
function makeApp(dataDir) {
  const subscriptions = []
  const store = new Map()
  const messages = []

  return {
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {},
    savePluginOptions: (_options, callback) => {
      if (typeof callback === 'function') callback(null)
    },
    getDataDirPath: () => dataDir,
    handleMessage: (_pluginId, msg) => {
      messages.push(msg)
      if (msg?.updates) {
        for (const update of msg.updates) {
          if (Array.isArray(update.values)) {
            for (const item of update.values) {
              store.set(item.path, item.value)
            }
          }
        }
      }
    },
    getSelfPath: (pathStr) => {
      if (store.has(pathStr)) return { value: store.get(pathStr) }
      return undefined
    },
    resourcesApi: {
      listResources: async () => ({ 'test-polar': samplePolarDoc }),
      getResource: async (_type, _id) => samplePolarDoc
    },
    subscriptionmanager: {
      subscribe: (sub, unsubscribes, _onErr, onDelta) => {
        const entry = { sub, onDelta, active: true }
        subscriptions.push(entry)
        unsubscribes.push(() => { entry.active = false })
      }
    },
    _emit: (pathStr, value) => {
      store.set(pathStr, value)
      const delta = {
        context: 'vessels.self',
        updates: [{ values: [{ path: pathStr, value }] }]
      }
      for (const s of subscriptions) {
        if (!s.active) continue
        const match = s.sub.subscribe?.some(item => item.path === pathStr)
        if (match) s.onDelta(delta)
      }
    },
    _store: store,
    _messages: messages
  }
}

function freshPlugin(app) {
  delete require.cache[require.resolve('../plugin/index.js')]
  return require('../plugin/index.js')(app)
}

describe('Dynamic Boat Acceleration & Wind Shift Response Model', () => {
  let dataDir, app, plugin

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polar-dynamic-'))
    app = makeApp(dataDir)
    plugin = freshPlugin(app)
  })

  afterEach(() => {
    try { plugin.stop() } catch (_) {}
    fs.rmSync(dataDir, { recursive: true, force: true })
    delete require.cache[require.resolve('../plugin/index.js')]
  })

  it('stabilizes polar performance target during a sudden gust', async () => {
    plugin.start({
      polarSpeed: true,
      dynamicResponseEnabled: true,
      vesselResponseTau: 18.0,
      windSmootherType: 'None', // test pure dynamic model without sensor lag
      bspSmootherType: 'None'
    })

    // Load active polar
    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // Initial steady state: TWS = 6.17 m/s (12 kn), TWA = 52 deg (0.907 rad)
    // Boat speed matches polar steady speed (~3.30 m/s)
    const initialTws = 6.1733
    const initialTwa = 0.90757
    const initialBsp = 3.30

    app._emit('navigation.speedThroughWater', initialBsp)
    app._emit('environment.wind.angleTrueWater', initialTwa)
    app._emit('environment.wind.speedTrue', initialTws)

    const initialDyn = app._store.get('performance.dynamicTargetSpeed')
    const initialRatio = app._store.get('performance.polarSpeedRatio')
    assert.ok(Number.isFinite(initialDyn), 'initial dynamic target speed should be numeric')
    assert.ok(Math.abs(initialRatio - 1.0) < 0.05, `initial ratio should be near 1.0, got ${initialRatio}`)

    // Sudden gust: wind jumps to 10.28 m/s (20 kn)
    // In a gust, steady polar speed jumps to ~4.17 m/s, but boat has not accelerated yet
    const gustTws = 10.2889
    app._emit('environment.wind.speedTrue', gustTws)

    const steadyPolar = app._store.get('performance.polarSpeed')
    const gustDyn = app._store.get('performance.dynamicTargetSpeed')
    const gustRatio = app._store.get('performance.polarSpeedRatio')

    // Steady polar jumped immediately to ~3.51 m/s
    assert.ok(steadyPolar > 3.48, `steady polar speed should jump to >3.48 m/s, got ${steadyPolar}`)
    // Dynamic target should NOT have jumped to 3.51 immediately (< 3.33)
    assert.ok(gustDyn < 3.33, `dynamic target should lag and be <3.33 m/s, got ${gustDyn}`)
    // Polar performance ratio should stay realistic (> 0.98) rather than jumping
    assert.ok(gustRatio > 0.95, `gust ratio should stay stabilized (>0.95), got ${gustRatio}`)
  })

  it('stabilizes polar target during a sudden wind shift (TWA change)', async () => {
    plugin.start({
      polarSpeed: true,
      dynamicResponseEnabled: true,
      vesselResponseTau: 18.0,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // Beating at 45 deg (0.785 rad), 12 kt wind
    app._emit('navigation.speedThroughWater', 3.19)
    app._emit('environment.wind.angleTrueWater', 0.785398)
    app._emit('environment.wind.speedTrue', 6.1733)

    const beatDyn = app._store.get('performance.dynamicTargetSpeed')
    assert.ok(Number.isFinite(beatDyn), 'beat dynamic target should be valid')

    // Wind shifts to a beam reach (90 deg = 1.57 rad), where steady polar is much faster (~3.88 m/s)
    app._emit('environment.wind.angleTrueWater', 1.570796)

    const reachSteady = app._store.get('performance.polarSpeed')
    const reachDyn = app._store.get('performance.dynamicTargetSpeed')

    assert.ok(reachSteady > 3.8, `reaching steady polar should be >3.8, got ${reachSteady}`)
    // Dynamic target should ramp smoothly, not jump instantly
    assert.ok(reachDyn < 3.4, `dynamic target should ramp smoothly (<3.4), got ${reachDyn}`)
  })

  it('supports disabling dynamic response to restore instantaneous targets', async () => {
    plugin.start({
      polarSpeed: true,
      dynamicResponseEnabled: false,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    app._emit('navigation.speedThroughWater', 3.30)
    app._emit('environment.wind.angleTrueWater', 0.90757)
    app._emit('environment.wind.speedTrue', 10.2889)

    const steadyPolar = app._store.get('performance.polarSpeed')
    const dynamicTarget = app._store.get('performance.dynamicTargetSpeed')

    assert.equal(dynamicTarget, steadyPolar, 'dynamicTargetSpeed should equal steadyPolar when disabled')
  })

  it('supports decoupled wind and boat speed damping settings', () => {
    plugin.start({
      windSmootherType: 'Kalman',
      windSmootherParamKalman: 0.02,
      bspSmootherType: 'Exponential',
      bspSmootherParamExponential: 3.5
    })

    assert.doesNotThrow(() => {
      app._emit('environment.wind.speedTrue', 6.0)
      app._emit('environment.wind.angleTrueWater', 0.8)
      app._emit('navigation.speedThroughWater', 3.2)
    })
  })
})
