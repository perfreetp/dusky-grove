import {
  CREVASSES,
  evaluateBridge,
  passageWindow,
  sunAtHour,
  sunVector,
} from '../src/model.js';

for (const c of CREVASSES) {
  for (const b of c.bridges) {
    const w = passageWindow(b, c);
    const fmt = (h) => h == null ? '—' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    console.log(`\n${b.id} ${b.name} W=${c.width} D=${c.depth} T=${b.thickness} window ${fmt(w.firstPass)}-${fmt(w.lastPass)}`);
    for (const h of [6, 7, 8, 9, 10, 11, 12]) {
      const ev = evaluateBridge(b, c, sunVector(sunAtHour(h)));
      console.log(
        `${fmt(h)} az=${sunAtHour(h).azimuth.toFixed(0)} el=${sunAtHour(h).elevation.toFixed(0)} ` +
        `lit=${ev.deckIlluminated ? 'Y' : 'N'} inc=${ev.incidenceDeg.toFixed(0)} ` +
        `cov=${(ev.shadow.coverage * 100).toFixed(0)}% pass=${ev.passable ? 'Y' : 'N'} ` +
        `qx=${ev.shadow.localX.toFixed(1)} qy=${ev.shadow.localCross.toFixed(1)}`,
      );
    }
  }
}
