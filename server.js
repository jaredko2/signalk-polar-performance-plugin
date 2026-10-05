'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// -----------------------------------------------------------------------------
// Sample Polar Definition (Beneteau First 36.7 - ORC Club VPP)
// -----------------------------------------------------------------------------
const twsKnots = [6, 8, 10, 12, 14, 16, 20];
const twsMs = twsKnots.map(k => parseFloat((k / 1.94384).toFixed(5)));

const twaDeg = [40, 45, 52, 60, 75, 90, 110, 120, 135, 150];
const twaRad = twaDeg.map(d => parseFloat((d * Math.PI / 180).toFixed(6)));

const matrixKnots = [
  // 6 kt TWS
  [3.82, 4.21, 4.52, 4.91, 5.30, 5.51, 5.48, 5.25, 4.78, 4.21],
  // 8 kt TWS
  [4.81, 5.25, 5.51, 5.98, 6.42, 6.64, 6.60, 6.38, 5.89, 5.22],
  // 10 kt TWS
  [5.50, 5.89, 6.12, 6.58, 7.01, 7.23, 7.22, 6.98, 6.55, 5.97],
  // 12 kt TWS
  [5.82, 6.21, 6.42, 6.88, 7.31, 7.54, 7.62, 7.41, 7.08, 6.58],
  // 14 kt TWS
  [5.98, 6.38, 6.59, 7.03, 7.48, 7.73, 7.91, 7.74, 7.42, 7.01],
  // 16 kt TWS
  [6.09, 6.50, 6.71, 7.14, 7.61, 7.89, 8.18, 8.08, 7.76, 7.37],
  // 20 kt TWS
  [6.18, 6.62, 6.82, 7.25, 7.74, 8.12, 8.70, 8.68, 8.39, 7.98]
];

const boatSpeedMatrix = matrixKnots.map(row =>
  row.map(k => parseFloat((k / 1.94384).toFixed(5)))
);

const samplePolar = {
  kind: 'polarTable',
  schemaVersion: '1.0.0',
  id: 'beneteau-first-367',
  name: 'Beneteau First 36.7',
  boatType: 'First 36.7',
  sailnumber: 'USA-52140',
  year: 2022,
  source: 'ORC Club VPP',
  notes: 'Standard symmetric racing polar',
  units: {
    tws: 'm/s',
    twa: 'rad',
    boatSpeed: 'm/s'
  },
  symmetry: {
    portStarboardSymmetric: true
  },
  axes: {
    tws: twsMs,
    twa: twaRad
  },
  values: {
    boatSpeedMatrix
  }
};

const polarsStore = {
  'beneteau-first-367': samplePolar
};

// -----------------------------------------------------------------------------
// Signal K App Shim
// -----------------------------------------------------------------------------
const dataDir = path.join(process.cwd(), '.signalk-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const selfStore = new Map();
const subscriptions = [];

function getSelfValue(key) {
  return selfStore.get(key);
}

function setSelfValue(key, value) {
  selfStore.set(key, value);
}

// Initial state
setSelfValue('polars.activePolar', { href: '/resources/polars/beneteau-first-367' });
setSelfValue('polars.performanceFactor', 1.0);
setSelfValue('environment.wind.speedTrue', 6.17);          // ~12.0 knots
setSelfValue('environment.wind.angleTrueWater', 0.872665); // ~50.0 degrees
setSelfValue('navigation.speedThroughWater', 3.45);        // ~6.7 knots
setSelfValue('navigation.speedOverGround', 3.45);
setSelfValue('navigation.headingTrue', 1.570796);          // 90 degrees

function emitDelta(pathStr, value) {
  setSelfValue(pathStr, value);
  const delta = {
    context: 'vessels.self',
    updates: [{
      values: [{ path: pathStr, value }]
    }]
  };
  for (const s of subscriptions) {
    if (!s.active) continue;
    const match = s.sub.subscribe?.some(item => item.path === pathStr);
    if (match && typeof s.onDelta === 'function') {
      try {
        s.onDelta(delta);
      } catch (err) {
        console.error(`Subscription error on ${pathStr}:`, err);
      }
    }
  }
}

const skApp = {
  debug: (...args) => {
    // console.log('[SignalK debug]', ...args);
  },
  error: (...args) => {
    console.error('[SignalK error]', ...args);
  },
  setPluginStatus: (msg) => {
    skApp._pluginStatus = msg;
    console.log('[Polar Performance]', msg);
  },
  setPluginError: (err) => {
    skApp._pluginError = err;
    console.error('[Polar Performance error]', err);
  },
  getPluginStatus: () => skApp._pluginStatus || '',
  getDataDirPath: () => dataDir,
  config: { port: PORT },
  savePluginOptions: (opts, cb) => {
    skApp._pluginOptions = opts;
    try {
      fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(opts, null, 2));
    } catch (_) {}
    if (typeof cb === 'function') cb(null);
  },
  handleMessage: (pluginId, msg) => {
    if (msg?.updates) {
      for (const update of msg.updates) {
        if (Array.isArray(update.values)) {
          for (const item of update.values) {
            setSelfValue(item.path, item.value);
          }
        }
      }
    }
  },
  getSelfPath: (pathStr) => {
    if (selfStore.has(pathStr)) {
      return { value: selfStore.get(pathStr), timestamp: new Date().toISOString() };
    }
    return undefined;
  },
  resourcesApi: {
    listResources: async (type, options) => {
      if (type === 'polars') return polarsStore;
      return {};
    },
    getResource: async (type, id) => {
      if (type === 'polars' && polarsStore[id]) return polarsStore[id];
      throw new Error(`Resource ${type}/${id} not found`);
    },
    setResource: async (type, id, doc) => {
      if (type === 'polars') {
        polarsStore[id] = doc;
        return;
      }
      throw new Error(`Unsupported resource type ${type}`);
    }
  },
  subscriptionmanager: {
    subscribe: (sub, unsubscribes, onErr, onDelta) => {
      const entry = { sub, onDelta, active: true };
      subscriptions.push(entry);
      if (Array.isArray(unsubscribes)) {
        unsubscribes.push(() => {
          entry.active = false;
        });
      }
    }
  }
};

// -----------------------------------------------------------------------------
// Initialize Plugin
// -----------------------------------------------------------------------------
const pluginFactory = require('./plugin/index.js');
const plugin = pluginFactory(skApp);

const app = express();
app.use(express.json());

// Mount plugin router
const pluginRouter = express.Router();
plugin.registerWithRouter(pluginRouter);
app.use('/plugins/signalk-polar-performance-plugin', pluginRouter);

// Serve SignalK Admin manifest / stylesheet
app.get('/admin/.vite/manifest.json', (req, res) => {
  res.json({
    'index.html': {
      file: 'coreui.css',
      isEntry: true,
      css: ['coreui.css']
    }
  });
});

app.get('/admin/coreui.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'coreui.css'));
});

// Serve static frontend
app.use('/plugins/signalk-polar-performance-plugin', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Start the plugin with defaults
let savedSettings = {};
try {
  const p = path.join(dataDir, 'settings.json');
  if (fs.existsSync(p)) savedSettings = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (_) {}

plugin.start(savedSettings);

// Deliver initial values after plugin start
setTimeout(() => {
  emitDelta('polars.activePolar', { href: '/resources/polars/beneteau-first-367' });
  emitDelta('polars.performanceFactor', 1.0);
  emitDelta('environment.wind.speedTrue', 6.17);
  emitDelta('environment.wind.angleTrueWater', 0.89);
  emitDelta('navigation.speedThroughWater', 3.45);
  emitDelta('navigation.speedOverGround', 3.45);
  emitDelta('navigation.headingTrue', 1.570796);
}, 100);

// Gentle live simulation tick (1 Hz) to animate instrument feedback
let tickCount = 0;
setInterval(() => {
  tickCount++;
  const t = tickCount;
  // Natural variation in wind and boat speed
  const tws = parseFloat((6.17 + 0.35 * Math.sin(t * 0.1) + 0.15 * Math.cos(t * 0.25)).toFixed(3));
  const twa = parseFloat((0.89 + 0.05 * Math.sin(t * 0.08) + 0.02 * Math.cos(t * 0.2)).toFixed(4));
  const bsp = parseFloat((3.45 + 0.2 * Math.sin(t * 0.1 + 0.3) + 0.05 * Math.sin(t * 0.3)).toFixed(3));
  const hdg = parseFloat(((1.57 + 0.04 * Math.sin(t * 0.05) + 2 * Math.PI) % (2 * Math.PI)).toFixed(4));

  emitDelta('environment.wind.speedTrue', tws);
  emitDelta('environment.wind.angleTrueWater', twa);
  emitDelta('navigation.speedThroughWater', bsp);
  emitDelta('navigation.speedOverGround', bsp);
  emitDelta('navigation.headingTrue', hdg);
}, 1000);

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Polar Performance app running at http://${HOST}:${PORT}`);
});
