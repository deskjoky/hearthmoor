// Headless tests for the Hearthmoor simulation. Run: node test.js
const Sim = require('./sim.js');
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); }
function runIdle(s, max = 3000) { let m = 0; while ((s.player.dest || s.player.action) && m < max) { Sim.step(s, 1); m++; } return m; }
function untilHour(s, h) { let g = 0; while (Math.abs(Sim.hourOf(s) - h) > 0.01 && g < 1500) { Sim.step(s, 1); g++; } }
function invariants(s) {
  const nums = [s.coins, s.player.x, s.player.z].concat(s.shops.flatMap(x => [x.goods, x.stock.grain, x.stock.wood, x.stock.ore]));
  if (nums.some(n => !Number.isFinite(n))) return 'non-finite number';
  if (s.coins < 0) return 'negative coin';
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
  const s = Sim.newGame(seed); s.coins = 3000; s.trades[trade] = 5; s.player.inv.ore = 10;
  Sim.cmd(s, 'open', 1, trade);
  const shop = s.shops[0]; shop.tier = tier || 0;
  Sim.cmd(s, 'hire', shop.id, 0, s.applicants[0].ask); Sim.cmd(s, 'policy', shop.id, 'supplyRuns', true);
  return { s, shop };
}

console.log('1. Jobs: hiring on, shifts, pay, learning, one job at a time');
{
  const s = Sim.newGame(11);
  const r = Sim.cmd(s, 'apply', 'gerd');
  check(r.ok && s.job && s.job.emp === 'gerd', 'got a job at the bakehouse');
  check(!Sim.cmd(s, 'apply', 'forge').ok, 'cannot take a second job at the same time');
  const c0 = s.coins;
  for (let d = 0; d < 2; d++) {
    Sim.cmd(s, 'work'); runIdle(s);
    untilHour(s, 12.1);
    Sim.advance(s, 1440 - 6);
    untilHour(s, 6.0);
  }
  check(s.job.shifts >= 2 && s.coins === c0 + 6 * s.job.shifts, s.job.shifts + ' shifts paid 6c each (coins ' + c0 + ' -> ' + s.coins + ')');
  check(Sim.learned(s, 'bakery'), 'two shifts teach the bakery trade');
  check(!Sim.learned(s, 'smithy'), 'smithing is still unknown');
  const q = Sim.cmd(s, 'quitJob');
  check(q.ok && !s.job, 'quitting frees you to work elsewhere');
  check(Sim.cmd(s, 'apply', 'forge').ok, 'took a job at the forge after quitting');
}

console.log('2. Missing shifts: warning, then fired, with no lasting penalty');
{
  const s = Sim.newGame(12);
  Sim.cmd(s, 'apply', 'ash');
  const fired = [];
  for (let d = 0; d < 4 && s.job; d++) { Sim.advance(s, 1440); }
  check(!s.job, 'fired after missing shifts');
  check(s.rec.timesFired === 1 && s.rec.shiftsMissed === 3, 'three missed shifts recorded, one firing');
  check(s.events.some(e => /one more shift/.test(e.text)) || s.ledger.some(l => l.notes.some(n => /2 of 3/.test(n.text))), 'a warning came before the firing');
  check(Sim.cmd(s, 'apply', 'ash').ok, 'can ask for work again straight away');
}

console.log('3. You must learn a trade before opening that shop');
{
  const s = Sim.newGame(13); s.coins = 500;
  check(!Sim.cmd(s, 'open', 0, 'smithy').ok, 'cannot open a smithy without learning smithing');
  s.trades.smithy = 2;
  check(!Sim.cmd(s, 'open', 0, 'smithy').ok, 'a smithy also needs 4 ore');
  s.player.inv.ore = 4;
  check(Sim.cmd(s, 'open', 0, 'smithy').ok && s.shops.length === 1 && s.player.inv.ore === 0 && s.coins === 440, 'opened a smithy for 60c and 4 ore');
  check(!Sim.cmd(s, 'open', 0, 'smithy').ok, 'a lot can only hold one shop');
}

console.log('4. Every trade can make a profit with a worker buying supplies');
{
  const rows = [];
  for (const trade of Sim.TRADE_KEYS) for (const tier of [0, 1]) {
    const { s } = shopWithWorker(trade, 77, tier);
    Sim.advance(s, 1440 * 9);
    const days = s.ledger.slice(2);
    const avg = k => days.reduce((a, d) => a + d.shops[0][k], 0) / days.length;
    rows.push({ trade, tier: Sim.TRADES[trade].tiers[tier].name, 'sold/day': avg('sold').toFixed(1), 'revenue/day': avg('revenue').toFixed(1), 'profit/day': avg('profit').toFixed(1), 'lost to price': avg('tooExpensive').toFixed(1), 'empty shelf': avg('soldOut').toFixed(1) });
  }
  console.table(rows);
  check(rows.every(r => +r['profit/day'] > 0), 'every trade turns a profit at its default price');
}

console.log('5. Price changes demand (no unlimited-money button)');
{
  const rows = [];
  for (const price of [2, 4, 5, 6, 8, 12]) {
    const { s, shop } = shopWithWorker('bakery', 99);
    Sim.cmd(s, 'setPrice', shop.id, price);
    Sim.advance(s, 1440 * 8);
    const days = s.ledger.slice(2), sum = k => days.reduce((a, d) => a + d.shops[0][k], 0) / days.length;
    rows.push({ price, sold: sum('sold'), profit: sum('profit') });
  }
  console.table(rows.map(r => ({ price: r.price, 'loaves/day': r.sold.toFixed(1), 'profit/day': r.profit.toFixed(1) })));
  const by = p => rows.find(r => r.price === p);
  check(by(2).sold > by(8).sold && by(8).sold >= by(12).sold, 'higher prices sell fewer loaves');
  check(by(12).profit < by(5).profit && by(2).profit < by(5).profit, 'extreme prices earn less than a fair price');
}

console.log('6. Broke players can always recover');
{
  const s = Sim.newGame(7); s.coins = 0;
  Sim.cmd(s, 'gather', 'wood'); runIdle(s);
  Sim.cmd(s, 'goto', 'market'); runIdle(s);
  const r = Sim.cmd(s, 'sell', 'wood', s.player.inv.wood);
  check(r.ok && s.coins === 20, 'gathered and sold wood for ' + s.coins + 'c with nothing to start');
  check(Sim.cmd(s, 'apply', 'tankard').ok, 'and a job is always available');
}

console.log('7. Save and restore mid-task gives identical futures');
{
  const { s: a, shop } = shopWithWorker('smithy', 3);
  Sim.cmd(a, 'apply', 'ash');
  Sim.cmd(a, 'gather', 'ore');
  let guard = 0;
  while (!(shop.worker.task === 'craft' && shop.work.loaded && shop.work.progress > 5) && guard < 5000) { Sim.step(a, 1); guard++; }
  check(shop.worker.task === 'craft' && a.player.action, 'paused while the smith is mid-forge and you are mid-dig');
  const b = Sim.deserialize(Sim.serialize(a));
  check(JSON.stringify(b.player.inv) === JSON.stringify(a.player.inv) && b.coins === a.coins && b.job.emp === 'ash', 'inventory, coins and job restored');
  check(b.shops[0].worker.task === 'craft' && b.shops[0].work.progress === shop.work.progress, 'worker task and work progress restored');
  Sim.advance(a, 3000); Sim.advance(b, 3000);
  check(Sim.serialize(a) === Sim.serialize(b), 'both copies play out identically for 3000 more minutes');
  let bad = false; try { Sim.deserialize('{"hello":1}'); } catch (e) { bad = true; }
  check(bad, 'rejects a file that is not a save');
}

console.log('8. Old saves from the first version still load');
{
  let Old = null;
  try { Old = require('/home/claude/game/sim.js'); } catch (e) { }
  if (!Old || Old.VERSION !== 1) console.log('  (skipped: first-version sim not on disk)');
  else {
    const o = Old.newGame(5); o.coins = 77; o.tier = 1; Old.cmd(o, 'hire', 0, 9); Old.advance(o, 2000);
    const s = Sim.deserialize(Old.serialize(o));
    check(s.v === 2 && s.shops.length === 1 && s.shops[0].trade === 'bakery' && s.shops[0].tier === 1, 'v1 bakery becomes a Timber Bakery on the Middle lot');
    check(s.coins === o.coins && s.shops[0].worker && s.shops[0].worker.name === o.worker.name, 'coins and worker carried over');
    Sim.advance(s, 1440 * 2);
    check(!invariants(s), 'migrated game keeps running');
  }
}

console.log('9. Forty-day soak: from hired hand to two businesses');
{
  const s = Sim.newGame(2024);
  let problem = null, maxSupply = 0, run = 0;
  const log = [];
  for (let m = 0; m < 1440 * 40 && !problem; m++) {
    const h = Sim.hourOf(s), p = s.player;
    if (!p.dest && !p.action && h >= 6 && h < 20) {
      const bakery = s.shops.find(x => x.trade === 'bakery'), smithy = s.shops.find(x => x.trade === 'smithy');
      // staff and upgrades first
      for (const x of s.shops) {
        if (!x.worker && s.applicants.length && s.coins >= 25) { Sim.cmd(s, 'hire', x.id, 0, s.applicants[0].ask); Sim.cmd(s, 'policy', x.id, 'supplyRuns', true); }
        if (Sim.cmd(s, 'upgrade', x.id).ok) log.push('D' + s.day + ' upgrade ' + x.trade);
      }
      if (!s.job && !bakery) Sim.cmd(s, 'apply', 'gerd');
      if (s.job && s.job.emp === 'gerd' && Sim.learned(s, 'bakery') && bakery && bakery.worker) { Sim.cmd(s, 'quitJob'); Sim.cmd(s, 'apply', 'forge'); }
      if (s.job && s.job.emp === 'forge' && Sim.learned(s, 'smithy') && smithy) Sim.cmd(s, 'quitJob');
      if (!bakery && Sim.learned(s, 'bakery') && s.coins >= 30) { Sim.cmd(s, 'open', 1, 'bakery'); log.push('D' + s.day + ' opened bakery'); }
      if (bakery && !smithy && Sim.learned(s, 'smithy') && s.coins >= 60 && p.inv.ore >= 4) { Sim.cmd(s, 'open', 2, 'smithy'); log.push('D' + s.day + ' opened smithy'); }
      if (s.job && Sim.inShift(s)) { if (!Sim.playerAtWork(s)) Sim.cmd(s, 'work'); }
      else if (s.job && Sim.hourOf(s) > Sim.empById(s.job.emp).shift[0] - 1.2 && Sim.hourOf(s) < Sim.empById(s.job.emp).shift[0]) Sim.cmd(s, 'work');
      else if (bakery && !bakery.worker && bakery.goods > 0) { if (Sim.dist(p, Sim.plotPt(bakery, 'serve')) > 0.5) Sim.cmd(s, 'serve', bakery.id); }
      else if (bakery && !bakery.worker && (bakery.stock.grain >= 2 && bakery.stock.wood >= 1)) Sim.cmd(s, 'craft', bakery.id);
      else if (bakery && !bakery.worker && bakery.stock.grain < 2 && Sim.carried(s) < 6) Sim.cmd(s, 'gather', 'grain');
      else if (Sim.learned(s, 'smithy') && !smithy && p.inv.ore < 4) Sim.cmd(s, 'gather', 'ore');
      else if (Sim.carried(s) >= 14 && s.shops.length) Sim.cmd(s, 'store', (s.shops.find(x => x.stock.wood < Sim.tierOf(x).cap - 6) || s.shops[0]).id);
      else Sim.cmd(s, 'gather', 'wood');
      if (p.action && p.action.type === 'gather') p.action.left = Math.min(p.action.left, 50);
    }
    if (p.action && p.action.type === 'gather' && (Sim.carried(s) >= 14 || (s.job && Sim.inShift(s)))) Sim.cmd(s, 'stop');
    Sim.step(s, 1);
    problem = invariants(s);
    const sup = s.shops.some(x => x.worker && x.worker.task === 'supply');
    run = sup ? run + 1 : 0; maxSupply = Math.max(maxSupply, run);
  }
  console.log('   ' + log.join(', '));
  const last = s.ledger.slice(-3);
  console.log('   last days:', last.map(d => `D${d.day}: ${d.profit}c (${d.shops.map(x => x.trade + ' ' + x.profit).join(', ')})`).join(' | '));
  console.log('   records:', JSON.stringify({ coins: s.coins, netWorth: Sim.netWorth(s), shifts: s.rec.shiftsWorked, made: s.rec.made, sold: s.rec.goodsSold, walked: Math.round(s.rec.walked) }));
  check(!problem, 'no invariant broken' + (problem ? ': ' + problem : ''));
  check(maxSupply < 150, 'supply runs finish (longest ' + maxSupply + ' min)');
  check(s.shops.length >= 2, 'bot owns two businesses');
  check(s.shops.some(x => x.tier >= 1), 'bot upgraded a shop');
  check(last.every(d => d.shops.every(x => x.notes.length > 0)), 'every shop gets a ledger explanation every day');
  check(s.rec.coinsEarned > 0 && s.rec.walked > 1000 && s.rec.made.bread > 0, 'records are being kept');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
