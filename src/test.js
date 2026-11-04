// Headless tests for the Hearthmoor simulation. Run: node test.js
const Sim = require('./sim.js');
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
  check(v.council && v.landGranted && v.chest >= 30 && v.step === 6, 'seated on the council with a chest and a land grant');
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
  Sim.cmd(s, 'settle', 2);
  check(v.dispute == null && s.rec.disputesSettled === 1, 'settled the dispute');
  Sim.step(s, 1);
  check(v.step === 7 && v.letter, 'the lord’s steward sends a letter');
  Sim.cmd(s, 'gate'); runIdle(s, 6000);
  check(v.step === 8, 'met the steward at the manor gate: chapter complete');
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
  check(here.every(p => p.purse >= 0) && here.filter(p => p.home).length >= here.length - 2, 'nobody is in debt, and nearly everyone has a roof');
  check(Object.values(q.biz).filter(b => !b.closed).length >= 3, 'the village shops stay open without you');

  // fired, broke, evicted, gone
  const s = Sim.newGame(78); s.coins = 500; s.trades.bakery = 2;
  Sim.cmd(s, 'open', 1, 'bakery');
  const shop = s.shops[0], ai = s.applicants.findIndex(a => a.local);
  const name = s.applicants[ai].name;
  Sim.cmd(s, 'hire', shop.id, ai);
  const p = Object.values(s.people).find(x => x.name === name);
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

  // buy a business: its staff work for you, and you can fire them
  const b = Sim.newGame(79); b.coins = 1000;
  const price = Sim.bizPrice(b, 'gerd');
  const gerd = Object.values(b.people).find(x => x.name === 'Gerd');
  check(Sim.cmd(b, 'buyBiz', 'gerd').ok && b.biz.gerd.owner === 'player', 'bought Gerd’s Bakehouse for ' + price + 'c');
  check(gerd.job.role === 'hand' && gerd.home !== 'biz:gerd', 'Gerd stays on as your manager and has to move out of the rooms above the shop');
  const osric = Object.values(b.people).find(x => x.name === 'Osric');
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
  const br = Object.values(e.people).find(x => x.name === 'Brannoch');
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

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
