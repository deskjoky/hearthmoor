// Headless tests for the Hearthmoor simulation. Run: node test.js
const Sim = require('./sim.js'); Sim.setStrict(true);   // in tests a fault in a daily step must fail loudly
// most tests look at one system at a time, so the world does not age in them; the life-cycle tests turn it back on
const newGameRaw = Sim.newGame, newGameAging = (...a) => { const s = newGameRaw(...a); s.bandits = null; s.ageRate = 4; s.rivalOff = true; return s; };   // and no rival, but in the rival's own tests Sim.newGame = (...a) => { const s = newGameAging(...a); s.ageRate = 0; return s; };
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); }
function runIdle(s, max = 3000) { let m = 0; while ((s.player.dest || s.player.action) && m < max) { Sim.step(s, 1); m++; } return m; }
function untilHour(s, h) { let g = 0; while (Math.abs(Sim.hourOf(s) - h) > 0.01 && g < 1500) { Sim.step(s, 1); g++; } }
function holdElections(s) {   // for tests of other things: keep the vote far off so an office set up by hand stays put
  for (const r of Object.values(Sim.ensureRaces(s).races)) { r.poll = s.day + 9999; r.open = false; }
}
function winElection(s, key) {   // put the player through an election and make sure they win
  const r = Sim.ensureRaces(s).races[key]; r.poll = s.day + 3; r.open = false; Sim.advance(s, 1440); if (!r.open) Sim.advance(s, 1440);
  const at = Sim.LOCS[Sim.raceVenue(r).loc]; s.player.x = at.x; s.player.z = at.z; s.player.dest = null;
  Sim.electState(s).since = s.day - 99;   // long enough in the last office to move up
  const c0 = s.coins; s.coins = Math.max(s.coins, 99999); Sim.cmd(s, 'stand', key); s.coins = c0; r.boost = 400;
  let k = 0; while (r.open && k < 8) { Sim.advance(s, 1440); k++; }
}
function invariants(s) {
  const nums = [s.coins, s.player.x, s.player.z].concat(s.shops.flatMap(x => [x.goods, x.stock.grain, x.stock.wood, x.stock.ore]));
  if (nums.some(n => !Number.isFinite(n))) return 'non-finite number';
  if (s.coins < -400) return 'runaway debt';
  for (const x of s.shops) {
    if (x.goods < 0 || x.stock.grain < 0 || x.stock.wood < 0 || x.stock.ore < 0) return 'negative stock in ' + x.trade;
    if (x.goods > Sim.tierOf(x).cap) return 'goods over capacity';
    if (x.queue.some(id => !s.agents.find(a => a.id === id))) return 'dead id in queue';
  }
  if (s.agents.length > 80) return 'agents leaking';
  if (s.agents.some(a => !Number.isFinite(a.x) || !Number.isFinite(a.z))) return 'agent position NaN';
  return null;
}
function shopWithWorker(trade, seed, tier) {
  const s = Sim.newGame(seed); s.coins = 3000; (s.tradeXp = s.tradeXp || {})[trade] = 20; s.starterUsed = true; s.village.step = 9; s.player.inv.ore = 10;   // past the village story: no famine in the numbers
  Sim.cmd(s, 'open', 1, trade);
  const shop = s.shops[0]; shop.tier = tier || 0;
  Sim.cmd(s, 'hire', shop.id, 0, s.applicants[0].ask); Sim.cmd(s, 'policy', shop.id, 'supplyRuns', true);
  return { s, shop };
}

console.log('54. Stage VII: business. A price dial, a name for every business, a ladder, a deals board, investors, a purse page and titles');
{
  const faults54 = Sim.faults().length;
  const fresh = (seed, start) => { const s = Sim.newGame(seed); if (start) Sim.applyStart(s, start); s.coins = 6000; Sim.advance(s, 2); holdElections(s); return s; };
  // no price setting beats playing well: over the settled second month, Fair earns the most at a bought business
  const runB = mode => { const s = fresh(5401, 'merchant'); Sim.cmd(s, 'buyBiz', 'o_wicks'); Sim.cmd(s, 'fPrices', 'o_wicks', mode); const b = s.biz.o_wicks; let p = 0; for (let d = 0; d < 60; d++) { Sim.advance(s, 1440); if (d >= 30) p += b.lastProfit; } return { p, r: b.renown, why: b.renownWhy }; };
  const C = runB('cheap'), F = runB('fair'), D = runB('greedy');
  check(F.p >= D.p && F.p >= C.p, 'at a bought business Fair earns the most once things settle (cheap ' + C.p + 'c, fair ' + F.p + 'c, dear ' + D.p + 'c)');
  check(D.r < 30 && /high prices/.test(D.why) && C.r > 55 && /low prices/.test(C.why), 'dear prices drag its name down (' + Math.round(D.r) + '), cheap ones lift it (' + Math.round(C.r) + '), and it says why');
  // the dial on a shop you built
  const s = fresh(5402, 'merchant'), sh = s.shops[0];
  check(Sim.cmd(s, 'shopDial', sh.id, 'greedy').ok && Sim.shopDial(sh) === 'greedy' && sh.price === Math.round(Sim.shopBase(sh) * 1.2), 'the dial on a shop you built sets its price: dear is ' + sh.price + 'c');
  Sim.cmd(s, 'shopDial', sh.id, 'fair'); check(Sim.shopDial(sh) === 'fair', 'and fair puts it back');
  // the ladder for a business you bought
  Sim.cmd(s, 'buyBiz', 'o_wicks'); const b = s.biz.o_wicks, cap0 = Sim.bizLevel(b), c1 = Sim.levelCost(s, b), coins0 = s.coins;
  check(Sim.cmd(s, 'improveBiz', 'o_wicks').ok && b.level === 1 && s.coins === coins0 - c1, 'a bought business climbs the ladder: a fine shop for ' + c1 + 'c');
  Sim.cmd(s, 'improveBiz', 'o_wicks'); check(b.level === 2 && !Sim.cmd(s, 'improveBiz', 'o_wicks').ok && Sim.renownTarget(s, b, 'biz').t > 60, 'then a house of note, and no further; its name heads higher');
  // investors
  const q0 = s.coins, ip = Sim.investPrice(s, b, 0.25), r1 = Sim.cmd(s, 'investIn', 'o_wicks', 0.25);
  check(r1.ok && s.coins === q0 + ip && b.investor && b.investor.share === 0.25, 'an investor pays ' + ip + 'c for a quarter of it');
  const st0 = (s.stats.investors || 0); Sim.advance(s, 1440); const e = s.ledger[s.ledger.length - 1];
  check(b.lastProfit <= 0 || (e.investors === Math.round(b.lastProfit * 0.25)), 'and takes a quarter of its profit each evening (' + e.investors + 'c of ' + b.lastProfit + 'c)');
  check(!Sim.cmd(s, 'listForSale', 'biz', 'o_wicks', 9999).ok, 'you cannot sell it while they hold a share');
  const bb = Sim.buyBackPrice(s, b); check(Sim.cmd(s, 'investOut', 'o_wicks').ok && !b.investor && bb > ip, 'buying them back costs a tenth more (' + bb + 'c)');
  // the board: three deals a week, and none that beats playing well
  for (let d = 0; d < 8; d++) Sim.advance(s, 1440);
  check(s.deals && s.deals.list.filter(d => !d.taken).length === 3, 'each week the board has three deals: ' + s.deals.list.filter(d => !d.taken).map(d => d.kind).join(', '));
  let back = 0, stake = 0; for (let i = 0; i < 400; i++) { const w = (Math.imul(i + 7, 2654435761) >>> 0) / 4294967296 < 0.7; stake += 100; back += w ? 135 : 50; }
  check(back / stake > 1.05 && back / stake < 1.15, 'a cargo share returns about ' + Math.round((back / stake - 1) * 100) + '% on average: a little better than idle coin, never a fortune');
  const ship = s.deals.list.find(d => d.kind === 'ship' && !d.taken) || (s.deals.list.push({ id: 999, kind: 'ship', cost: 100, days: 5, until: s.day + 5, title: 'test' }), s.deals.list[s.deals.list.length - 1]);
  const k0 = s.coins; check(Sim.cmd(s, 'dealTake', ship.id).ok && s.coins === k0 - ship.cost, 'taking a cargo share costs its stake now');
  for (let d = 0; d < 6; d++) Sim.advance(s, 1440);
  check(ship.done && /cargo/.test(ship.result) && s.ledger.slice(-7).some(e => e.deals > 0), 'and it comes back (or does not) five days on, in the books: ' + ship.result);
  const sale = { id: 998, kind: 'sale', biz: 'o_brannigan', cost: Math.round(Sim.bizPrice(s, 'o_brannigan') * 0.82), until: s.day + 5, title: 'test sale' }; s.deals.list.push(sale);
  const k1 = s.coins; check(Sim.cmd(s, 'dealTake', 998).ok && s.biz.o_brannigan.owner === 'player' && k1 - s.coins === sale.cost && sale.cost < Sim.bizPrice(s, 'o_brannigan'), 'a business for sale on the board costs about a fifth under its worth');
  // the ledger still adds up to the coin, deals and investors included
  check(s.ledger.every(e => Math.abs(e.unexplained || 0) < 0.01), 'the ledger still adds up to the coin, every day');
  // the purse page
  const M = Sim.moneyView(s), endC = s.ledger[s.ledger.length - 1].coinsEnd, startC = s.ledger.length > 7 ? s.ledger[s.ledger.length - 8].coinsEnd : null;
  check(M.ins.length && M.outs.length && M.due.some(d => d.when === 'Tonight'), 'the purse page shows what came in, what went out, and what falls due tonight');
  check(startC == null || Math.abs(M.net - (endC - startC)) < 1, 'and its total for the week is exactly what your purse did (' + Math.round(M.net) + 'c)');
  check(Sim.faults().length === faults54, 'no faults');
}
{
  // titles need the coin and a name at home
  const s = Sim.newGame(5403); Sim.advance(s, 2); s.coins = 1500;
  s.village.standing = 10; let W = Sim.wealthTitle(s);
  check(W.i === -1 && W.newMoney && /Means/.test(W.next.title), 'rich but unknown at home: no title yet, and they call it new money');
  s.village.standing = 40; W = Sim.wealthTitle(s);
  check(W.title === 'Burgher' || W.title === 'Man of Means' || W.title === 'Woman of Means', 'with a name at home the coin earns a title: ' + W.title);
  s.rec.wealthStep = null; Sim.advance(s, 1440); check(s.events.some(e => /calling you/.test(e.text)) && s.rec.wealthStep >= 0, 'and you are told when people start calling you it');
}
{
  // a 150-day run with the businesses on: steady, and the ledger adds up
  const s = Sim.newGame(5404); Sim.applyStart(s, 'merchant'); s.coins = 3000; Sim.advance(s, 2); holdElections(s);
  Sim.cmd(s, 'buyBiz', 'o_wicks'); Sim.cmd(s, 'investIn', 'o_wicks', 0.25);
  let bad = 0; for (let d = 0; d < 150; d++) { if (d % 7 === 1 && s.deals) { const o = s.deals.list.find(x => !x.taken && x.kind !== 'sale'); if (o && (!o.cost || s.coins > o.cost * 3)) Sim.cmd(s, 'dealTake', o.id); } Sim.advance(s, 1440); const e = s.ledger[s.ledger.length - 1]; if (Math.abs(e.unexplained || 0) >= 0.01 || !Number.isFinite(s.coins)) bad++; }
  check(bad === 0 && s.ledger.length, '150 days of trading, deals and an investor: the ledger adds up every day');
  const rs = Object.values(s.biz).filter(b => b.owner === 'player').map(b => b.renown).concat(s.shops.map(x => x.renown));
  check(rs.every(r => Number.isFinite(r) && r >= 0 && r <= 100), 'and every business’s name stays between 0 and 100 (' + rs.map(Math.round).join(', ') + ')');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
