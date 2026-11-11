// Prototype of the new Oakbridge: a bridge town laid out the way such towns grew. Same shape of data as Sim.OAK, so it can be ported.
const Sim = require('../src/sim.js'); const O0 = Sim.OAK; const riverX = O0.riverX;
const segD = (x, z, pts) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return best; };
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const gate = { x: O0.gate.x, z: O0.gate.z }, bridge = O0.bridge;
const M0 = [404, -380], M1 = [422, -409];                                   // the market place: the high street widened at the bridgehead
const mdx = M1[0] - M0[0], mdz = M1[1] - M0[1], ml = Math.hypot(mdx, mdz), mn = [-mdz / ml, mdx / ml], MW = 9.5;
const market = [[M0[0] + mn[0] * MW, M0[1] + mn[1] * MW], [M1[0] + mn[0] * MW, M1[1] + mn[1] * MW], [M1[0] - mn[0] * MW, M1[1] - mn[1] * MW], [M0[0] - mn[0] * MW, M0[1] - mn[1] * MW]];
const hallSq = { x: 490, z: -429, hx: 13, hz: 11 };
const hallPoly = [[477, -440], [503, -440], [503, -418], [477, -418]];
const qx = z => riverX(z) - 13.5, ex = z => riverX(z) + 14;
const streets = [
  { name: 'High Street', w: 5, pts: [[gate.x + 2, gate.z - 3], [392, -356], M0] },
  { name: 'High Street', w: 5, pts: [M1, [bridge.ax, bridge.az]] },
  { name: 'Bridge Street', w: 4.6, pts: [[bridge.bx, bridge.bz], [477, -428]] },
  { name: 'East Street', w: 4.4, pts: [[503, -419], [518, -420], [528, -428], [536, -436]] },
  { name: 'Guild Row', w: 4, pts: [[404, -403], [392, -430], [385, -462], [388, -500], [396, -536]] },
  { name: 'The Quay', w: 4, pts: [[qx(-426), -426], [qx(-450), -450], [qx(-480), -480], [qx(-515), -515]] },
  { name: 'Fish Lane', w: 3, pts: [[387, -452], [qx(-452), -452]] },
  { name: 'Ropewalk', w: 3, pts: [[388, -500], [qx(-506), -506]] },
  { name: 'Church Lane', w: 3.2, pts: [[392, -356], [374, -370], [362, -392]] },
  { name: 'West Lane', w: 3.2, pts: [[397, -393], [376, -404], [362, -392]] },
  { name: 'Weavers’ Lane', w: 3.2, pts: [[376, -404], [360, -430], [356, -462], [385, -462]] },
  { name: 'Mill Lane', w: 3.2, pts: [[410, -377], [430, -368], [riverX(-362) - 13, -362]] },
  { name: 'Keep Street', w: 4, pts: [[490, -440], [487, -462], [485, -478]] },
  { name: 'Riverbank', w: 3.4, pts: [[bridge.bx + 2, bridge.bz - 4], [ex(-450), -450], [ex(-476), -476], [485, -478]] },
  { name: 'Tanners’ Lane', w: 3.2, pts: [[492, -418], [497, -392], [492, -362]] },
  { name: 'Back Lane', w: 3, pts: [[497, -392], [ex(-384), -384]] },
  { name: 'Smiths’ Lane', w: 3.2, pts: [[392, -430], [410, -440], [qx(-440), -440]] },
  { name: 'North Lane', w: 3, pts: [[388, -500], [366, -498], [352, -480], [356, -462]] },
  { name: 'Gate Lane', w: 3, pts: [[392, -356], [410, -346], [432, -340]] },
  { name: 'Masons’ Row', w: 3.2, pts: [[497, -392], [514, -388], [524, -402], [520, -433]] },
  { name: 'Chandlers’ Lane', w: 3.2, pts: [[487, -462], [505, -466], [516, -452], [520, -433]] }
];
const wall = [[gate.x, gate.z], [354, -348], [338, -388], [336, -440], [346, -492], [368, -528], [396, -540], [428, -548], [riverX(-546), -546], [476, -540], [506, -520], [524, -482], [536, -436], [530, -396], [514, -360], [490, -338], [riverX(-330), -330], [432, -322], [402, -318]];
const gates = [{ name: 'South Gate', x: gate.x, z: gate.z }, { name: 'North Gate', x: 396, z: -540 }, { name: 'East Gate', x: 536, z: -436 }];
const keep = { x: 484, z: -494 }, church = { x: 366, z: -380, face: Math.atan2(374 - 366, -370 + 380) }, hall = { x: 510, z: -429, face: -Math.PI / 2 }, guildhall = { x: 376, z: -480, face: Math.PI / 2 };
const fixed = [{ x: keep.x, z: keep.z, r: 15 }, { x: church.x, z: church.z, r: 11 }, { x: hall.x, z: hall.z, r: 10 }, { x: guildhall.x, z: guildhall.z, r: 9 }, { x: riverX(-362) - 12, z: -356, r: 7 }];
// lots: walk each street, both sides, a house-width apart; keep the ones that have room
const lots = [];
const ok = (x, z, si) => {
  if (!inPoly(x, z, wall) || segD(x, z, wall.concat([wall[0]])) < 6) return false;
  if (Math.abs(x - riverX(z)) < 17) return false;
  if (inPoly(x, z, market) || segD(x, z, market.concat([market[0]])) < 4.6) return false;
  if (inPoly(x, z, hallPoly) || segD(x, z, hallPoly.concat([hallPoly[0]])) < 4.6) return false;
  if (fixed.some(f => Math.hypot(x - f.x, z - f.z) < f.r)) return false;
  if (streets.some((st, j) => segD(x, z, st.pts) < st.w / 2 + (j === si ? 3.6 : 3.9))) return false;
  if (lots.some(l => Math.hypot(x - l.x, z - l.z) < 6.1)) return false;
  return true;
};
const along = (si, tag) => { const st = streets[si], pts = st.pts; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len; for (let d = 3.2; d < len - 1; d += 6.3) for (const side of [1, -1]) { const off = st.w / 2 + 4.1, x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side; if (ok(x, z, si)) lots.push({ x, z, face: Math.atan2(-nx * side, -nz * side), tag: tag || st.name, si }); } } };
// the market place and the hall square are fronted on their long sides first
const front = (P, tag) => { for (let e = 0; e < P.length; e++) { const [ax, az] = P[e], [bx, bz] = P[(e + 1) % P.length], len = Math.hypot(bx - ax, bz - az); if (len < 15) continue; const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length; let nx = -(bz - az) / len, nz = (bx - ax) / len; if ((ax + nx - cx) ** 2 + (az + nz - cz) ** 2 < (ax - cx) ** 2 + (az - cz) ** 2) { nx = -nx; nz = -nz; } for (let d = 4.4; d < len - 3; d += 8.2) { const x = ax + (bx - ax) * d / len + nx * 5, z = az + (bz - az) * d / len + nz * 5; if (Math.abs(x - riverX(z)) > 17 && !streets.some(st => segD(x, z, st.pts) < st.w / 2 + 3.9) && !lots.some(l => Math.hypot(x - l.x, z - l.z) < 7.6) && !fixed.some(f => Math.hypot(x - f.x, z - f.z) < f.r)) lots.push({ x, z, face: Math.atan2(-nx, -nz), tag, prime: true }); } } };
front(market, 'market'); front(hallPoly, 'east');
streets.forEach((st, i) => along(i));
// businesses take the best frontage for their quarter; houses fill the rest, nearest the centre first
const want = { market: l => l.tag === 'market' || l.tag === 'High Street', guild: l => l.tag === 'Guild Row' || l.tag === 'Weavers’ Lane', riverside: l => l.tag === 'The Quay' || l.tag === 'Fish Lane', east: l => l.tag === 'east' || l.tag === 'Bridge Street' || l.tag === 'East Street' || l.tag === 'Tanners’ Lane' };
const biz = []; for (const b of O0.biz) { let pool = lots.filter(l => !l.used && want[b.district](l)).sort((p, q) => (q.prime ? 1 : 0) - (p.prime ? 1 : 0) || (b.district === 'market' ? Math.hypot(p.x - 413, p.z + 395) - Math.hypot(q.x - 413, q.z + 395) : 0)); if (b.id === 'o_tannery') pool = lots.filter(l => !l.used && l.tag === 'Tanners’ Lane').reverse(); if (b.id === 'o_mill') pool = []; const l = pool[0]; if (l) { l.used = true; biz.push(Object.assign({}, b, { x: l.x, z: l.z, face: l.face })); } else biz.push(Object.assign({}, b, b.id === 'o_mill' ? { x: riverX(-362) - 12, z: -356, face: Math.PI } : { x: NaN })); }
const free = lots.filter(l => !l.used).sort((a, b) => Math.hypot(a.x - 430, a.z + 415) - Math.hypot(b.x - 430, b.z + 415));
const houses = free.slice(0, 125).map((l, i) => ({ x: l.x, z: l.z, face: l.face, tall: i < 45 }));
module.exports = { streets, wall, gates, market, hallPoly, hallSq, keep, church, hall, guildhall, biz, houses, lots, bridge, gate, riverX };
if (require.main === module) console.log('lots', lots.length, 'biz placed', biz.filter(b => !isNaN(b.x)).length, '/', biz.length, 'unplaced', biz.filter(b => isNaN(b.x)).map(b => b.id + ':' + b.district).join(','), 'houses', houses.length, 'spare lots', free.length - houses.length);
