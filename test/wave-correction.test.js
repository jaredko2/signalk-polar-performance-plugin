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

describe('Sea State Wave Added Resistance & Polar Derating Model', () => {
  let dataDir, app, plugin

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polar-waves-'))
    app = makeApp(dataDir)
    plugin = freshPlugin(app)
  })

  afterEach(() => {
    try { plugin.stop() } catch (_) {}
    fs.rmSync(dataDir, { recursive: true, force: true })
    delete require.cache[require.resolve('../plugin/index.js')]
  })

  it('keeps flat-water target when waveCorrectionEnabled is false', async () => {
    plugin.start({
      polarSpeed: true,
      waveCorrectionEnabled: false,
      dynamicResponseEnabled: false,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // Wave chop present, but feature is toggled off
    app._emit('environment.water.waves.significantHeight', 1.5)
    app._emit('environment.water.waves.apparentDirection', 0.0) // head seas
    app._emit('environment.water.waves.apparentPeriod', 3.5)

    app._emit('navigation.speedThroughWater', 3.30)
    app._emit('environment.wind.angleTrueWater', 0.90757) // 52 deg
    app._emit('environment.wind.speedTrue', 6.1733)       // 12 kt

    const polarSpeed = app._store.get('performance.polarSpeed')
    const dynamicTarget = app._store.get('performance.dynamicTargetSpeed')

    assert.ok(Number.isFinite(polarSpeed), 'polar speed should be valid')
    assert.equal(dynamicTarget, polarSpeed, 'dynamic target must match flat water polar when wave correction is disabled')
  })

  it('derates polar performance target when waveCorrectionEnabled is true in steep head chop', async () => {
    plugin.start({
      polarSpeed: true,
      waveCorrectionEnabled: true,
      waveCorrection: true,
      vesselLength: 12.0,
      waveDragSensitivity: 1.0,
      dynamicResponseEnabled: false,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // 1.5m steep head seas (encounter angle 0.0 rad)
    app._emit('environment.water.waves.significantHeight', 1.5)
    app._emit('environment.water.waves.apparentDirection', 0.0)
    app._emit('environment.water.waves.apparentPeriod', 3.5)
    app._emit('environment.water.waves.state', 'Moderate')

    app._emit('navigation.speedThroughWater', 2.80)
    app._emit('environment.wind.angleTrueWater', 0.90757) // 52 deg
    app._emit('environment.wind.speedTrue', 6.1733)       // 12 kt

    const flatPolar = app._store.get('performance.polarSpeed')
    const seaStatePolar = app._store.get('performance.polarSpeedSeaState')
    const dynamicTarget = app._store.get('performance.dynamicTargetSpeed')
    const waveFactor = app._store.get('performance.wavePerformanceFactor')
    const wavePenalty = app._store.get('performance.waveDragPenalty')
    const perfRatio = app._store.get('performance.polarSpeedRatio')

    assert.ok(flatPolar > 3.25, `flat polar should be ~3.30 m/s, got ${flatPolar}`)
    assert.ok(seaStatePolar < flatPolar, `sea state polar (${seaStatePolar}) must be less than flat polar (${flatPolar})`)
    assert.equal(dynamicTarget, seaStatePolar, 'active dynamic target should equal sea-state polar when dynamic response disabled')

    // In 1.5m head chop, penalty should be in the realistic 15%-25% range
    assert.ok(wavePenalty > 0.12 && wavePenalty < 0.30, `wave penalty should be between 12% and 30%, got ${(wavePenalty * 100).toFixed(1)}%`)
    assert.ok(Math.abs((1.0 - wavePenalty) - waveFactor) < 0.001, 'waveFactor should equal 1 - wavePenalty')

    // At 2.80 m/s, boat is doing ~2.80 / 2.70 = ~103% of sea state target, but only 84% of flat water target
    assert.ok(perfRatio > 0.95, `sea-state performance ratio should recognize realistic speed (>0.95), got ${perfRatio}`)
  })

  it('calculates minimal penalty in user sample smooth sea state', async () => {
    plugin.start({
      polarSpeed: true,
      waveCorrectionEnabled: true,
      waveCorrection: true,
      vesselLength: 13.5, // Vision 444
      waveDragSensitivity: 1.0,
      dynamicResponseEnabled: false,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // User sample values
    app._emit('environment.water.waves.apparentDirection', -0.963)
    app._emit('environment.water.waves.apparentPeriod', 3.0)
    app._emit('environment.water.waves.direction', 2.743)
    app._emit('environment.water.waves.maximumHeight', 0.37)
    app._emit('environment.water.waves.period', 3.0)
    app._emit('environment.water.waves.significantHeight', 0.20)
    app._emit('environment.water.waves.state', 'Smooth')

    app._emit('navigation.speedThroughWater', 3.30)
    app._emit('environment.wind.angleTrueWater', 0.90757)
    app._emit('environment.wind.speedTrue', 6.1733)

    const wavePenalty = app._store.get('performance.waveDragPenalty')
    const waveFactor = app._store.get('performance.wavePerformanceFactor')

    assert.ok(wavePenalty < 0.03, `smooth sea state should produce <3% penalty, got ${(wavePenalty * 100).toFixed(2)}%`)
    assert.ok(waveFactor > 0.97, `waveFactor should be >97%, got ${waveFactor}`)
  })

  it('reduces penalty significantly in following seas compared to head seas', async () => {
    plugin.start({
      polarSpeed: true,
      waveCorrectionEnabled: true,
      waveCorrection: true,
      vesselLength: 12.0,
      dynamicResponseEnabled: false,
      windSmootherType: 'None',
      bspSmootherType: 'None'
    })

    app._emit('polars.activePolar', { href: '/resources/polars/test-polar' })
    await new Promise(r => setTimeout(r, 50))

    // Head seas first (1.2m)
    app._emit('environment.water.waves.significantHeight', 1.2)
    app._emit('environment.water.waves.apparentPeriod', 4.0)
    app._emit('environment.water.waves.apparentDirection', 0.0)
    app._emit('environment.wind.angleTrueWater', 0.785)
    app._emit('environment.wind.speedTrue', 6.1733)
    app._emit('navigation.speedThroughWater', 3.0)

    const headSeaPenalty = app._store.get('performance.waveDragPenalty')

    // Following seas (same 1.2m wave, encounter from stern at 170 deg = 2.96 rad)
    app._emit('environment.water.waves.apparentDirection', 2.967)
    app._emit('environment.wind.speedTrue', 6.1733)

    const followingSeaPenalty = app._store.get('performance.waveDragPenalty')

    assert.ok(headSeaPenalty > 0.08, `head sea penalty should be >8%, got ${(headSeaPenalty * 100).toFixed(1)}%`)
    assert.ok(followingSeaPenalty < 0.03, `following sea penalty should be <3%, got ${(followingSeaPenalty * 100).toFixed(1)}%`)
    assert.ok(followingSeaPenalty < headSeaPenalty * 0.25, 'following sea penalty must be a fraction of head sea penalty')
  })
})
