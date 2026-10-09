export const locatedEvents = run => (run?.events || []).filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng));
export function gpsGaps(run) {
  const points = run?.points || [], pauses = (run?.events || []).filter(e => e.type === 'pause');
  return points.slice(1).filter((point, i) => point.timestamp - points[i].timestamp > 30000
    && point.segment !== points[i].segment
    && !pauses.some(e => e.at >= points[i].timestamp && e.at <= points[i].timestamp + 30000
      && e.at <= point.timestamp)).length;
}
const eventLabel = e => `${e.type === 'pause' ? 'พัก' : 'วิ่งต่อ'}ครั้งที่ ${e.index}`;
const SVG = 'http://www.w3.org/2000/svg';
export function createRunMap({ container, sketch, empty, message,
  loadLeaflet = () => import('../assets/vendor/leaflet/dist/leaflet-src.esm.js') }) {
  let map, leaflet, layer, marker, tiles, run, consent = false, loading, peopleLayer;
  let people = [], hadRoute = false;
  const peopleMarkers = new Map();
  function updatePeople() {
    if (!peopleLayer) return;
    const ids = new Set(people.map(person => person.user_id));
    for (const [id, dot] of peopleMarkers) {
      if (!ids.has(id)) { peopleLayer.removeLayer(dot); peopleMarkers.delete(id); }
    }
    for (const person of people) {
      let dot = peopleMarkers.get(person.user_id);
      if (!dot) {
        dot = leaflet.circleMarker([person.lat, person.lng], { radius: 10, color: '#fff', weight: 3,
          fillColor: '#1E3A5F', fillOpacity: 1 }).addTo(peopleLayer);
        const label = document.createElement('span'); label.textContent = person.display_name;
        dot.bindTooltip(label, { direction: 'top' });
        peopleMarkers.set(person.user_id, dot);
      } else dot.setLatLng([person.lat, person.lng]);
    }
  }
  function drawSketch() {
    sketch.replaceChildren();
    const points = run?.points || [];
    empty.hidden = points.length > 0 || Boolean(map && consent);
    if (!points.length) return;
    const origin = points[0], cos = Math.max(0.01, Math.cos(origin.lat * Math.PI / 180));
    const xy = points.map(p => [(((p.lng - origin.lng + 540) % 360) - 180) * cos, -p.lat]);
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(...xs) - x0, dy = Math.max(...ys) - y0;
    const scale = Math.min(270 / Math.max(dx, 0.0001), 190 / Math.max(dy, 0.0001));
    const project = p => [25 + (270 - dx * scale) / 2 + (p[0] - x0) * scale, 25 + (190 - dy * scale) / 2 + (p[1] - y0) * scale];
    const paths = new Map();
    points.forEach((p, i) => {
      if (!paths.has(p.segment)) paths.set(p.segment, []);
      paths.get(p.segment).push(project(xy[i]).join(','));
    });
    for (const path of paths.values()) {
      const line = document.createElementNS(SVG, 'polyline');
      line.setAttribute('class', 'run-trace'); line.setAttribute('points', path.join(' ')); sketch.appendChild(line);
    }
    for (const [i, className] of [[0, 'run-start-dot'], [points.length - 1, 'run-end-dot']]) {
      const dot = document.createElementNS(SVG, 'circle'), [x, y] = project(xy[i]);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', '6'); dot.setAttribute('class', className); sketch.appendChild(dot);
    }
    for (const event of locatedEvents(run)) {
      const [x, y] = project([(((event.lng - origin.lng + 540) % 360) - 180) * cos, -event.lat]);
      const group = document.createElementNS(SVG, 'g');
      group.setAttribute('transform', `translate(${x},${y})`);
      group.setAttribute('class', `run-event-${event.type}`);
      const dot = document.createElementNS(SVG, 'circle'); dot.setAttribute('r', '13');
      const label = document.createElementNS(SVG, 'text'); label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '4'); label.textContent = `${event.type === 'pause' ? 'P' : 'R'}${event.index}`;
      const title = document.createElementNS(SVG, 'title'); title.textContent = eventLabel(event);
      group.append(dot, label, title); sketch.appendChild(group);
    }
  }
  function updateMap(fit = true) {
    if (!map || !container.clientWidth || !container.clientHeight) return;
    layer.clearLayers();
    const segments = new Map();
    for (const p of run?.points || []) {
      if (!segments.has(p.segment)) segments.set(p.segment, []);
      segments.get(p.segment).push([p.lat, p.lng]);
    }
    for (const points of segments.values()) leaflet.polyline(points, { color: '#ED233B', weight: 5 }).addTo(layer);
    const points = run?.points || [];
    for (const event of locatedEvents(run)) {
      const label = document.createElement('span'); label.textContent = eventLabel(event);
      const badge = leaflet.divIcon({ className: `run-event-marker run-event-${event.type}`,
        html: `${event.type === 'pause' ? 'P' : 'R'}${Number(event.index)}`, iconSize: [30, 30], iconAnchor: [15, 15] });
      leaflet.marker([event.lat, event.lng], { icon: badge, title: eventLabel(event) })
        .addTo(layer).bindTooltip(label, { direction: 'top' });
    }
    if (marker) { layer.removeLayer(marker); marker = undefined; }
    if (points.length) {
      const first = points[0];
      leaflet.circleMarker([first.lat, first.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2E9B47', fillOpacity: 1 }).addTo(layer);
      const last = points.at(-1);
      marker = leaflet.circleMarker([last.lat, last.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#ED233B', fillOpacity: 1 }).addTo(layer);
      if (fit) {
        if (points.length > 1) map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [24, 24], maxZoom: 17, animate: false });
        else map.setView([last.lat, last.lng], 16, { animate: false });
      }
    }
  }
  async function setBasemap(enabled) {
    consent = enabled;
    if (!enabled) {
      if (tiles && map) map.removeLayer(tiles);
      container.hidden = true; sketch.toggleAttribute('hidden', false); drawSketch(); return;
    }
    try {
      if (!leaflet) {
        loading ||= loadLeaflet();
        leaflet = await loading;
      }
      if (!consent) return;
      container.hidden = false; sketch.toggleAttribute('hidden', true); empty.hidden = true;
      if (!map) {
        map = leaflet.map(container, { zoomControl: false, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false }).setView([13.7563, 100.5018], 11);
        leaflet.control.zoom({ zoomInTitle: 'ขยายแผนที่', zoomOutTitle: 'ย่อแผนที่' }).addTo(map);
        layer = leaflet.layerGroup().addTo(map);
        peopleLayer = leaflet.layerGroup().addTo(map);
        tiles = leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
        tiles.on('tileerror', () => { message.textContent = 'โหลดแผนที่ไม่ครบ แต่เส้นทางยังบันทึกต่อได้'; });
      }
      tiles.addTo(map); map.invalidateSize(); updateMap(); updatePeople();
      message.textContent = run?.points.length ? `เส้นทางส่วนตัว · P = พัก / R = วิ่งต่อ${gpsGaps(run) ? ` · GPS ขาด ${gpsGaps(run)} ช่วง ไม่รวมระยะทางช่วงที่ขาด` : ''}` : 'รอตำแหน่ง GPS · แผนที่เริ่มที่กรุงเทพฯ';
    } catch {
      loading = undefined; container.hidden = true; sketch.toggleAttribute('hidden', false); drawSketch();
      message.textContent = 'เปิดแผนที่ไม่ได้ ยังดูเส้นทางและบันทึกการวิ่งได้';
    }
  }
  return {
    render(value) {
      run = value; drawSketch();
      const hasRoute = Boolean(run?.points.length);
      if (consent) updateMap(hasRoute && !hadRoute);
      hadRoute = hasRoute;
    },
    renderPeople(value) { people = value; updatePeople(); },
    centerPeople(id) {
      if (!map || !consent || !people.length) return;
      const target = id ? people.filter(person => person.user_id === id) : people;
      if (target.length) map.fitBounds(target.map(person => [person.lat, person.lng]), { padding: [28, 28], maxZoom: 16, animate: false });
    },
    setBasemap,
    resize() { if (map && consent) { map.invalidateSize(); updateMap(false); } },
    center() { updateMap(); },
  };
}
