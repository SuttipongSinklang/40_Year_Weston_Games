import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunMap } from '../webgame/js/run-map.js';

function fixture() {
  const calls = { imports: 0, fits: [], dots: [], layers: [], events: [] };
  const map = { setView() { return this; }, invalidateSize() {}, removeLayer() {},
    fitBounds(points) { calls.fits.push(points); } };
  const leaflet = {
    map: () => map, control: { zoom: () => ({ addTo() {} }) },
    layerGroup() {
      const layer = { dots: new Set(), addTo() { return this; }, clearLayers() { this.dots.clear(); },
        removeLayer(dot) { this.dots.delete(dot); } };
      calls.layers.push(layer); return layer;
    },
    tileLayer: () => ({ on() {}, addTo() {} }),
    polyline: () => ({ addTo() {} }),
    divIcon: options => options,
    marker(coords, options) {
      const marker = { coords, options, addTo() { calls.events.push(this); return this; }, bindTooltip(label) { this.label = label; return this; } };
      return marker;
    },
    circleMarker(coords) {
      const dot = { coords, addTo(layer) { layer.dots.add(this); return this; },
        bindTooltip(label) { this.label = label; }, setLatLng(value) { this.coords = value; } };
      calls.dots.push(dot); return dot;
    },
  };
  const controller = createRunMap({ container: { clientWidth: 390, clientHeight: 240 },
    sketch: { replaceChildren() {}, toggleAttribute() {}, appendChild() {} }, empty: {}, message: {},
    loadLeaflet: async () => { calls.imports++; return leaflet; } });
  return { controller, calls };
}
const person = { user_id: 'one', display_name: '<img src=x onerror=alert(1)>', lat: 13, lng: 100 };

test('live points never load the street map before map consent', () => {
  const { controller, calls } = fixture(); controller.renderPeople([person]);
  assert.equal(calls.imports, 0); assert.equal(calls.dots.length, 0);
});
test('live markers move and withdraw without changing the user viewport; names are text', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ textContent: '' }) };
  try {
    const { controller, calls } = fixture(); await controller.setBasemap(true);
    controller.renderPeople([person]);
    assert.equal(calls.dots[0].label.textContent, person.display_name);
    controller.renderPeople([{ ...person, lat: 14 }]);
    assert.equal(calls.dots.length, 1); assert.deepEqual(calls.dots[0].coords, [14, 100]);
    assert.equal(calls.fits.length, 0);
    controller.centerPeople('one'); assert.deepEqual(calls.fits.at(-1), [[14, 100]]);
    controller.renderPeople([]); assert.equal(calls.layers[1].dots.size, 0);
    controller.centerPeople(); assert.equal(calls.fits.length, 1);
  } finally { globalThis.document = previous; }
});

test('numbered pause/resume markers render in both street map and offline sketch', async () => {
 const previous=globalThis.document, nodes=[];
 globalThis.document={createElement:()=>({textContent:''}),createElementNS:(_,tag)=>{
   const node={tag,attrs:{},children:[],setAttribute(k,v){this.attrs[k]=v;},append(...v){this.children.push(...v);},appendChild(v){this.children.push(v);}};
   nodes.push(node);return node;
 }};
 try {
  const {controller,calls}=fixture();
  const run={points:[{lat:13,lng:100,segment:0},{lat:13.001,lng:100,segment:0}],events:[
    {type:'pause',index:1,lat:13.001,lng:100},{type:'resume',index:1,lat:13.002,lng:100},
    {type:'resume',index:2,lat:null,lng:null}]};
  // SVG draws the same event labels before the street library is loaded.
  controller.render(run);
  assert.deepEqual(nodes.filter(n=>n.tag==='text').map(n=>n.textContent),['P1','R1']);
  await controller.setBasemap(true);
  assert.deepEqual(calls.events.map(m=>m.options.icon.html),['P1','R1']);
  assert.equal(calls.events[1].label.textContent,'วิ่งต่อครั้งที่ 1');
  assert.equal(calls.fits.length,1);
 } finally {globalThis.document=previous;}
});

import { gpsGaps } from '../webgame/js/run-map.js';
test('GPS-gap warning counts missing recording intervals, excluding explicit pauses',()=>{
 const run={points:[{timestamp:0,segment:0},{timestamp:60000,segment:1},{timestamp:120000,segment:2}],events:[{type:'pause',at:70000}]};
 assert.equal(gpsGaps(run),1);
});
