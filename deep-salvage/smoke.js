'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function gradient() { return { addColorStop: function () {} }; }

var canvasStats = { mainDrawImages: 0, mainDestinationOut: false, maskDestinationOut: false, previewFills: 0 };

function canvasContext(kind) {
  var methods = [
    'setTransform','clearRect','fillRect','strokeRect','save','restore','translate','rotate','scale','beginPath','closePath',
    'moveTo','lineTo','quadraticCurveTo','arc','ellipse','fill','stroke','clip','setLineDash','fillText'
  ];
  var context = { createLinearGradient: gradient, createRadialGradient: gradient };
  methods.forEach(function (name) { context[name] = function () {}; });
  context.fillRect = function () { if (kind === 'preview') canvasStats.previewFills++; };
  context.drawImage = function () { if (kind === 'main') canvasStats.mainDrawImages++; };
  context.rect = function () {};
  Object.defineProperty(context, 'globalCompositeOperation', {
    set: function (value) {
      if (value !== 'destination-out') return;
      if (kind === 'main') canvasStats.mainDestinationOut = true;
      else canvasStats.maskDestinationOut = true;
    }
  });
  return context;
}

function makeElement(id, canvasElement) {
  var listeners = {};
  var article = { classList: { toggle: function () {}, add: function () {}, remove: function () {} } };
  return {
    id: id,
    hidden: false,
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    style: {},
    dataset: {},
    children: [],
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; }
    },
    appendChild: function (child) { this.children.push(child); return child; },
    addEventListener: function (type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    dispatch: function (type, event) { (listeners[type] || []).forEach(function (fn) { fn(event || {}); }); },
    setAttribute: function () {},
    getBoundingClientRect: function () { return { width: 1280, height: 720, left: 0, top: 0 }; },
    setPointerCapture: function () {},
    closest: function () { return article; },
    getContext: (id === 'gameCanvas' || id === 'trenchPreview' || canvasElement) ? function () { return canvasContext(id === 'gameCanvas' ? 'main' : id === 'trenchPreview' ? 'preview' : 'mask'); } : undefined
  };
}

var ids = [
  'gameCanvas','startScreen','resultScreen','pauseScreen','startBtn','seedBtn','retryBtn','resumeBtn','soundToggle',
  'missionHud','crewStrip','depthGauge','inventoryPanel','controlNote','oxygenValue','oxygenFill','suffocationCount',
  'depthValue','zoneValue','haulValue','timeValue','guardIntent','salvagerIntent','guardOxygen','salvagerOxygen',
  'depthMarker','inventorySlots','scorePreview','staminaFill','staminaValue','dangerMessage','eventToast','archiveCount','archiveGear',
  'resultKicker','resultTitle','resultReason','resultStats','resultGear','seedValue','trenchPreview'
];
var elements = {};
ids.forEach(function (id) { elements[id] = makeElement(id); });

var frames = [];
var storage = {};
var context = {
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  parseInt: parseInt,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  devicePixelRatio: 1,
  matchMedia: function () { return { matches: true, addEventListener: function () {} }; },
  requestAnimationFrame: function (fn) { frames.push(fn); return frames.length; },
  localStorage: {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem: function (key, value) { storage[key] = String(value); }
  },
  document: {
    getElementById: function (id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelectorAll: function () { return []; },
    createElement: function (tag) { return makeElement('created', tag === 'canvas'); }
  },
  addEventListener: function () {}
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

['maps.js','ai.js','game.js','audio.js','preview.js','terrain.js'].forEach(function (file) {
  var source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
});

if (!context.DeepSalvageTerrain || !context.DeepSalvageGame || !context.DeepSalvagePreview) throw new Error('Browser globals were not initialized');
if (!frames.length) throw new Error('Renderer did not schedule a frame');
frames.shift()(16);
elements.startBtn.dispatch('click');
if (!frames.length) throw new Error('Renderer did not continue after start');
frames.shift()(32);

if (elements.startScreen.hidden !== true) throw new Error('Start screen did not close');
if (elements.missionHud.hidden !== false) throw new Error('HUD did not open');
if (!elements.inventorySlots.children.length) throw new Error('Inventory slots were not created');
if (!canvasStats.maskDestinationOut) throw new Error('Light mask did not cut out its beam');
if (canvasStats.mainDestinationOut) throw new Error('Light mask erased the main canvas');
if (!canvasStats.mainDrawImages) throw new Error('Light mask was not composited onto the main canvas');
if (!canvasStats.previewFills) throw new Error('Seeded trench preview was not drawn');

console.log('deep-salvage browser smoke: passed');
