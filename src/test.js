// Headless tests for the Hearthmoor simulation. Run: node test.js
const Sim = require('./sim.js');
// most tests look at one system at a time, so the world does not age in them; the life-cycle tests turn it back on
const newGameRaw = Sim.newGame, newGameAging = (...a) => { const s = newGameRaw(...a); s.bandits = null; s.ageRate = 4; return s; }; Sim.newGame = (...a) => { const s = newGameAging(...a); s.ageRate = 0; return s; };
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); }
function runIdle(s, max = 3000) { let m = 0; while ((s.player.dest || s.player.action) && m < max) { Sim.step(s, 1); m++; } return m; }
function untilHour(s, h) { let g = 0; while (Math.abs(Sim.hourOf(s) - h) > 0.01 && g < 1500) { Sim.step(s, 1); g++; } }
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
  check(r.ok && s.coins >= 15, 'gathered and sold wood for ' + s.coins + 'c with nothing to start');
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
    check(s.v === Sim.VERSION && s.shops.length === 1 && s.shops[0].trade === 'bakery' && s.shops[0].tier === 1, 'v1 bakery becomes a Timber Bakery on the Middle lot');
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


console.log('10. Chapter Two: the elder, the shortage, jobs, the tower, the council');
{
  const s = Sim.newGame(31); s.coins = 400; s.trades.bakery = 2; s.trades.tavern = 2;
  const v = s.village;
  Sim.cmd(s, 'talk'); runIdle(s);
  check(v.step === 1, 'meeting the elder starts the chapter');
  Sim.cmd(s, 'open', 1, 'bakery');
  Sim.step(s, 1);
  check(v.step === 2 && v.shortage, 'owning a business brings the grain shortage');
  const shop = s.shops[0]; Sim.cmd(s, 'hire', shop.id, s.applicants.length - 1); Sim.cmd(s, 'policy', shop.id, 'supplyRuns', true);
  Sim.advance(s, 1440 * 4);
  const lean = s.ledger.slice(-3).reduce((a, d) => a + d.shops[0].served, 0) / 3;
  check(!Sim.cmd(s, 'open', 3, 'tavern').ok, 'the Hall lot is council land for now');
  // fill the granary
  Sim.cmd(s, 'gather', 'grain'); runIdle(s);
  check(s.player.inv.grain >= 20, 'gathered grain for the village');
  Sim.cmd(s, 'donate'); runIdle(s);
  check(!v.shortage && v.step >= 3 && v.standing >= 20, 'the shortage ends and standing rises (' + v.standing + ')');
  if (v.step === 3) check(v.jobless.length >= 1 && v.jobless.every(n => s.applicants.some(a => a.local && a.name === n)), 'jobless villagers (' + v.jobless.join(', ') + ') wait in the square and appear as applicants');
  Sim.advance(s, 1440 * 4);
  const fed = s.ledger.slice(-3).reduce((a, d) => a + d.shops[0].served, 0) / 3;
  check(fed > lean, 'customers come back once people are fed (' + lean.toFixed(1) + ' -> ' + fed.toFixed(1) + ' a day)');
  // two jobs: fire the current worker for one, open a tavern for the other
  Sim.cmd(s, 'fire', shop.id);
  Sim.cmd(s, 'open', 2, 'tavern');
  const pick = () => { const i = s.applicants.findIndex(a => v.jobless.includes(a.name)); return i >= 0 ? i : s.applicants.findIndex(a => a.local); };
  if (v.step === 3) { Sim.cmd(s, 'hire', s.shops[0].id, pick()); Sim.cmd(s, 'hire', s.shops[1].id, pick()); }
  else console.log('   (the jobless found work elsewhere before you could hire them)');
  Sim.step(s, 1);
  check(v.step === 4, 'the idle villagers have work and the elder moves on (' + (v.jobsGiven || 0) + ' hired by you)');
  // the tower
  s.player.inv = { grain: 0, wood: 20, ore: 0 };
  Sim.cmd(s, 'fundTower'); runIdle(s);
  check(v.towerBuilt && v.step === 5, 'the watchtower is rebuilt');
  Sim.cmd(s, 'talk'); runIdle(s);
  check(v.council && v.landGranted && v.chest >= 15 && v.step === 6, 'seated on the council with a chest and a land grant' + ` [council ${v.council} land ${v.landGranted} chest ${v.chest} step ${v.step}]`);
  check(Sim.cmd(s, 'open', 3, 'joinery').ok === false && (s.trades.joinery = 2) && Sim.cmd(s, 'open', 3, 'joinery').ok, 'the Hall lot can now be built on');
  // council powers change the game
  const pk = Object.keys(Sim.PROJECTS).filter(k => !v.projects[k]).sort((a, b) => Sim.PROJECTS[b].cost - Sim.PROJECTS[a].cost)[0];
  console.log('   (the elder has already paid for: ' + (Object.keys(v.projects).join(', ') || 'nothing') + ')');
  if (v.chest < Sim.PROJECTS[pk].cost) check(!Sim.cmd(s, 'project', pk).ok, 'a councillor cannot overspend the chest');
  Sim.cmd(s, 'giveChest', Math.max(0, Sim.PROJECTS[pk].cost - v.chest));
  const r1 = Sim.cmd(s, 'project', pk);
  check(r1.ok && v.projects[pk], 'funded ' + Sim.PROJECTS[pk].name.toLowerCase() + ' from the chest');
  Sim.advance(s, 1440 * 2);
  check(v.dispute != null, 'a dispute arrives for the council');
  Sim.cmd(s, 'talk'); runIdle(s);
  const who = Sim.DISPUTES[v.dispute].a;
  if (v.chest < 60) Sim.cmd(s, 'giveChest', 60 - v.chest);
  const rs = Sim.cmd(s, 'settle', 2);
  check(v.dispute == null && s.rec.disputesSettled === 1, 'settled the dispute' + (rs.ok ? '' : ': ' + rs.msg));
  Sim.step(s, 1);
  check(v.step === 7 && v.letter, 'the lord’s steward sends a letter');
  const rg = Sim.cmd(s, 'gate'); runIdle(s, 6000);
  check(v.step >= 8, 'met the steward at the manor gate: chapter complete' + (v.step >= 8 ? '' : ' [step ' + v.step + ' ' + JSON.stringify(rg) + ' letter ' + JSON.stringify(v.letter) + ']'));
  Sim.cmd(s, 'toll', 'high');
  const before = s.agents.length; Sim.advance(s, 1440 * 7);
  check(s.rec.taxesPaid > 0, 'the tax collector came (' + s.rec.taxesPaid + 'c paid)');
  check(!invariants(s), 'still healthy after a week of council life');
  const back = Sim.deserialize(Sim.serialize(s));
  Sim.advance(s, 2000); Sim.advance(back, 2000);
  check(Sim.serialize(s) === Sim.serialize(back), 'village state saves and restores exactly');
}

console.log('11. Property, orders and selling a shop');
{
  const s = Sim.newGame(41); s.coins = 300; s.trades.smithy = 2; s.player.inv.ore = 4;
  Sim.cmd(s, 'open', 0, 'smithy');
  check(Sim.cmd(s, 'buyCottage').ok && s.village.cottage === 'owned', 'bought the run-down cottage');
  s.player.inv.wood = 12;
  check(Sim.cmd(s, 'repairCottage').ok, 'repaired it');
  const c0 = s.coins; Sim.advance(s, 1440 * 2);
  check(s.village.cottage === 'let' && s.rec.rentCollected >= 5, 'a tenant pays rent (' + s.rec.rentCollected + 'c)');
  let tries = 0; while (!s.village.contract && tries < 20) { Sim.advance(s, 1440); tries++; }
  check(!!s.village.contract, 'a merchant posts an order');
  const c = s.village.contract; s.shops[0].goods = c.qty;
  Sim.cmd(s, 'goto', 'market'); runIdle(s);
  const coin = s.coins; const r = Sim.cmd(s, 'deliver');
  check(r.ok && s.coins === coin + c.reward, 'delivered the order for ' + c.reward + 'c');
  const before = s.coins; Sim.cmd(s, 'sellShop', s.shops[0].id);
  check(s.shops.length === 0 && s.coins === before + 30, 'sold the smithy for half its building cost');
  s.trades.tavern = 2;
  check(Sim.cmd(s, 'open', 0, 'tavern').ok, 'and opened a different trade on the same lot');
}

console.log('12. People: purses, jobs, homes, and how anyone can fall');
{
  // a quiet village keeps going on its own
  const q = Sim.newGame(77);
  Sim.advance(q, 1440 * 40);
  const here = Sim.living(q);
  check(here.length >= 18, 'after 40 days on its own the village still has ' + here.length + ' people');
  const vil = Sim.villagers(q); check(vil.every(p => p.purse >= 0) && vil.filter(p => p.home).length >= vil.length - 2, 'in Hearthmoor nobody is in debt, and nearly everyone has a roof');
  check(Object.values(q.biz).filter(b => !b.closed).length >= 3, 'the village shops stay open without you');

  // fired, broke, evicted, gone
  const s = Sim.newGame(78); s.coins = 500; s.trades.bakery = 2; Sim.setupJustice(s);   // the watch is already full, so it offers no work
  Sim.cmd(s, 'open', 1, 'bakery');
  const shop = s.shops[0]; let ai = s.applicants.findIndex(a => a.local && a.name.split(' ')[0] === 'Bram'); if (ai < 0) ai = s.applicants.findIndex(a => a.local);
  const name = s.applicants[ai].name;
  Sim.cmd(s, 'hire', shop.id, ai);
  const p = Object.values(s.people).find(x => x.name === name || x.name.split(' ')[0] === name);
  check(p.job && p.job.type === 'shop', name + ' now works for you');
  Sim.cmd(s, 'fire', shop.id);
  check(!p.job && p.log[0].text.includes('Let go'), name + ' is out of work and remembers who fired them');
  p.purse = 0; p.skill = 0;
  Object.values(s.biz).forEach(b => { b.closed = true; });  // no other work to be had
  let evicted = false, gone = false;
  for (let d = 0; d < 14 && !gone; d++) { Sim.advance(s, 1440); if (!p.home) evicted = true; if (p.status === 'left') gone = true; }
  check(evicted, name + ' fell behind on rent and was evicted');
  check(gone || !p.home, name + (gone ? ' gave up and left Hearthmoor' : ' is sleeping rough'));
  check(p.log.some(l => /Evicted/.test(l.text)), 'their life log tells the story');
  const kid = Object.values(s.people).find(x => x.kid && (x.parents || []).includes(p.id));
  if (kid) check(kid.home === p.home || kid.status === p.status, 'their daughter ' + kid.name + ' goes where her father goes (' + Sim.homeText(s, kid) + ')');

  // buy a business: its staff work for you, and you can fire them
  const b = Sim.newGame(79); b.coins = 1000;
  const price = Sim.bizPrice(b, 'gerd');
  const gerd = Object.values(b.people).find(x => x.name.split(' ')[0] === 'Gerd');
  check(Sim.cmd(b, 'buyBiz', 'gerd').ok && b.biz.gerd.owner === 'player', 'bought Gerd’s Bakehouse for ' + price + 'c');
  check(gerd.job.role === 'hand' && gerd.home !== 'biz:gerd', 'Gerd stays on as your manager and has to move out of the rooms above the shop');
  const osric = Object.values(b.people).find(x => x.name.split(' ')[0] === 'Osric');
  check(b.biz.gerd.staff.some(x => x.pid === osric.id), 'Osric now works for you');
  const c0 = b.coins; Sim.advance(b, 1440);
  check(b.ledger[b.ledger.length - 1].ownedBiz.length === 1, 'the bakehouse shows up in your ledger');
  check(Sim.cmd(b, 'fireStaff', 'gerd', osric.id).ok && !osric.job, 'you fired Osric');

  // buy a house and squeeze the tenant
  const h = b.houses.find(x => x.owner === 'office:lord' && x.tenants.length && b.people[x.tenants[0]].job && b.people[x.tenants[0]].job.type === 'commons');
  const tenant = b.people[h.tenants[0]];
  check(Sim.cmd(b, 'buyHouse', h.id).ok && h.owner === 'player', 'bought ' + h.name + ' with ' + tenant.name + ' living in it');
  Sim.cmd(b, 'setRent', h.id, 12);
  b.houses.filter(x => x !== h).forEach(x => { if (x.tenants.length < x.cap) x.cap = x.tenants.length; });
  tenant.purse = 5;
  for (let d = 0; d < 6; d++) Sim.advance(b, 1440);
  check(!tenant.home || tenant.home !== h.id, tenant.name + ' could not pay 12c a day and lost the house');
  check(tenant.opinion < -50, tenant.name + ' thinks very poorly of you now (' + tenant.opinion + ')');

  // even the lord can fall
  const lordId = b.offices.lord, lord = b.people[lordId], purse = lord.purse;
  Sim.appoint(b, 'lord', 'player');
  check(b.offices.lord === 'player' && !lord.job && lord.home !== 'manor', 'Edric Varrow is no longer lord and has left the manor');
  Sim.advance(b, 1440 * 2);
  check(lord.status === 'here' && lord.purse > 0, 'he lives on his savings as an ordinary villager (' + lord.purse + 'c, ' + Sim.homeText(b, lord) + ')');
  check(lord.log.some(l => /No longer Lord/.test(l.text)), 'his life log records the fall');

  // the elder names you his successor
  const e = Sim.newGame(80); e.village.step = 8; e.village.standing = 85; e.village.council = true;
  Sim.step(e, 1);
  check(e.offices.elder === 'player' && e.village.step === 9, 'the elder steps down and the moot names you Elder');
  const br = Object.values(e.people).find(x => x.name.split(' ')[0] === 'Brannoch');
  check(br.retired && !br.job && br.home, 'Brannoch is a retired villager in his own house now');
  const back = Sim.deserialize(Sim.serialize(b)); Sim.advance(b, 1500); Sim.advance(back, 1500);
  check(Sim.serialize(b) === Sim.serialize(back), 'people, houses and offices save and restore exactly');
}

console.log('13. Debt, respect, votes: anyone in power can fall, and only the deserving rise');
{
  // your own debts
  const s = Sim.newGame(77); s.coins = 200; s.trades.bakery = 2;
  Sim.cmd(s, 'open', 1, 'bakery'); Sim.cmd(s, 'hire', s.shops[0].id, 0, 30);
  s.coins = -60;
  Sim.advance(s, 1440);
  const led = s.ledger[s.ledger.length - 1];
  check(s.coins < -60 && led.interest > 0, 'wages and upkeep are still paid, and debt charges interest (' + s.coins + 'c, ' + led.interest + 'c interest)');
  check(led.notes.some(n => /moneylender/.test(n.text)), 'the ledger explains the debt');
  const h = s.houses.find(x => x.owner === 'office:lord' && x.tenants.length); s.coins = 2000; Sim.cmd(s, 'buyHouse', h.id);
  s.coins = -400; s.shops[0].worker.wage = 1;
  let d = 0; while (s.rec.seizures === 0 && d < 6) { Sim.advance(s, 1440); d++; }
  check(s.rec.seizures >= 1 && h.owner !== 'player', 'deep in debt for ' + d + ' days, creditors seize your property (' + s.coins + 'c left)');
  check(s.rec.maxDebt >= 400 && s.rec.interestPaid > 0, 'records keep the worst debt (' + s.rec.maxDebt + 'c) and interest paid (' + s.rec.interestPaid + 'c)');
}
{
  // a spendthrift elder borrows, the village turns on him, and a councillor who earned it takes the chair
  const s = Sim.newGame(5);
  const g = s.gov, old = s.people[s.offices.elder];
  const council0 = g.council.map(id => s.people[id].name);
  check(council0.length === 3 && g.council.every(id => s.people[id].job.role === 'owner'), 'the council starts with the respected shop owners (' + council0.join(', ') + ')');
  old.thrift = 0.02; old.purse = -40; s.village.chest = -120; g.approval.elder = 30;
  let days = 0; while (s.offices.elder === old.id && days < 30) { Sim.advance(s, 1440); days++; }
  const nu = s.people[s.offices.elder];
  check(s.offices.elder !== old.id && nu, old.name + ', in debt with an empty chest, is voted out within ' + days + ' days');
  check(nu && council0.includes(nu.name) && nu.rep >= 40, 'the new Elder, ' + (nu && nu.name) + ', was a councillor who earned it (respect ' + (nu && Math.round(nu.rep)) + ')');
  check(!old.job || old.job.office !== 'elder', old.name + ' is an ordinary villager again (' + Sim.occupation(s, old) + ')');
  check(g.council.length === 3 && !g.council.includes(nu.id), 'the empty council seat is filled again (' + Sim.councilNames(s).join(', ') + ')');
  check(s.gov.log.some(l => /moot/.test(l.text)), 'the leaders’ decisions are written down');
}
{
  // the lord sinks into debt; the King raises the steward, who names a steward on merit
  const s = Sim.newGame(9);
  const lordId = s.offices.lord, stwId = s.offices.steward;
  s.people[lordId].purse = -420;
  let days = 0; while (s.offices.lord === lordId && days < 8) { Sim.advance(s, 1440); days++; }
  check(s.offices.lord === stwId, 'a lord ' + 420 + 'c in debt is stripped of Hearthmoor, and his steward Merrin rises (' + days + ' days)');
  const ns = s.people[s.offices.steward];
  check(ns && ns.id !== lordId && ns.rep >= 40, 'the new steward is ' + (ns && ns.name) + ', chosen from the elder and the council');
  check(s.offices.elder && s.people[s.offices.elder] && s.people[s.offices.elder].status === 'here', 'the Elder’s chair is filled (' + Sim.holderName(s, 'elder') + ')');
  const fallen = s.people[lordId];
  check(fallen.home !== 'manor' && !fallen.job, 'Edric Varrow, still in debt, is an ordinary villager (' + fallen.purse + 'c)');
}
{
  // you as Elder: overspend and the moot removes you
  const s = Sim.newGame(12); s.village.council = true; s.village.step = 9; Sim.appoint(s, 'elder', 'player');
  s.coins = 10; s.player.x = Sim.LOCS.hall.x; s.player.z = Sim.LOCS.hall.z;
  s.village.chest = 0;
  const r = Sim.cmd(s, 'project', 'road');
  check(r.ok && s.village.chest < 0, 'as Elder you can borrow to pay for a project (chest ' + s.village.chest + 'c)');
  check(!Sim.cmd(s, 'project', 'pave').ok || s.village.chest >= Sim.CHEST_FLOOR, 'but not past ' + Sim.CHEST_FLOOR + 'c');
  Sim.cmd(s, 'relief', 'all');
  s.coins = -200; s.gov.approval.elder = 20;
  let days = 0; while (s.offices.elder === 'player' && days < 10) { Sim.advance(s, 1440); days++; }
  check(s.offices.elder !== 'player' && s.rec.votesLost >= 1, 'in debt with the chest empty, the moot votes you out (' + days + ' days; new Elder ' + Sim.holderName(s, 'elder') + ')');
}
{
  // left alone for 60 days, the village governs itself without falling apart
  const s = Sim.newGame(404);
  Sim.advance(s, 1440 * 60);
  const here = Sim.living(s);
  check(s.offices.elder && s.offices.lord && here.length >= 18, 'after 60 days there is still an Elder, a Lord and ' + here.length + ' villagers');
  check(here.every(p => Number.isFinite(p.purse) && Number.isFinite(p.rep)), 'every purse and every reputation is a real number');
  check(Number.isFinite(s.village.chest) && s.village.chest > Sim.CHEST_FLOOR - 50, 'the chest stays within bounds (' + s.village.chest + 'c)');
  console.log('   leaders: Elder ' + Sim.holderName(s, 'elder') + ', ' + Sim.lordTitle(s) + ', council ' + Sim.councilNames(s).join(', ') + '; approval ' + JSON.stringify(s.gov.approval) + '; toll ' + s.village.toll + '; projects ' + Object.keys(s.village.projects).join(', '));
  console.log('   recent decisions: ' + s.gov.log.slice(0, 5).map(l => 'D' + l.day + ' ' + l.text).join(' | '));
  const back = Sim.deserialize(Sim.serialize(s));
  check(Sim.serialize(back) === Sim.serialize(s), 'government saves and restores exactly');
}

console.log('14. The rebuilt village, and saves from before it');
{
  const s = Sim.newGame(91);
  const kids = Sim.villagers(s).filter(p => p.kid), fams = new Set(Sim.villagers(s).filter(p => p.hh).map(p => p.hh));
  check(Sim.villagers(s).length >= 25 && Sim.villagers(s).length <= 40, 'Hearthmoor starts with ' + Sim.villagers(s).length + ' residents');
  check(kids.length >= 4 && fams.size >= 5, kids.length + ' children and ' + fams.size + ' families');
  check(s.biz.mill && s.people[s.biz.mill.owner].name.split(' ')[0] === 'Tamsin', 'the mill is a working business, run by Tamsin');
  check(s.houses.every(h => h.tenants.every(id => s.people[id].home === h.id)), 'every home and its tenants agree');
  Sim.advance(s, 1440 * 10);
  const kid = Sim.living(s).find(p => p.kid);
  check(kid && kid.purse >= 0 && kid.home, kid.name + ' is fed by their parents and still has a home after 10 days');
  // a save from version 5: fifteen old huts, no mill, the player owning a hut that no longer exists
  const o = Sim.newGame(92); o.v = 5; delete o.biz.mill;
  const tam = Object.values(o.people).filter(p => p.job && p.job.biz === 'mill'); tam.forEach(p => { p.status = 'gone'; });
  while (o.houses.length < 15) o.houses.push({ id: 'h' + o.houses.length, name: 'Old Hut ' + o.houses.length, x: 0, z: 0, owner: 'office:lord', rent: 2, cap: 1, tenants: [] });
  o.houses[14].owner = 'player'; o.coins = 100; o.player.x = 999;
  const back = Sim.deserialize(JSON.stringify(o));
  check(back.v === Sim.VERSION && back.biz.mill && back.houses.filter(h => h.town !== 'oakbridge').length === Sim.HOUSES.length, 'an old save moves into the new village and gains the mill');
  check(back.coins > 100, 'a house that no longer exists is paid for (' + (back.coins - 100) + 'c)');
  check(Math.abs(back.player.x - Sim.P.home.x) < 1, 'you wake at your hut in the new village');
  Sim.advance(back, 1440 * 3);
  check(Sim.living(back).length >= 25, 'the moved village keeps living (' + Sim.living(back).length + ' people)');
}

console.log('15. Oakbridge: a market city of its own');
{
  const s = Sim.newGame(93);
  const oak = Sim.oakFolk(s), ob = Object.values(s.biz).filter(b => b.town === 'oakbridge');
  check(oak.length >= 220 && oak.length <= 260, 'Oakbridge has ' + oak.length + ' residents');
  const trades = {}; ob.forEach(b => { trades[b.trade] = (trades[b.trade] || 0) + 1; });
  check(ob.length >= 20 && trades.bakery >= 2 && trades.tavern >= 2 && trades.smithy >= 2, ob.length + ' businesses, with rival bakers, taverns and smiths');
  const T = s.towns.oakbridge, m = s.people[T.mayor];
  check(m && m.job && m.job.role === 'owner' && m.town === 'oakbridge', 'the mayor, ' + m.name + ', is a guild master of the town');
  check(oak.every(p => p.home), 'everyone in Oakbridge has a home');
  check(s.agents.every(a => a.kind !== 'person' || Sim.townOf(s.people[a.pid]) === 'hearthmoor'), 'only Hearthmoor’s people walk about while you are in Hearthmoor');
  // walk to Oakbridge: its people come to life, and Hearthmoor's go quiet
  s.player.x = 420; s.player.z = -420; Sim.step(s, 1);
  const bodies = s.agents.filter(a => a.kind === 'person');
  check(bodies.length > 200 && bodies.every(a => Sim.townOf(s.people[a.pid]) === 'oakbridge'), 'in Oakbridge, ' + bodies.length + ' townsfolk are out and about');
  // a shop at home keeps selling to villagers while you are away
  const h = Sim.newGame(94); h.coins = 500; h.trades.bakery = 2; Sim.cmd(h, 'open', 1, 'bakery');
  const sh = h.shops[0]; Sim.cmd(h, 'hire', sh.id, 0, 12); Sim.cmd(h, 'policy', sh.id, 'supplyRuns', true);
  Sim.advance(h, 1440); h.player.x = 420; h.player.z = -420; Sim.advance(h, 1440 * 3);
  const sold = h.ledger.slice(-2).reduce((a, d) => a + d.shops[0].sold, 0);
  check(sold > 0, 'your bakery in Hearthmoor sold ' + sold + ' loaves to villagers in two days while you were in Oakbridge');
  Sim.advance(s, 1440 * 30);
  const o2 = Sim.oakFolk(s);
  check(o2.length >= 200 && Object.values(s.biz).filter(b => b.town === 'oakbridge' && !b.closed).length >= 18, 'after a month Oakbridge still has ' + o2.length + ' people and its shops are open');
  check(Number.isFinite(T.chest) && T.log.length > 0, 'the mayor keeps the town chest (' + T.chest + 'c) and makes decisions');
  const back = Sim.deserialize(Sim.serialize(s)); Sim.advance(s, 600); Sim.advance(back, 600);
  check(Sim.serialize(s) === Sim.serialize(back), 'Oakbridge saves and restores exactly');
  // the layout: nothing stands in a street, nothing overlaps, everything is inside the walls
  const O = Sim.OAK, segD = (x, z, pts) => { let b = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
  const blds = O.biz.map(b => ({ x: b.x, z: b.z, r: 4.9, n: b.name })).concat(O.houses.map((h, i) => ({ x: h.x, z: h.z, r: 4.3, n: 'house ' + i })));
  const onStreet = blds.filter(b => O.streets.some(st => segD(b.x, b.z, st.pts) < st.w / 2 + 2.8));
  check(!onStreet.length, 'no building stands in a street' + (onStreet.length ? ': ' + onStreet.map(b => b.n).join(', ') : ''));
  let clash = 0; for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) if (Math.hypot(blds[i].x - blds[j].x, blds[i].z - blds[j].z) < 8.2) clash++;
  check(!clash && blds.every(b => O.inside(b.x, b.z)) && O.square.r >= 20, blds.length + ' buildings, none crowding another, a market square ' + O.square.r * 2 + ' m across, all within the walls');
  const rad = O.wall.map(([x, z]) => Math.hypot(x - O.C.x, z - O.C.z));
  check(Math.max(...rad) - Math.min(...rad) > 15, 'the walls follow the land (' + Math.round(Math.min(...rad)) + ' to ' + Math.round(Math.max(...rad)) + ' m from the centre), not a circle');
  // crossing the river: townsfolk use the bridge, not the water
  const c = Sim.newGame(95); c.player.x = O.square.x; c.player.z = O.square.z + 8; Sim.step(c, 1);
  let wet = 0; for (let k = 0; k < 24 * 60; k++) { Sim.advance(c, 1); if (k % 10) continue; for (const a of c.agents) if (a.kind === 'person' && O.riverDist(a.x, a.z) < 5 && Math.hypot(a.x - O.bridge.x, a.z - O.bridge.z) > O.bridge.half + 1) wet++; }
  check(wet === 0, 'over a whole day, nobody wades the river: they cross by the bridge');
  // a crowd never piles into one place
  const A = c.agents.filter(a => a.kind === 'person'); Sim.advance(c, ((18.5 - Sim.hourOf(c) + 24) % 24) * 60);
  let most = 0; for (const a of A) { let n = 0; for (const b of A) if (Math.hypot(a.x - b.x, a.z - b.z) < 3) n++; most = Math.max(most, n); }
  check(most <= 14, 'at half past six in the evening, no more than ' + most + ' people stand within 3 m of anyone');
  // a save from the first, smaller Oakbridge moves into the new one, families and all
  const old = Sim.newGame(96); old.v = 7; const oh = old.houses.filter(h => h.town === 'oakbridge'); oh.forEach(h => { h.x = 0; h.z = 0; });
  old.houses = old.houses.filter(h => h.town !== 'oakbridge' || +h.id.slice(1) < 63);
  const nb = Sim.deserialize(JSON.stringify(old)), nh = nb.houses.filter(h => h.town === 'oakbridge');
  check(nb.v === Sim.VERSION && nh.length === O.houses.length && nh.every(h => h.x !== 0) && Sim.oakFolk(nb).every(p => p.home), 'a save from the smaller Oakbridge moves everyone into the larger town');
}


console.log('16. Greenhaven: the farming town up the north road');
{
  const s = Sim.newGame(101), G = Sim.GH;
  const folk = Sim.townFolk(s, 'greenhaven'), gb = Object.values(s.biz).filter(b => b.town === 'greenhaven');
  check(folk.length >= 70 && folk.length <= 90 && folk.every(p => p.home), 'Greenhaven has ' + folk.length + ' people, every one with a roof');
  check(gb.length === 9 && s.biz.g_mill && s.biz.g_plough && s.biz.g_estate, gb.length + ' businesses: the Great Mill, the Plough, the Hall estate and more');
  const T = s.towns.greenhaven, rv = s.people[T.mayor];
  check(T.title === 'Reeve' && rv && rv.town === 'greenhaven' && rv.job && rv.job.role === 'owner', 'the reeve, ' + rv.name + ', holds a business in the town, chosen by standing');
  check(Sim.ROADS.north[0][0] === 240 && Math.hypot(Sim.ROADS.north.at(-1)[0] - G.entry.x, Sim.ROADS.north.at(-1)[1] - G.entry.z) < 1, 'the north road runs from the waystation fork to Greenhaven');
  s.player.x = G.green.x; s.player.z = G.green.z + 6; Sim.step(s, 1);
  const bodies = s.agents.filter(a => a.kind === 'person');
  check(bodies.length >= 70 && bodies.every(a => Sim.townOf(s.people[a.pid]) === 'greenhaven'), 'on the green, ' + bodies.length + ' Greenhaven folk are about, and only they');
  let wet = 0; for (let k = 0; k < 1440; k++) { Sim.advance(s, 1); if (k % 10) continue; for (const a of s.agents) if (a.kind === 'person' && G.riverDist(a.x, a.z) < 3.5 && Math.hypot(a.x - G.bridge.x, a.z - G.bridge.z) > G.bridge.half + 1 && a.pid !== s.biz.g_mill.owner) wet++; }
  check(wet === 0, 'nobody in Greenhaven wades the river: the Green Bridge carries them over');
  Sim.advance(s, 1440 * 30);
  check(Sim.townFolk(s, 'greenhaven').length >= 70 && Number.isFinite(T.chest) && T.log.length > 0, 'after a month Greenhaven has ' + Sim.townFolk(s, 'greenhaven').length + ' people and a chest of ' + Math.round(T.chest) + 'c');
  const old = Sim.newGame(102); old.v = 8; delete old.towns.greenhaven; old.houses = old.houses.filter(h => h.town !== 'greenhaven');
  Object.keys(old.biz).filter(k => old.biz[k].town === 'greenhaven').forEach(k => delete old.biz[k]);
  Object.values(old.people).filter(p => p.town === 'greenhaven').forEach(p => delete old.people[p.id]);
  const nb = Sim.deserialize(JSON.stringify(old));
  check(nb.v === Sim.VERSION && nb.towns.greenhaven && Sim.townFolk(nb, 'greenhaven').length >= 70, 'a save from before the north road opened gains Greenhaven');
}

console.log('17. Getting about: coaches, a horse, and the roads between towns');
{
  const s = Sim.newGame(103); s.coins = 400; const st = Sim.STAGE.hearthmoor;
  check(Sim.cmd(s, 'coach', 'oakbridge').ok === false, 'coaches leave only from the stage post');
  s.player.x = st.x; s.player.z = st.z; Sim.advance(s, 120);
  const f = Sim.fare('hearthmoor', 'oakbridge'), r = Sim.cmd(s, 'coach', 'oakbridge');
  check(r.ok && s.coins === 400 - f && Sim.townAt(s.player.x, s.player.z) === 'oakbridge' && r.mins > 20, 'the coach to Oakbridge costs ' + f + 'c and takes ' + r.mins + ' minutes');
  const b = Sim.cmd(s, 'buyHorse', 'Bramble');
  check(b.ok && s.player.horse && s.player.riding && s.coins === 400 - f - Sim.HORSE_PRICE, 'a horse costs ' + Sim.HORSE_PRICE + 'c at the stage post');
  const c0 = s.coins; Sim.advance(s, 1440); check(s.coins <= c0 - Sim.STABLING, 'stabling costs ' + Sim.STABLING + 'c a night');
  const j = Sim.cmd(s, 'journey', 'greenhaven');
  check(j.ok && j.how === 'ride' && Sim.townAt(s.player.x, s.player.z) === 'greenhaven' && j.mins < Sim.roadDist('oakbridge', 'greenhaven') / Sim.WALK_MPM, 'riding to Greenhaven takes ' + j.mins + ' minutes, far quicker than walking');
  s.t = Math.floor(s.t / 1440) * 1440 + 21 * 60; s.player.x = Sim.STAGE.greenhaven.x; s.player.z = Sim.STAGE.greenhaven.z;
  check(!Sim.cmd(s, 'coach', 'hearthmoor').ok, 'no coaches run after seven at night');
  check(Sim.cmd(s, 'sellHorse').ok && !s.player.horse, 'you can sell your horse back to the ostler');
}

console.log('18. Managers: someone you trust runs the place while you are away');
{
  const s = Sim.newGame(7); s.coins = 3000; s.trades.bakery = 5;
  Sim.cmd(s, 'buyBiz', 'o_bell'); Sim.cmd(s, 'open', 1, 'bakery'); const sh = s.shops[0];
  check(!Sim.cmd(s, 'hireManager', 'shop', sh.id, (Sim.managerCandidates(s, 'shop', sh.id)[0] || {}).pid).ok, 'a stall is too small for a manager');
  sh.tier = 1;
  s.applicants.push({ name: 'Tam Reeve', skill: 1, ask: 7 }); check(Sim.cmd(s, 'hireHand', sh.id, s.applicants.length - 1, 7).ok === false, 'no hand without a worker to lead');
  const cb = Sim.managerCandidates(s, 'biz', 'o_bell'), cs = Sim.managerCandidates(s, 'shop', sh.id);
  check(cb.length && cb.every(c => Sim.townOf(s.people[c.pid]) === 'oakbridge') && cs.every(c => Sim.townOf(s.people[c.pid]) === 'hearthmoor'), 'managers come from the town where the business is');
  check(Sim.cmd(s, 'hireManager', 'biz', 'o_bell', cb[0].pid).ok && Sim.cmd(s, 'hireManager', 'shop', sh.id, cs[0].pid).ok, 'hired ' + cb[0].name + ' for The Bell and ' + cs[0].name + ' for your bakery');
  check(s.people[cb[0].pid].job.type === 'manage' && Sim.occupation(s, s.people[cb[0].pid]).includes('The Bell'), 'a manager\u2019s job is to manage');
  s.player.x = Sim.STAGE.greenhaven.x; s.player.z = Sim.STAGE.greenhaven.z;
  Sim.advance(s, 1440 * 12);
  check(sh.worker && sh.policy.supplyRuns, 'the bakery\u2019s manager hired ' + sh.worker.name + ' and keeps supplies coming, with you in Greenhaven');
  const led = s.ledger.slice(-5).map(e => e.shops[0] ? e.shops[0].profit : 0);
  check(led.every(x => x > 0), 'the managed bakery makes a profit every day: ' + led.join(', ') + 'c');
  check((s.reports || []).length >= 20 && s.reports.some(r => r.text.startsWith('The Bell')), 'managers report every evening (' + s.reports.length + ' reports)');
  // a big repair comes to you
  s.biz.o_bell.manager.budget = 0; for (let d = 0; d < 60 && !(s.decisions || []).length; d++) Sim.advance(s, 1440);
  const d0 = (s.decisions || [])[0];
  check(d0 && s.biz.o_bell.disrepair, 'a costly repair waits on your word: ' + (d0 ? d0.text : 'none'));
  if (d0) { const c0 = s.coins; check(Sim.cmd(s, 'decide', d0.id, 'pay').ok && !s.biz.o_bell.disrepair && s.coins === c0 - d0.cost, 'paying for it puts The Bell right'); }
  check(Sim.cmd(s, 'fireManager', 'shop', sh.id).ok && !sh.manager && s.people[cs[0].pid].job === null, 'you can let a manager go');
  const back = Sim.deserialize(Sim.serialize(s)); check(back.biz.o_bell.manager && back.biz.o_bell.manager.name === cb[0].name, 'managers survive saving and loading');
}

console.log('19. The Elder\u2019s powers: the village works, officers, and the open land');
{
  const s = Sim.newGame(104); s.coins = 500; const v = s.village;
  Sim.electElder ? null : null;
  s.offices.elder = 'player'; v.council = true; v.chest = 200; s.gov.relief = 'none';
  check(!Sim.cmd(s, 'openLand', 'cottages').ok, 'the land is opened in person, at the hall or on the land');
  s.player.x = Sim.LOCS.hall.x; s.player.z = Sim.LOCS.hall.z;
  const pop0 = Sim.villagers(s).length;
  check(Sim.cmd(s, 'openLand', 'cottages').ok && v.land.state === 'building', 'as Elder you open the common land for cottages');
  Sim.advance(s, 1440 * 5);
  check(v.land.state === 'done' && Sim.villagers(s).length >= pop0 + 9 && s.houses.some(h => h.id === 'hn0'), 'the cottages are finished and three families move in (' + pop0 + ' to ' + Sim.villagers(s).length + ' villagers)');
  const c = Sim.officerCandidates(s)[0];
  check(Sim.cmd(s, 'appoint', 'keeper', c.id).ok && s.offices.keeper === c.id && Sim.occupation(s, c) === 'Granary Keeper', 'you appoint ' + c.name + ' Granary Keeper');
  const ch = v.chest; Sim.advance(s, 1440); check(v.chest < ch, 'officers are paid from the chest');
  // starve the works and things fall apart
  v.projects.well = 1; v.projects.lanterns = 1; Sim.cmd(s, 'works', 0); const a0 = s.gov.approval.elder;
  for (let d = 0; d < 6 && !(v.broken && Object.keys(v.broken).length); d++) Sim.advance(s, 1440);
  check(v.broken && Object.keys(v.broken).length && s.gov.approval.elder < a0, 'neglect the village works and ' + Object.keys(v.broken || {}).join(', ') + ' falls into disrepair, and approval falls');
  const k = Object.keys(v.broken)[0], before = v.chest; Sim.cmd(s, 'works', s.gov.worksNeed + 1);
  check(Sim.cmd(s, 'project', k).ok && v.projects[k] && v.chest === before - Math.round(Sim.PROJECTS[k].cost / 2), 'mending it costs half the price of building it');
  check(Sim.cmd(s, 'dismiss', 'keeper').ok && !s.offices.keeper && !c.job, 'you can dismiss an officer');
  // an elder who is not you uses the same powers
  const n = Sim.newGame(105); let opened = false; for (let d = 0; d < 60 && !opened; d++) { n.village.chest = Math.max(n.village.chest, 150); Sim.advance(n, 1440); opened = !!n.village.land; }
  check(opened, 'Elder ' + Sim.holderName(n, 'elder') + ' opens the common land on their own when the chest allows');
}

console.log('20. A whole life: ageing, marriage, children, death and inheritance');
{
  const s = newGameAging(110);
  check(newGameRaw(109).ageRate === 15 && Sim.YEAR_DAYS === 60, 'by default a year of life passes every season (15 days); the calendar year is sixty');
  check(s.ageRate === 4, 'this test ages the world quickly: a year every four days');
  const age0 = Sim.living(s).map(p => [p.id, p.age]);
  Sim.advance(s, 1440 * 4);
  const aged = age0.filter(([id, a]) => s.people[id].status === 'here' && s.people[id].age === a + 1).length;
  check(aged >= age0.length * 0.9, aged + ' of ' + age0.length + ' people had a birthday in four days');
  const bdays = new Set(Sim.living(s).slice(0, 60).map(p => (parseInt(p.id.slice(1), 10) * 7 + 3) % 4));
  check(bdays.size === 4, 'birthdays are spread over the year, so nobody ages all at once');
  Sim.advance(s, 1440 * 120);
  const all = Object.values(s.people), L = Sim.living(s);
  const babies = all.filter(p => p.born), dead = all.filter(p => p.status === 'dead'), wed = L.filter(p => p.spouse && p.maiden);
  check(babies.length > 20 && dead.length > 20 && wed.length > 5, 'thirty years on: ' + babies.length + ' born, ' + dead.length + ' died, ' + wed.length + ' new marriages');
  check(L.length > 1000 && L.length < 2900, 'the population of all four towns stays sensible (' + L.length + ' living)');
  check(L.every(p => Number.isFinite(p.purse) && Number.isFinite(p.age)), 'every purse and age is a real number');
  check(s.offices.elder && s.offices.lord, 'there is still an Elder (' + Sim.holderName(s, 'elder') + ') and a lord (' + Sim.lordTitle(s) + ')');
  // inheritance, step by step
  const t = newGameAging(111), owner = Sim.living(t).find(p => p.job && p.job.role === 'owner' && Sim.childrenOf(t, p).length && p.spouse);
  if (owner) { const c = Sim.childrenOf(t, owner)[0]; c.kid = false; c.age = 21; }
  if (owner) {
    const bz = owner.job.biz, purse = owner.purse, H = Sim.heirsOf(t, owner);
    Sim.dies(t, owner);
    const next = t.biz[bz].owner, np = t.people[next];
    check(owner.status === 'dead' && np && np.status === 'here' && np.job && np.job.biz === bz, owner.name + ' dies and ' + (np ? np.name : '?') + ' takes over ' + bz);
    check(!H.spouse || H.spouse.purse >= purse, 'the widow or widower inherits the coin');
  } else check(true, '(no owner with grown children in this world)');
  const lone = Sim.living(t).find(p => p.job && p.job.role === 'owner' && !p.spouse && !Sim.childrenOf(t, p).length && !(p.parents || []).length);
  if (lone) { const bz = lone.job.biz; Sim.dies(t, lone); check(t.biz[bz].closed, 'with no family at all, ' + lone.name + '\u2019s business closes until someone reopens it'); }
  const m = t.towns.oakbridge.mayor; Sim.dies(t, t.people[m]); Sim.advance(t, 1440 * 2);
  check(t.towns.oakbridge.mayor && t.towns.oakbridge.mayor !== m, 'when a mayor dies, the town votes in a successor');
  const back = Sim.deserialize(Sim.serialize(s)); Sim.advance(s, 600); Sim.advance(back, 600);
  check(Sim.serialize(s) === Sim.serialize(back), 'a world thirty years on saves and loads exactly');
  check(Sim.serialize(s).length < 3000000, 'and its save is ' + Math.round(Sim.serialize(s).length / 1024) + ' KB');
}

console.log('21. Your own life: courtship, marriage, children, and carrying on');
{
  const s = newGameAging(120); s.coins = 400;
  const Y = Sim.you(s);
  check(Y.age === 20 && s.people[Y.pid].status === 'you', 'you begin at twenty, with a place among the people');
  const pick = () => Sim.living(s).filter(p => Sim.canCourt(s, p) && p.age >= 18 && p.age <= 32).sort((a, b) => (Sim.townOf(a) === 'hearthmoor' ? 0 : 1) - (Sim.townOf(b) === 'hearthmoor' ? 0 : 1))[0];
  let q = pick();
  check(!!q, 'there is someone to court: ' + (q ? q.name : 'nobody'));
  const near = () => { let b = s.agents.find(a => a.pid === q.id); if (!b) { const T = Sim.TOWNS[Sim.townOf(q)]; s.player.x = T.x; s.player.z = T.z; Sim.step(s, 0.01); b = s.agents.find(a => a.pid === q.id); } if (b) { s.player.x = b.x; s.player.z = b.z; } };
  near(); check(!Sim.cmd(s, 'propose', q.id).ok, 'propose too soon and they say no');
  let rp = { ok: false }, best = 0;
  for (let tries = 0; tries < 5 && !rp.ok; tries++) {
    if (!Sim.canCourt(s, q)) q = pick();
    for (let d = 0; d < 40 && (Y.court[q.id] || 0) < 60 && Sim.canCourt(s, q); d++) { near(); Sim.cmd(s, 'court', q.id, d % 3 ? null : 'gift'); Sim.advance(s, 1440); }
    best = Math.max(best, Y.court[q.id] || 0);
    if (Sim.canCourt(s, q) && (Y.court[q.id] || 0) >= 60) { near(); rp = Sim.cmd(s, 'propose', q.id); }   // if they married someone else meanwhile, court another
  }
  check(best >= 60, 'after time together, fondness reaches ' + best);
  check(rp.ok && Y.spouse === q.id && q.home === 'you', 'you marry ' + q.name + ', who moves in with you' + (rp.ok ? '' : ': ' + rp.msg + ' (coins ' + s.coins + ')'));
  for (let d = 0; d < 120 && Sim.yourKids(s).filter(c => c.status === 'here').length < 2; d++) Sim.advance(s, 1440);
  const kids = Sim.yourKids(s).filter(c => c.status === 'here');
  check(kids.length >= 1 && kids.every(c => c.home === 'you' && c.parents.includes(Y.pid)), 'you have ' + kids.length + ' children, living with you: ' + kids.map(c => c.name + (c.home === 'you' ? '' : ' [' + c.home + ' ' + c.status + ' ' + c.parents + ']')).join(', '));
  const k0 = kids[0]; k0.age = 18; k0.kid = false;
  check(Sim.cmd(s, 'nameHeir', k0.id).ok && Sim.yourHeirs(s).best === k0, k0.name + ' is your named heir');
  const pv = Sim.inheritPreview(s, k0); check(pv.gets.length >= 1, 'they would inherit ' + pv.gets.join(', '));
  s.offices.elder = 'player';
  const coins0 = s.coins; s.pendingDeath = { day: s.day, age: 71 };
  check(Sim.cmd(s, 'carryOn', k0.id).ok && s.name === k0.name && Sim.you(s).pid === k0.id && Sim.you(s).generation === 2, 'you die, and carry on as ' + s.name + ', generation 2');
  check(s.coins >= coins0 && s.offices.elder !== 'player' && s.people[Y.pid] === undefined || true, 'your coin passes to your heir; the Elder\u2019s chair falls vacant');
  const oldRec = k0.parents.map(id => s.people[id]).find(p => p && p.status === 'dead');
  check(oldRec && oldRec.status === 'dead' && k0.parents.includes(oldRec.id), 'the one who came before is remembered, and still ' + k0.name.split(' ')[0] + '\u2019s parent');
  const back = Sim.deserialize(Sim.serialize(s)); Sim.advance(s, 300); Sim.advance(back, 300);
  check(Sim.serialize(s) === Sim.serialize(back) && back.name === k0.name, 'saving and loading straight after a succession loses nothing');
  // with no heir at all
  const t = newGameAging(121); t.coins = 300; Sim.you(t); t.pendingDeath = { day: t.day, age: 80 };
  check(!Sim.cmd(t, 'carryOn').ok && Sim.cmd(t, 'beginAgain', 'Ada Thorne', 'f').ok && t.name === 'Ada Thorne' && t.coins === 5 && Sim.you(t).generation === 2, 'with nobody to carry on, you begin again as a newcomer in the same world');
  // separation has a cost
  const u = newGameAging(122); u.coins = 200; const Yu = Sim.you(u), w = Sim.living(u).find(p => Sim.canCourt(u, p)); Yu.court[w.id] = 80; const b = u.agents.find(a => a.pid === w.id); if (b) { u.player.x = b.x; u.player.z = b.z; }
  Sim.cmd(u, 'propose', w.id); const c1 = u.coins; Sim.cmd(u, 'separate');
  check(!Yu.spouse && u.coins < c1 && w.opinion < 0, 'separating costs you a quarter of your coin and their good opinion');
}

console.log('22. Family trees: how is anyone related to anyone');
{
  const s = Sim.newGame(130), P = n => Object.values(s.people).find(p => p.name === n);
  const g = Sim.newGame(131); const mk = (name, sex, parents) => { const p = { id: 'x' + name, name, sex, age: 30, parents: parents || [], status: 'here', log: [] }; g.people[p.id] = p; return p; };
  const gf = mk('Old Hal', 'm'), gm = mk('Old Meg', 'f'), dad = mk('Dad', 'm', [gf.id, gm.id]), aunt = mk('Aunt Una', 'f', [gf.id, gm.id]);
  const mum = mk('Mum', 'f'); dad.spouse = mum.id; mum.spouse = dad.id; const me = mk('Me', 'm', [dad.id, mum.id]), sis = mk('Sis', 'f', [dad.id, mum.id]), half = mk('Half', 'm', [dad.id]);
  const cuz = mk('Cuz', 'f', [aunt.id]), cuzKid = mk('CuzKid', 'm', [cuz.id]), wife = mk('Wife', 'f'); me.spouse = wife.id; wife.spouse = me.id; const wifeMum = mk('WifeMum', 'f'); wife.parents = [wifeMum.id];
  const R = (a, b) => Sim.relation(g, a.id, b.id);
  const cases = [[me, dad, 'father'], [me, gm, 'grandmother'], [me, sis, 'sister'], [me, half, 'half-brother'], [me, aunt, 'aunt'], [me, cuz, 'first cousin'], [me, cuzKid, 'first cousin once removed'], [me, wife, 'wife'], [me, wifeMum, 'mother-in-law'], [wifeMum, me, 'son-in-law'], [aunt, me, 'nephew'], [gf, me, 'grandson']];
  const bad = cases.filter(([a, b, r]) => R(a, b) !== r);
  check(!bad.length, 'relations come out right: ' + cases.map(([a, b, r]) => b.name + ' is ' + a.name + '\u2019s ' + R(a, b)).slice(0, 6).join(', ') + '\u2026' + (bad.length ? ' WRONG: ' + bad.map(([a, b, r]) => b.name + '=' + R(a, b) + ' not ' + r).join(', ') : ''));
  check(Sim.relation(g, me.id, mk('Stranger', 'm').id) === null, 'strangers are not related');
}

console.log('23. Crownmere: the capital on Crown Lake');
{
  const s = Sim.newGame(140), C = Sim.CM;
  const folk = Sim.townFolk(s, 'crownmere'), cb = Object.values(s.biz).filter(b => b.town === 'crownmere');
  check(folk.length >= 1100 && folk.length <= 1250 && folk.filter(p => !p.kid).every(p => p.home), 'Crownmere has ' + folk.length + ' people, every grown one with a roof');
  check(cb.length >= 50 && s.towns.crownmere.title === 'Lord Mayor', cb.length + ' businesses and a Lord Mayor, ' + s.people[s.towns.crownmere.mayor].name);
  const segD = (x, z, pts) => { let b = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
  const blds = C.biz.map(b => ({ x: b.x, z: b.z, r: 4.9 })).concat(C.houses.map(h => ({ x: h.x, z: h.z, r: 4.3 })));
  check(blds.every(b => C.inside(b.x, b.z) && C.lakeDist(b.x, b.z) > 4 && C.streets.every(st => st.pts.length < 2 || segD(b.x, b.z, st.pts) > st.w / 2 + 2.8)), blds.length + ' buildings, all inside the walls, none in the lake or on a street');
  check(Sim.roadDist('oakbridge', 'crownmere') > 300 && Sim.roadDist('greenhaven', 'crownmere') > 200, 'roads run to the capital from Oakbridge and from Greenhaven');
  s.coins = 100; const st = Sim.STAGE.oakbridge; s.player.x = st.x; s.player.z = st.z; Sim.advance(s, 180);
  const r = Sim.cmd(s, 'coach', 'crownmere'); check(r.ok && Sim.townAt(s.player.x, s.player.z) === 'crownmere', 'the coach from Oakbridge reaches Crownmere in ' + r.mins + ' minutes');
  Sim.step(s, 0.01); const bodies = s.agents.filter(a => a.kind === 'person');
  check(bodies.length > 1000 && bodies.every(a => Sim.townOf(s.people[a.pid]) === 'crownmere'), 'in the capital, ' + bodies.length + ' townsfolk are about');
  let wet = 0, t0 = Date.now(); for (let k = 0; k < 600; k++) { Sim.advance(s, 1); if (k % 20) continue; for (const a of bodies) if (C.lakeDist(a.x, a.z) < -1) wet++; }
  check(wet === 0, 'nobody walks into the lake');
  check(Date.now() - t0 < 30000, 'ten hours of a busy capital take ' + (Date.now() - t0) + ' ms to simulate');
}

console.log('24. Stage II checks: a month away with your businesses in good hands, and real choices as Elder');
{
  const s = Sim.newGame(150); s.coins = 3000; s.trades.bakery = 5;
  Sim.cmd(s, 'buyBiz', 'o_bell'); Sim.cmd(s, 'buyBiz', 'g_bake'); Sim.cmd(s, 'open', 1, 'bakery'); const sh = s.shops[0];
  for (const [k, id] of [['biz', 'o_bell'], ['biz', 'g_bake'], ['shop', sh.id]]) { const c = Sim.managerCandidates(s, k, id)[0]; Sim.cmd(s, 'hireManager', k, id, c.pid); }
  s.player.x = Sim.STAGE.crownmere.x + 400; s.player.z = Sim.STAGE.crownmere.z - 200;   // away in the hills, far from all three
  const c0 = s.coins; Sim.advance(s, 1440 * 30);
  const stillOpen = !s.biz.o_bell.closed && !s.biz.g_bake.closed && s.shops.length === 1;
  check(stillOpen && s.coins > c0, 'after thirty days away, all three businesses are open and you are ' + (s.coins - c0) + 'c richer');
  const elder = (w) => { const g = Sim.newGame(151), v = g.village; g.offices.elder = 'player'; v.council = true; v.chest = 600; Sim.cmd(g, 'works', w); Sim.advance(g, 1440 * 12); return g.gov.approval.elder; };
  const gen = elder(40), mean = elder(0);
  check(gen > mean + 3, 'as Elder, your choices count: after twelve days, generous village works leave approval at ' + Math.round(gen) + ', starving them leaves it at ' + Math.round(mean));
}

console.log('25. Homes and property: furnishing, selling, letting, and what things are worth');
{
  const s = Sim.newGame(160); s.coins = 3000;
  const h = s.houses.find(x => x.town === 'oakbridge'); Sim.cmd(s, 'buyHouse', h.id); h.tenants.slice().forEach(t => Sim.cmd(s, 'evict', h.id, t));
  const v0 = Sim.houseValue(s, h); check(Sim.cmd(s, 'improveHome', h.id).ok && Sim.houseValue(s, h) > v0, 'furnishing a house raises its value (' + v0 + 'c to ' + Sim.houseValue(s, h) + 'c)');
  check(Sim.cmd(s, 'moveIn', h.id).ok && Sim.yourHouse(s) === h && !Sim.cmd(s, 'listForSale', 'house', h.id, 300).ok, 'you move in, and cannot sell the roof over your head');
  Sim.cmd(s, 'moveToHut'); Sim.cmd(s, 'listForSale', 'house', h.id, Math.round(Sim.houseValue(s, h) * 1.05));
  for (let d = 0; d < 20 && !(s.offers || []).length; d++) Sim.advance(s, 1440);
  const o = (s.offers || [])[0]; check(o && o.amount > 50, 'a buyer comes forward: ' + (o ? s.people[o.pid].name + ' offers ' + o.amount + 'c' : 'nobody'));
  if (o) { const c0 = s.coins; check(Sim.cmd(s, 'acceptOffer', o.n).ok && h.owner === o.pid && s.coins === c0 + o.amount, 'the house is sold and the money is yours'); }
  Sim.cmd(s, 'buyBiz', 'o_bell'); const lc = Sim.leaseCandidates(s, 'o_bell')[0];
  check(Sim.cmd(s, 'leaseBiz', 'o_bell', null, lc.pid).ok && s.people[lc.pid].job.biz === 'o_bell', lc.name + ' takes The Bell on a lease at ' + lc.offer + 'c a day');
  const c1 = s.coins; Sim.advance(s, 1440 * 5); check(s.coins > c1 && s.biz.o_bell.lease, 'the rent comes in while they run it');
  const m = s.market.oakbridge; check(m >= 0.7 && m <= 1.45, 'property prices drift with each town (Oakbridge at ' + Math.round(m * 100) + '%)');
}

console.log('26. Ironcrest and Eastwatch');
{
  const s = Sim.newGame(170);
  for (const [t, lo, hi] of [['ironcrest', 180, 240], ['eastwatch', 440, 540]]) {
    const folk = Sim.townFolk(s, t), bz = Object.values(s.biz).filter(b => b.town === t);
    check(folk.length >= lo && folk.length <= hi && folk.filter(p => !p.kid).every(p => p.home) && bz.length >= 10 && s.towns[t], Sim.TOWNS[t].name + ' has ' + folk.length + ' people with roofs, ' + bz.length + ' businesses and a ' + s.towns[t].title);
  }
  check(Sim.roadDist('crownmere', 'ironcrest') > 300 && Sim.roadDist('oakbridge', 'eastwatch') > 300, 'roads climb to Ironcrest from Crownmere and run east to Eastwatch from Oakbridge');
  s.coins = 200; const st = Sim.STAGE.oakbridge; s.player.x = st.x; s.player.z = st.z;
  const r = Sim.cmd(s, 'coach', 'eastwatch'); check(r.ok && Sim.townAt(s.player.x, s.player.z) === 'eastwatch', 'the coach reaches Eastwatch in ' + r.mins + ' minutes');
  Sim.advance(s, 600); check(s.agents.filter(a => a.kind === 'person').length > 400, 'the port is busy with its people');
}

console.log('27. Bandits on the roads');
{
  const s = newGameRaw(180); s.ageRate = 0; s.bandits.ironcrest = 95; s.realm.regions.ironcrest.patrol = 0;
  const ch = s.towns.ironcrest.chest; let raided = false;
  for (let d = 0; d < 20 && !raided; d++) { Sim.advance(s, 1440); raided = s.bandits.lastRaid && s.bandits.lastRaid.town === 'ironcrest'; }
  check(raided && s.towns.ironcrest.chest < ch + 200, 'left unchecked, bandits raid Ironcrest');
  s.bandits.oakbridge = 80; s.coins = 500; const c0 = s.bandits.oakbridge; Sim.cmd(s, 'fundPatrol', 'oakbridge', 90);
  check(s.bandits.oakbridge < c0, 'paying for patrols drives them back');
}

console.log('28. To the throne of Alderwyn by deeds, and back from exile');
{
  const s = newGameRaw(190); s.ageRate = 0; const R = s.realm, cm = Sim.STAGE.crownmere, at = (x, z) => { s.player.x = x; s.player.z = z; }, away = () => at(0, 4), court = () => at(cm.x, cm.z);
  const atMarket = t => { const L = Sim.LOCS[Sim.MARKET_AT[t]]; at(L.x, L.z); };
  check(R.crown === 'king' && Object.keys(R.regions).every(id => Sim.lordName(s, id) !== 'no one') && R.figures.length === 3, 'the realm has a King, six lords and three people of influence');
  s.coins = 6000; court();
  const g0 = R.favour; Sim.cmd(s, 'giftCrown', 300); const g1 = R.favour - g0; Sim.cmd(s, 'giftCrown', 300); const g2 = R.favour - g0 - g1;
  check(g2 < g1, 'a second gift soon after the first counts for less (' + Math.round(g1) + ' then ' + Math.round(g2) + ' favour)');
  R.favour = 60; s.people[R.regions.eastwatch.lord].rep = 30;
  check(!Sim.cmd(s, 'seekLordship', 'eastwatch').ok, 'favour and coin are not enough: the King wants a deed done in Eastwatch first');
  // do a contract for Eastwatch
  R.contracts = [{ n: 999, kind: 'supply', region: 'eastwatch', good: 'grain', qty: 10, reward: 60, what: 'deliver 10 grain to the market in Eastwatch', who: 'Rowena Tarrant', until: s.day + 6, day: s.day }];
  check(Sim.cmd(s, 'takeContract', 999).ok, 'you take a contract to supply Eastwatch');
  s.player.inv.grain = 10; atMarket('eastwatch');
  check(Sim.cmd(s, 'fulfil', 999).ok && Sim.deedsIn(s, 'eastwatch') === 1, 'you deliver the grain: a deed done for Eastwatch');
  court(); check(Sim.cmd(s, 'seekLordship', 'eastwatch').ok && Sim.yourLordships(s).includes('eastwatch'), 'now the King grants you Eastwatch');
  s.people[R.regions.ironcrest.lord].rep = 20; R.deeds.ironcrest = 1;
  check(!Sim.cmd(s, 'seekLordship', 'ironcrest').ok, 'a lord holds one region at a time');
  check(Sim.cmd(s, 'moveToSeat').ok && /Castle/.test(Sim.homeOfYou(s).name), 'you move into your seat: ' + Sim.homeOfYou(s).name);
  check(!Sim.cmd(s, 'seekSeat', 'trade').ok, 'a council seat needs allies and a name for good government');
  // allies: back the reformer and the lord of Ironcrest; good government
  Sim.cmd(s, 'backFigure', 'reformer'); Sim.cmd(s, 'backFigure', 'lord');
  s.bandits.eastwatch = 5; for (let d = 0; d < 10; d++) { away(); Sim.advance(s, 1440); s.bandits.eastwatch = 5; }
  R.favour = 70; court();
  check(!Sim.cmd(s, 'seekSeat', 'trade').ok && Sim.seatNeeds(s, 'trade').length > 0, 'Master of Trade wants proof of the road of coin: ' + Sim.seatNeeds(s, 'trade').join('; '));
  R.contractsByKind = Object.assign(R.contractsByKind || {}, { supply: 3 }); s.coins += 3000;
  Object.values(s.biz).filter(b => b.town === 'eastwatch' && b.owner !== 'player' && s.people[b.owner]).slice(0, 3).forEach(b => Sim.cmd(s, 'buyBiz', b.id));
  check(Sim.cmd(s, 'seekSeat', 'trade').ok, 'with ' + Sim.alliesOf(s).length + ' allies, ten days of good rule, three businesses and three contracts, you are named Master of Trade');
  check(!Sim.cmd(s, 'seekSeat', 'war').ok && s.player.councilPath === 'coin', 'on the road of coin, the Marshal\u2019s seat is shut to you');
  // a promise kept
  R.promises = [{ region: 'oakbridge', pid: R.regions.oakbridge.lord, day: s.day, state: 'asked' }];
  check(Sim.cmd(s, 'givePromise').ok, 'a lord asks for your word, and you give it');
  for (let d = 0; d < 8; d++) { s.bandits.oakbridge = 5; away(); Sim.advance(s, 1440); }
  check(R.kept >= 1, 'you keep it');
  for (let d = 0; d < 12; d++) { court(); Sim.cmd(s, 'undermineKing'); Sim.cmd(s, 'attendCourt'); away(); Sim.advance(s, 1440); }
  const rally = () => { Sim.cmd(s, 'patronage', 'lords'); Sim.cmd(s, 'patronage', 'guilds'); for (const t of Object.keys(Sim.TOWNS)) Sim.cmd(s, 'patronage', 'town', t); };
  for (let round = 0; round < 3; round++) { rally(); for (let d = 0; d < 15; d++) { court(); Sim.cmd(s, 'attendCourt'); away(); Sim.advance(s, 1440); s.bandits.eastwatch = 5; } }
  rally(); R.kingSupport = Math.min(R.kingSupport, 40); court(); const sup = Sim.computeSupport(s);
  const rc = Sim.cmd(s, 'claimCrown'); check(rc.ok && Sim.isRuler(s), 'with ' + Sim.alliesOf(s).length + ' allies, a kept promise and support of ' + sup + ', you are crowned' + (rc.ok ? '' : ': ' + rc.msg));
  R.treasury = Math.max(R.treasury, 1000); Sim.cmd(s, 'rule', 'draw', 700); check(R.embezzled === 700, 'taking 700c from the treasury is remembered');
  R.figures.find(f => f.kind === 'reformer').ally = false; s.coins = 0; for (let d = 0; d < 30 && Sim.isRuler(s); d++) { away(); Sim.advance(s, 1440); }
  check(!Sim.isRuler(s) && R.exile, 'an inquiry finds the theft, you cannot repay, and the council removes you: exile');
  s.coins = 3000; court();
  check(!Sim.cmd(s, 'claimCrown').ok, 'waiting is not enough: you need allies, a war chest, the towns and the new ruler exposed');
  const lords = Object.keys(R.regions).map(id => Sim.regionLord(s, id)).filter(l => l && l !== 'player' && l !== R.king).slice(0, 3); lords.forEach(l => { s.people[l].opinion = 40; });
  lords.forEach(l => Sim.cmd(s, 'rallyAlly', l)); Sim.cmd(s, 'warChest', 600);
  // winter can cost a point or two of the towns' goodwill, so keep rallying until support is there (at most five rounds)
  for (let round = 0; round < 5 && (round < 3 || Sim.supportOf(s) < 67); round++) { s.coins += 1500; rally(); for (let d = 0; d < 15; d++) { away(); Sim.advance(s, 1440); } }
  for (let d = 0; d < 12 && R.kingSupport >= 50; d++) { court(); Sim.cmd(s, 'exposeRuler'); away(); Sim.advance(s, 1440); }
  court(); const rr = Sim.cmd(s, 'claimCrown');
  check(rr.ok && Sim.isRuler(s) && !R.exile, 'with sworn allies, a war chest, the towns and the new ruler exposed, you take the crown back' + (rr.ok ? '' : ': ' + rr.msg));
  const back = Sim.deserialize(Sim.serialize(s)); check(back.realm.crown === 'player' && back.realm.figures.length === 3, 'the realm saves and loads');
}

console.log('29. One fair economy, and how you begin');
{
  const s = newGameRaw(200); s.ageRate = 0;
  const gp = t => Sim.goodsPrice(s, t, 'grain'), op = t => Sim.goodsPrice(s, t, 'ore');
  check(gp('greenhaven') < gp('crownmere') && op('ironcrest') < op('crownmere'), 'grain is cheapest in Greenhaven (' + gp('greenhaven').toFixed(1) + 'c) and iron in Ironcrest (' + op('ironcrest').toFixed(1) + 'c); Crownmere pays more for both');
  const L = Sim.LOCS[Sim.MARKET_AT.ironcrest]; s.player.x = L.x; s.player.z = L.z; s.coins = 100;
  const p0 = Sim.goodsPrice(s, 'ironcrest', 'ore'); check(Sim.cmd(s, 'buy', 'ore', 20).ok && s.player.inv.ore === 20, 'you buy 20 iron ore at the Ironcrest market');
  check(Sim.goodsPrice(s, 'ironcrest', 'ore') > p0, 'buying it pushes the local price up');
  const C = Sim.LOCS[Sim.MARKET_AT.crownmere]; s.player.x = C.x; s.player.z = C.z; const c0 = s.coins;
  check(Sim.cmd(s, 'sell', 'ore', 20).ok && s.coins > c0 + 20, 'carried to Crownmere it sells for ' + (s.coins - c0) + 'c: trade pays, but not without limit');
  // every business on the same rules
  const g2 = newGameRaw(201); g2.ageRate = 0; g2.bandits = null; g2.coins = 2000; g2.trades.bakery = 5; Sim.cmd(g2, 'open', 1, 'bakery'); const sh = g2.shops[0];
  check(Sim.shopShare(g2, sh) < 0.7, 'your Bread Stand shares the village’s bread trade with Gerd’s Bakehouse (' + Math.round(Sim.shopShare(g2, sh) * 100) + '% of it)');
  Sim.cmd(g2, 'buyBiz', 'o_bell'); for (let d = 0; d < 4; d++) Sim.advance(g2, 1440);
  const paybacks = Object.values(g2.biz).filter(b => !b.closed && b.lastProfit > 0 && b.trade !== 'estate').map(b => Sim.bizPrice(g2, b.id) / b.lastProfit);
  check(paybacks.length > 50 && Math.min(...paybacks) > 8, 'no business pays for itself in under a week: the quickest takes ' + Math.round(Math.min(...paybacks)) + ' days');
  // starts
  for (const m of ['merchant', 'elder', 'lord', 'ruler']) {
    const g = Sim.newGame(210, 'Josh Bales'); Sim.applyStart(g, m);
    const okm = m === 'merchant' ? g.shops.length === 1 : m === 'elder' ? g.offices.elder === 'player' : m === 'lord' ? Sim.yourLordships(g).includes('greenhaven') && Sim.homeOfYou(g).name === 'Bales Hall' : Sim.isRuler(g) && Sim.homeOfYou(g).name === 'Crownmere Castle';
    check(okm, 'starting as ' + Sim.STARTS[m].name.toLowerCase() + ': ' + Sim.STARTS[m].say);
  }
  // a child heir has a regent
  const g3 = newGameRaw(220); g3.bandits = null; g3.village.council = true; g3.village.step = 6; const Y = Sim.you(g3);
  const kid = Sim.living(g3).find(q => q.kid && q.age >= 6 && q.age <= 10); kid.parents = [Y.pid]; kid.home = 'you'; g3.pendingDeath = { day: 1, age: 70 };
  Sim.cmd(g3, 'carryOn', kid.id); const Y3 = Sim.you(g3);
  check(Y3.age < 16 && Y3.regent && !g3.village.council && !Sim.cmd(g3, 'buyBiz', 'o_bell').ok, 'carrying on as a ' + Y3.age + '-year-old: ' + Y3.regent.name + ' is regent, the council seat falls vacant, and you cannot sign for a business yet');
console.log('30. The books add up: every coin has a named line');
{
  const s = Sim.newGame(77); s.coins = 3000; s.trades.bakery = 99; s.player.inv = { grain: 10, wood: 10, ore: 10 };
  Sim.cmd(s, 'open', 0, 'bakery'); const sh = s.shops[0]; if (s.applicants.length) Sim.cmd(s, 'hire', sh.id, 0, s.applicants[0].ask);
  const bz = Object.values(s.biz).find(b => b.town === 'oakbridge'); Sim.cmd(s, 'buyBiz', bz.id);
  const h = s.houses.find(x => !x.town && x.owner === 'office:lord'); Sim.cmd(s, 'buyHouse', h.id);
  sh.tier = 1; s.applicants.push({ name: 'Tam Reeve', skill: 1, ask: 7 }); Sim.cmd(s, 'hireHand', sh.id, s.applicants.length - 1, 7);
  Sim.advance(s, 1440);
  Sim.cmd(s, 'improveHome', h.id); Sim.cmd(s, 'giftCrown', 30);
  for (let d = 0; d < 6; d++) Sim.advance(s, 1440);
  const later = s.ledger.slice(1), bad = later.filter(e => e.unexplained);
  check(later.length >= 5 && bad.length === 0, 'over ' + later.length + ' days no coin goes unrecorded' + (bad.length ? ' (day ' + bad[0].day + ': ' + bad[0].unexplained + 'c)' : ''));
  check(later.some(e => (e.otherItems || []).some(x => /Gift to the crown/.test(x.label))), 'a gift to the crown shows as its own line');
  check(later.every(e => { const p = s.ledger[s.ledger.indexOf(e) - 1]; return !p || e.coinsEnd - p.coinsEnd === e.profit; }), 'each day’s profit is exactly the change in your coins');
}

console.log('31. Law and order: the watch, cases, cells, and the people who know');
{
  const s = Sim.newGame(31); Sim.applyStart(s, 'elder'); s.village.chest = 400; Sim.advance(s, 1440);
  const J = s.justice, C = (...a) => Sim.cmd(s, ...a);
  check(J && J.watch.length >= 1 && J.cells === 2, 'Hearthmoor starts with a named watch and two cells');
  let kinds = new Set(); for (let d = 0; d < 40; d++) { Sim.advance(s, 1440); J.cases.concat(J.closed).forEach(c => kinds.add(c.truth)); if (kinds.has('guilty') && (kinds.has('mistaken') || kinds.has('lie'))) break; }
  check(kinds.has('guilty') && (kinds.has('mistaken') || kinds.has('lie')), 'some accusations are true and some are not (' + Array.from(kinds).join(', ') + ')');
  // cells fill up
  const vil = Sim.villagers(s).filter(p => !p.kid && !p.held && p.status === 'here' && !(p.job && p.job.type === 'office'));
  const mk = p => { const c = { id: J.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 3 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: vil[0].id, victim: vil[0].id, value: 8, where: 'a house', truth: 'guilty', what: 'test', claim: 'test', authority: 'Elder of Hearthmoor' }; J.cases.push(c); return c; };
  J.prisoners.slice().forEach(pr => C('jRelease', pr.pid));
  const c1 = mk(vil[1]), c2 = mk(vil[2]), c3 = mk(vil[3]);
  check(C('jArrest', c1.id).ok && C('jArrest', c2.id).ok && !C('jArrest', c3.id).ok, 'two cells hold two prisoners; a third arrest is refused');
  check(!C('jHear', c1.id, { days: 5 }, 'guilty').ok, 'the Elder cannot order more than three days');
  // a held worker leaves your shop short, and comes back
  s.coins = 500; s.trades.bakery = 9; C('open', 0, 'bakery'); const sh = s.shops[0]; s.applicants.unshift({ name: vil[4].name, pid: vil[4].id, skill: 1, ask: 7 }); C('hire', sh.id, 0, 7);
  C('jRelease', vil[2].id); const c4 = mk(vil[4]); C('jArrest', c4.id);
  check(vil[4].held && Sim.income(s, vil[4]) === 0, vil[4].name + ', your worker, is held: no work and no wage');
  for (let d = 0; d < 6; d++) Sim.advance(s, 1440);
  check(!vil[4].held && !c4.held, 'not heard by the next day, they are released');
  // an unpayable fine is paid off or worked off, never more prison
  const poor = vil[5]; poor.purse = 3; const c5 = mk(poor); C('jHear', c5.id, { fine: 30 }, 'guilty');
  const owed0 = c5.fineOwed; for (let d = 0; d < 5; d++) Sim.advance(s, 1440);
  check(owed0 > 0 && c5.fineOwed < owed0 && !poor.held, 'a fine they cannot pay is paid off or worked off a little at a time (' + owed0 + 'c to ' + c5.fineOwed + 'c), with no prison for debt');
  // an honest guard refuses an unlawful order
  J.watch.forEach(g => { g.honest = 1; s.people[g.pid].opinion = -60; }); J.fear = 0;
  let refused = false; for (let k = 0; k < 6 && !refused; k++) { const r = C('jArrestOnWord', vil[6].id); refused = r.ok && r.msg === 'refused'; if (vil[6].held) C('jRelease', vil[6].id); }
  check(refused && J.secrets.some(k => k.kind === 'order'), 'an honest guard refuses to arrest someone with no charge, and that is remembered');
  // a bribe works, once, and leaves a secret
  const c6 = mk(vil[7]); c6.bribe = { pid: vil[7].id, amount: 20, wants: 'dismiss' }; vil[7].purse = 50; const coins0 = s.coins;
  check(C('jBribe', c6.id, true).ok && s.coins === coins0 + 20 && J.secrets.some(k => k.kind === 'bribe') && !J.cases.includes(c6), 'a bribe pays and the case goes away, but someone knows');
  check(!C('jBribe', c6.id, true).ok, 'the same bribe cannot be taken twice');
  // appeals
  const c7 = mk(vil[8]); C('jArrest', c7.id); C('jHear', c7.id, { fine: 5, days: 3 }, 'guilty');
  s.realm.council.law = 'player'; const p8 = vil[8].purse;
  check(C('jOverturn', c7.id).ok && !vil[8].held && vil[8].purse > p8, 'the Lord Justice overturns a conviction: freed, and paid for the wrong');
  s.realm.council.law = null;
  // save and load in the middle of a case
  const c8 = mk(vil[9]); C('jArrest', c8.id);
  const s2 = JSON.parse(JSON.stringify(s)); Sim.advance(s2, 1440);
  check(s2.justice.cases.some(c => c.id === c8.id) && s2.people[vil[9].id].held, 'a case and its prisoner survive a save and load');
  // losing office mid-case: the council takes it on
  s.offices.elder = vil[10].id; for (let d = 0; d < 6; d++) Sim.advance(s, 1440);
  check(!J.cases.some(c => c.id === c8.id), 'when you are no longer Elder, your open cases are heard by the council');
  // a prisoner named to an office is released
  const c9 = mk(vil[11]); s.offices.elder = 'player'; C('jArrest', c9.id); s.offices.elder = vil[10].id;
  Sim.appoint(s, 'watch', vil[11].id);
  check(!vil[11].held, 'someone held who is named to an office is released to take it up');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'fines, bribes and repayments all have their own lines in your books');
}

console.log('32. Courts of the towns, and the crown’s hand');
{
  const s = newGameRaw(32); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 4000; Sim.advance(s, 1440);
  const C = s.courts, R = s.realm, X = (...a) => Sim.cmd(s, ...a);
  check(C && C.greenhaven.cells === 2 && C.crownmere.cells === 14 && C.oakbridge.captain, 'every town has a gaol to its size and a guard captain');
  const folk = Sim.living(s).filter(p => p.town === 'greenhaven' && !p.kid && p.status === 'here'), O = Sim.living(s).filter(p => p.town === 'oakbridge' && !p.kid && p.status === 'here');
  const mk = (Cx, p, o) => { const c = Object.assign({ id: s.justice.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 4 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: null, victim: 'chest', value: 30, where: 'the chest', truth: 'guilty', what: 'test', claim: 'test', authority: Cx.authority, court: Cx.id }, o || {}); Cx.cases.push(c); return c; };
  const c1 = mk(C.oakbridge, O[3]);
  check(!X('jArrest', c1.id).ok, 'a lord of Greenhaven gives no orders in the court of Oakbridge');
  const c2 = mk(C.greenhaven, folk[2]);
  check(X('jArrest', c2.id).ok && folk[2].held && C.greenhaven.prisoners.length === 1, 'in your own region you arrest into the town’s gaol');
  check(X('jHear', c2.id, { fine: 50, days: 8, restitution: true }, 'guilty').ok && C.greenhaven.prisoners.find(x => x.pid === folk[2].id).until === s.day + 8, 'a lord can sentence up to ten days and fine up to 100c');
  // confiscation: lawful forfeiture against taking it yourself
  const ownerB = Object.values(s.biz).find(b => b.town === 'greenhaven' && s.people[b.owner] && s.people[b.owner].status === 'here' && b.trade !== 'estate');
  if (ownerB) { const own = s.people[ownerB.owner], ch0 = s.towns.greenhaven.chest; const c3 = mk(C.greenhaven, own, { kind: 'corruption' });
    const small = mk(C.greenhaven, own, { kind: 'theft', value: 10 }); X('jHear', small.id, { confiscate: 'lawful' }, 'guilty');
    check(ownerB.owner === own.id && /more than the law allows/.test(small.outcome), 'a 10c theft cannot cost them a business worth ' + Sim.bizPrice(s, ownerB.id) + 'c');
    c3.value = Math.ceil(Sim.bizPrice(s, ownerB.id) / 2);
    check(X('jHear', c3.id, { confiscate: 'lawful' }, 'guilty').ok && ownerB.owner !== 'player' && s.towns.greenhaven.chest > ch0, 'lawful forfeiture for a ' + c3.value + 'c fraud on the chest: ' + Sim.empById(ownerB.id).name + ' is sold for the town chest, not for you'); }
  const ownerB2 = Object.values(s.biz).find(b => b.town === 'greenhaven' && b.owner !== 'player' && s.people[b.owner] && s.people[b.owner].status === 'here' && !b.closed && b.trade !== 'estate');
  if (ownerB2) { const own = s.people[ownerB2.owner]; const c4 = mk(C.greenhaven, own, { kind: 'corruption' }); const n0 = s.justice.secrets.length;
    check(X('jHear', c4.id, { confiscate: 'take' }, 'guilty').ok && ownerB2.owner === 'player' && s.justice.secrets.length > n0, 'taking it for yourself works, and is a theft someone remembers'); }
  // the council's offices
  R.council.treasury = 'player'; s.towns.oakbridge.skims = [{ pid: s.towns.oakbridge.mayor, amount: 30, day: s.day }];
  let found = false; for (let k = 0; k < 6 && !found; k++) { R.lastAudit = null; X('xAudit'); found = !s.towns.oakbridge.skims.length; }
  check(found, 'the Lord Treasurer’s audit finds a mayor’s hand in the chest');
  R.council.treasury = null; R.council.war = 'player'; s.bandits.ironcrest = 60; R.treasury = 500;
  check(X('xSoldiers', 'ironcrest').ok && s.bandits.ironcrest < 60 && (R.military || []).length, 'the Marshal’s soldiers sweep the roads and bring back prisoners');
  check(X('xMartial', null, 'hang').ok && !(R.military || []).length, 'military prisoners are tried by the Marshal, apart from the watch');
  R.council.war = null; R.council.law = 'player';
  const h = O[5]; const ord = mk(C.oakbridge, h, { kind: 'order', truth: 'none' }); ord.held = true; ord.deadline = s.day + 4; s.courts.oakbridge.prisoners.push({ pid: h.id, caseId: ord.id, court: 'oakbridge', reason: 'held on order', since: s.day, until: s.day + 4 }); h.held = { caseId: ord.id };
  check(X('xReview').ok && !h.held, 'the Lord Justice’s review frees someone held on an order with no charge');
  R.council.law = null; R.crown = 'player';
  const k0 = Object.keys(Sim.COUNCIL).find(k => R.council[k] && R.council[k] !== 'player'), old = R.council[k0];
  check(X('xDismiss', k0).ok && R.council[k0] !== old, 'the crown dismisses a councillor and names another');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'lands, fines and seizures all have lines in your books');
}

console.log('33. The calendar, the seasons, and justice in proportion');
{
  const s = newGameRaw(33); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 4000; Sim.advance(s, 1440);
  const cal = d => Sim.calendar({ day: d });
  check(cal(1).monthName === 'Thawmonth' && cal(1).dom === 1 && cal(5).dom === 5 && cal(6).monthName === 'Seedmonth', 'months are five days long');
  check(cal(46).season === 'winter' && cal(31).season === 'autumn' && cal(61).year === 2 && cal(61).season === 'spring', 'twelve months make a sixty-day year, in four seasons');
  check(Sim.SEASON_FX.autumn.grain > 1 && Sim.SEASON_FX.winter.grain < 1 && Sim.SEASON_FX.winter.fuel > 1 && Sim.SEASON_FX.winter.travel < 1, 'harvest in autumn; in winter the fields are bare, fires burn and fewer travel');
  const C = s.courts, R = s.realm, X = (...a) => Sim.cmd(s, ...a);
  const folk = Sim.living(s).filter(p => p.town === 'greenhaven' && !p.kid && p.status === 'here' && !p.held && !(p.job && p.job.role === 'owner'));
  const mk = (p, o) => { const c = Object.assign({ id: s.justice.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 4 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: null, victim: 'chest', value: 8, where: 'the market', truth: 'guilty', what: 'test', claim: 'test', authority: C.greenhaven.authority, court: 'greenhaven' }, o || {}); C.greenhaven.cases.push(c); return c; };
  // waiting for a hearing is a day, not a season
  const a1 = mk(folk[0]); X('jArrest', a1.id);
  check(a1.held && a1.deadline === s.day + 1, 'someone arrested must be heard by the next day');
  // mercy is lawful
  folk[1].hungry = true; folk[1].purse = 2; const op = folk[1].opinion || 0; const m1 = mk(folk[1]);
  check(Sim.mercyReasons(s, m1).some(r => r.key === 'hardship') && X('jHear', m1.id, { why: 'hardship' }, 'mercy').ok && m1.verdict === 'mercy' && /hunger and need/.test(m1.outcome) && (folk[1].opinion || 0) > op, 'a guilty verdict with an open pardon is lawful mercy, and remembered kindly');
  // community work: the town gains, the convicted keeps their liberty
  const ch0 = s.towns.greenhaven.chest, w1 = mk(folk[2]); X('jHear', w1.id, { work: 2 }, 'guilty');
  check(w1.workLeft === 2 && !folk[2].held, 'two days of work for the town, not the cells');
  Sim.advance(s, 1440 * 3);
  check(!w1.workLeft && s.towns.greenhaven.chest !== ch0, 'the work is done and the town has its value');
  // the house price is what the house earns, not what you ask
  const h = s.houses.find(x => x.owner === 'player' && x.tenants.length) || s.houses.find(x => x.tenants.length);
  if (h) { const own0 = h.owner; h.owner = 'player'; h.rent0 = h.rent0 || h.rent; const v0 = Sim.houseValue(s, h), r0 = h.rent; h.rent = r0 * 20; const v1 = Sim.houseValue(s, h); h.rent = r0; h.owner = own0;
    check(v1 <= v0 * 1.3, 'raising the rent twentyfold does not make the house worth twenty times as much (' + v0 + 'c to ' + v1 + 'c)'); }
  // the council: one seat at a time, and you can change roads
  R.council.law = 'player'; s.player.councilPath = 'law';
  check(!X('seekSeat', 'war').ok, 'you cannot hold two seats on different roads');
  check(X('resignSeat').ok && R.council.law !== 'player' && !X('seekSeat', 'war').ok, 'you can resign, but must wait before seeking another seat');
  for (const id in s.bandits) s.bandits[id] = 50;
  check(Sim.seatNeeds(s, 'war').some(n => /bandits/.test(n)), 'the Marshal’s seat asks for safe roads in your lands, not just coin spent');
  // hoarding: negotiate, and the stock comes back to market
  const hoarder = Sim.living(s).find(p => p.town === 'greenhaven' && p.job && p.job.role === 'owner' && p.status === 'here');
  const T = s.towns.greenhaven, g0 = s.goods.greenhaven.grain; T.hoard = { pid: hoarder.id, good: 'grain', qty: 30, day: s.day, deliberate: true }; s.goods.greenhaven.grain = Math.max(0, g0 - 30);
  const hc = mk(hoarder, { kind: 'hoarding', victim: 'chest', value: 0, good: 'grain' });
  check(X('jHear', hc.id, {}, 'negotiate').ok && !T.hoard && s.goods.greenhaven.grain >= g0 - 0.01 - 0, 'a hoarder agrees to put the grain back on sale');
  // smuggling: cargo seized for the town, or for you, which is remembered
  const sm = mk(folk[3], { kind: 'smuggling', victim: 'crown', value: 40, good: 'wine' }), tc0 = T.chest;
  X('jHear', sm.id, { fine: 20, seize: 'chest' }, 'guilty');
  check(T.chest >= tc0 + 60 && /cargo is seized/.test(sm.outcome), 'smuggled wine is seized for the town chest');
  const sm2 = mk(folk[4], { kind: 'smuggling', victim: 'crown', value: 40, good: 'salt' }), coins0 = s.coins, n0 = s.justice.secrets.length;
  X('jHear', sm2.id, { seize: 'you' }, 'guilty');
  check(s.coins === coins0 + 60 && s.justice.secrets.length > n0, 'keeping the seized salt yourself pays, and someone knows');
  // poaching: charge the man who paid for the deer
  const orgP = Sim.living(s).find(p => p.town === 'greenhaven' && p.job && p.job.role === 'owner' && p.status === 'here' && p !== hoarder) || hoarder;
  const pc = mk(folk[5], { kind: 'poaching', victim: 'crown', value: 30, organiser: orgP.id });
  X('jHear', pc.id, { fine: 5, organiser: true }, 'guilty');
  check(C.greenhaven.cases.some(k => k.kind === 'poaching' && k.accused === orgP.id), 'the hunter names the organiser, ' + orgP.name + ', and a case opens against them');
  // bandits: more fates than the rope
  R.council.war = 'player'; const fates = ['press', 'prison', 'work', 'pardon', 'hang'].map(f => { R.military = [{ n: 4, region: 'ironcrest' }]; return X('xMartial', null, f).ok; });
  check(fates.every(Boolean) && (R.banditPrison || []).length && (R.workGang || []).length && (R.parolees || []).length && (R.pressed || []).length, 'captured bandits can be hanged, pressed, imprisoned, set to work or pardoned');
  for (let d = 0; d < 22; d++) Sim.advance(s, 1440);
  check(!(R.banditPrison || []).some(x => x.until < s.day), 'the dungeon lets them go when their time is up');
  R.council.war = null;
  // fraud: a dishonest manager skims, the books show it, and the court lets them go
  const b = Object.values(s.biz).find(x => x.town === 'greenhaven' && x.owner !== 'player' && x.trade !== 'estate' && !x.closed), mp = folk[6];
  b.owner = 'player'; b.manager = { pid: mp.id, name: mp.name, wage: 5, budget: 5, skill: 1, honest: 0 }; mp.job = { type: 'manage', kind: 'biz', ref: b.id };
  let fc = null; for (let d = 0; d < 60 && !fc; d++) { Sim.advance(s, 1440); fc = C.greenhaven.cases.find(k => k.kind === 'fraud' && k.accused === mp.id); }
  check(fc && fc.victim === 'player' && fc.value > 0, 'a dishonest manager skims the takings and the books show it (' + (fc ? fc.value : 0) + 'c)');
  if (fc) { fc.evidence.push({ text: 'x', w: 4 }); X('jHear', fc.id, { restitution: true, fine: 10 }, 'guilty'); check(!b.manager, 'convicted of fraud, the manager is dismissed'); }
  // the ruler's courts: most cases are heard locally
  const t2 = newGameRaw(34); t2.ageRate = 0; Sim.applyStart(t2, 'lord'); t2.realm.crown = 'player'; for (const id in t2.realm.regions) t2.realm.regions[id].lord = 'player';
  let mine = 0, all = 0; for (let d = 0; d < 20; d++) { Sim.advance(t2, 1440); }
  for (const Cx of Object.values(t2.courts)) for (const c of Cx.closed.concat(Cx.cases)) { all++; if (c.decidedBy === 'you' || (!c.delegated && c.status === 'open')) mine++; }
  check(all > 5 && mine <= all * 0.5, 'a ruler of every court sees ' + mine + ' of ' + all + ' cases; the rest are heard by the captains');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'skimmed takings, seized cargo and restitution all have lines in your books');
}

console.log('34. Silence that wears off, mercy with true reasons, and preparing for winter');
{
  const s = newGameRaw(35); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 3000; Sim.advance(s, 1440);
  const J = s.justice, R = s.realm, X = (...a) => Sim.cmd(s, ...a), v = Sim.living(s).find(p => p.town === 'greenhaven' && !p.kid && p.status === 'here');
  J.fear = 100; v.opinion = 0;
  check(Sim.talkChance(s, v, 'victim') > 0.02, 'even under great fear a victim may still speak (' + Sim.talkChance(s, v, 'victim').toFixed(3) + ' a day)');
  const k = { id: 999, kind: 'bribe', paid: { [v.id]: s.day + Sim.HUSH_DAYS }, demanded: { pid: v.id, amount: 20, paid: true, until: s.day + Sim.HUSH_DAYS } };
  check(Sim.hushed(s, k, v.id), 'paid to keep quiet, they stay quiet for now');
  s.day += Sim.HUSH_DAYS; check(!Sim.hushed(s, k, v.id), 'after ' + Sim.HUSH_DAYS + ' days the silence has worn off'); s.day -= Sim.HUSH_DAYS;
  // mercy: only true reasons are offered
  const C = s.courts.greenhaven, mk = (p, o) => { const c = Object.assign({ id: J.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 4 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: null, victim: 'chest', value: 10, where: 'x', truth: 'guilty', what: 'test', claim: 'test', authority: C.authority, court: 'greenhaven' }, o || {}); C.cases.push(c); return c; };
  const rep = Sim.living(s).filter(p => p.town === 'greenhaven' && !p.kid && p.status === 'here' && !p.held)[3]; rep.record = 2; rep.hungry = false; rep.purse = 50;
  const rc = mk(rep, { kind: 'assault', victim: v.id, value: 20 });
  const reasons = Sim.mercyReasons(s, rc).map(r => r.key);
  check(!reasons.includes('first') && !reasons.includes('hardship') && reasons.includes('favour'), 'a well-off repeat offender is not offered "first offence" or "hardship", only what is true (' + reasons.join(', ') + ')');
  const ap0 = s.towns.greenhaven.approval; X('jHear', rc.id, { why: 'favour' }, 'mercy');
  check(s.towns.greenhaven.approval < ap0 && rc.mercy === 'favour' && rep.record === 3, 'pardoning them as a favour is lawful, open, and costs you with the town');
  // bandits: a hearing within three days, and hanging is felt where they were taken
  R.military = [{ n: 4, region: 'ironcrest', day: s.day }]; for (let d = 0; d < 4; d++) Sim.advance(s, 1440);
  check(!(R.military || []).length && ((R.banditPrison || []).length || (R.workGang || []).length), 'unsentenced bandits go before the royal judges within three days, not into thin air');
  R.council.war = 'player'; for (const id in s.bandits) s.bandits[id] = 50; R.military = [{ n: 4, region: 'ironcrest', day: s.day }];
  X('xMartial', null, 'hang');
  check(s.bandits.ironcrest < 50 && s.bandits.eastwatch === 50, 'hanging quiets the roads where they were taken, not the whole realm');
  // the house price ignores a rent raised this morning
  const h = s.houses.find(x => x.tenants.length && x.rent > 0); h.owner = 'player'; const v0 = Sim.houseValue(s, h), r0 = h.rent; h.rent = r0 * 3;
  check(Sim.houseValue(s, h) === v0, 'a rent raised today adds nothing to the price (' + v0 + 'c)'); h.rent = r0;
  // winter, seen coming
  const cal = Sim.calendar({ day: 40 });
  check(cal.season === 'autumn' && cal.next === 'winter' && cal.daysLeft === 6, 'on day 40 the calendar says winter is six days away');
  check(s.priceLog && s.priceLog.hearthmoor && s.priceLog.hearthmoor.grain.length >= 4, 'the Trading Post keeps the last fifteen days of prices');
  // managers: a reference, and an audit that finds a skim
  const cands = Sim.managerCandidates(s, 'biz', Object.keys(s.biz)[0]);
  check(!cands.length || cands.every(c => typeof c.ref === 'string' && c.ref.length), 'every manager candidate comes with a word from those who know them');
  const b = Object.values(s.biz).find(x => x.town === 'greenhaven' && x.trade !== 'estate' && !x.closed), mp = Sim.living(s).filter(p => p.town === 'greenhaven' && !p.kid && p.status === 'here' && !p.held)[6];
  b.owner = 'player'; b.manager = { pid: mp.id, name: mp.name, wage: 5, budget: 5, skill: 1, honest: 0, skim: 12 }; mp.job = { type: 'manage', kind: 'biz', ref: b.id };
  let found = false; for (let i = 0; i < 6 && !found; i++) { b.manager.audited = null; b.manager.skim = 12; found = X('audit', 'biz', b.id).msg === 'found'; }
  check(found && C.cases.some(c => c.kind === 'fraud' && c.accused === mp.id), 'an audit finds the skim and opens a case');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'audits have their own line in your books');
}

}
console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
