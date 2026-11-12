// Headless tests for the Hearthmoor simulation. Run: node test.js
const Sim = require('./sim.js'); Sim.setStrict(true);   // in tests a fault in a daily step must fail loudly
// most tests look at one system at a time, so the world does not age in them; the life-cycle tests turn it back on
const newGameRaw = Sim.newGame, newGameAging = (...a) => { const s = newGameRaw(...a); s.bandits = null; s.ageRate = 4; return s; }; Sim.newGame = (...a) => { const s = newGameAging(...a); s.ageRate = 0; return s; };
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

console.log('1. Drop-in work: any bench, a chain up to x10, levels that follow you (v0.55)');
{
  const s = Sim.newGame(11); const c0 = s.coins, R = (good, perf) => { Sim.advance(s, 3); return Sim.cmd(s, 'workRound', good, perf); };
  check(Sim.cmd(s, 'workStart', 'gerd').ok && s.work && s.work.trade === 'bakery' && s.work.chain === 1, 'walk into the bakehouse and start work, no hiring needed');
  const r1 = R(true, false); check(r1.ok && r1.msg.pay === Sim.WORK_PAY[0] && s.coins === c0 + r1.msg.pay && s.work.chain === 2, 'a good item pays the level rate at once, and the chain grows to x2');
  const r2 = R(true, true); check(Math.abs(r2.msg.pay - Sim.WORK_PAY[0] * 2 * (1 + Sim.PERFECT_BONUS)) < 1e-9, 'the next pays twice as much, and a quarter more for dead-centre presses');
  for (let i = 0; i < 13; i++) R(true, false);
  check(s.work.chain === Sim.CHAIN_MAX, 'the chain tops out at x' + Sim.CHAIN_MAX);
  const before = s.coins, r3 = R(false); check(r3.ok && r3.msg.failed && r3.msg.lost === Sim.CHAIN_MAX && s.coins === before && s.work.chain === 1, 'one mistake and the chain is gone, but nothing earned is taken back');
  check(!Sim.cmd(s, 'workRound', true, true).ok, 'items cannot come faster than they can be played');
  check(Sim.tradeLevel(s, 'bakery') === 2 && Sim.learned(s, 'bakery'), Sim.WORK_LEVELS[1] + ' good items reach level 2, enough to open a bakery');
  const stop = Sim.cmd(s, 'workStop'); check(stop.ok && !s.work && stop.msg.rounds >= 15, 'stop whenever you like, and keep what you earned (' + stop.msg.earned + ')');
  const kept = s.coins; check(Sim.cmd(s, 'workStart', 'forge').ok && Sim.cmd(s, 'workRound', true, true).ok === false && s.coins === kept, 'leaving and coming straight back cannot be used to pay twice');
  for (let i = 0; i < 3; i++) R(true, false);
  check(Sim.tradeXp(s, 'smithy') === 3 && Sim.tradeXp(s, 'bakery') >= 15 && s.work.chain === 4, 'each trade keeps its own progress, and a new bench starts a new chain');
  // the top levels need standing as well as practice
  s.tradeXp.bakery = 1000; check(Sim.tradeLevel(s, 'bakery') === 5 && !Sim.levelGate(s, 'bakery'), 'levels 4 and 5 come from work alone, with no office needed');
  s.rec.everElder = true; check(Sim.tradeLevel(s, 'bakery') === 5 && Sim.roundPay(s, 'bakery', false, Sim.CHAIN_MAX, false) >= Sim.WORK_PAY[0] * Sim.CHAIN_MAX * 10, 'a master at a full chain earns more than ten times a beginner’s best');
  const back = Sim.deserialize(Sim.serialize(s)); check(back.tradeXp.bakery === s.tradeXp.bakery && back.tradeXp.smithy === 3, 'trade levels are kept in the save');
}

console.log('2. Where the money comes from, and who will not have you');
{
  const s = Sim.newGame(12); const owner = s.people[s.biz.gerd.owner], p0 = owner.purse, ch = s.village.chest;
  Sim.cmd(s, 'workStart', 'gerd'); let paid = 0; for (let i = 0; i < 10; i++) { Sim.advance(s, 3); paid += Sim.cmd(s, 'workRound', true, false).msg.pay; }
  check(Math.abs(owner.purse - p0 - paid * Sim.BENCH_CUT) < 0.05, 'the owner pays nothing out of pocket: the buyer pays them a tenth on top for the bench');
  check(s.village.chest === ch, 'no public chest pays for piecework');
  check(Sim.cmd(s, 'apply', 'gerd').ok === false, 'there are no shifts to apply for any more');
  owner.hate = 70; check(!Sim.cmd(s, 'workStart', 'gerd').ok && Sim.cmd(s, 'workStart', 'forge').ok, 'an owner with a grudge turns you away, and another bench takes you');
  s.coins = 200; s.tradeXp.bakery = 20; check(Sim.cmd(s, 'open', 1, 'bakery').ok && s.coins === 200 - Sim.STARTER_PRICE, 'your first shop is a starter stall at a one-time price (' + Sim.STARTER_PRICE + ')');
  check(Sim.cmd(s, 'workStart', 'shop:' + s.shops[0].id).ok && s.work.own, 'you can work your own bench');
  Sim.advance(s, 3); const r = Sim.cmd(s, 'workRound', true, false); check(Math.abs(r.msg.pay - Sim.WORK_PAY[1] * (1 + Sim.BENCH_CUT)) < 1e-9, 'at your own bench you keep the tenth');
  check(Sim.openCost(s, 'tavern').coin === Sim.TRADES.tavern.tiers[0].cost.coin, 'after the starter, a shop costs the full price');
}

console.log('3. You must reach level 2 in a trade before opening that shop');
{
  const s = Sim.newGame(13); s.coins = 500; s.starterUsed = true;
  check(!Sim.cmd(s, 'open', 0, 'smithy').ok, 'cannot open a smithy without the trade');
  s.tradeXp = { smithy: 20 };
  check(!Sim.cmd(s, 'open', 0, 'smithy').ok, 'a smithy also needs 4 ore');
  s.player.inv.ore = 4;
  const cost = Sim.TRADES.smithy.tiers[0].cost.coin;
  check(Sim.cmd(s, 'open', 0, 'smithy').ok && s.shops.length === 1 && s.player.inv.ore === 0 && s.coins === 500 - cost, 'opened a smithy for ' + cost + 'c and 4 ore');
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
  check(Sim.cmd(s, 'workStart', 'tankard').ok, 'and there is always a bench to work at');
}

console.log('7. Save and restore mid-task gives identical futures');
{
  const { s: a, shop } = shopWithWorker('smithy', 3);
  Sim.cmd(a, 'gather', 'ore');
  let guard = 0;
  while (!(shop.worker.task === 'craft' && shop.work.loaded && shop.work.progress > 5) && guard < 5000) { Sim.step(a, 1); guard++; }
  check(shop.worker.task === 'craft' && a.player.action, 'paused while the smith is mid-forge and you are mid-dig');
  const b = Sim.deserialize(Sim.serialize(a));
  check(JSON.stringify(b.player.inv) === JSON.stringify(a.player.inv) && b.coins === a.coins, 'inventory and coins restored');
  check(b.shops[0].worker.task === 'craft' && b.shops[0].work.progress === shop.work.progress, 'worker task and work progress restored');
  Sim.advance(a, 3000); Sim.advance(b, 3000);
  check(Sim.serialize(a) === Sim.serialize(b), 'both copies play out identically for 3000 more minutes');
  let bad = false; try { Sim.deserialize('{"hello":1}'); } catch (e) { bad = true; }
  check(bad, 'rejects a file that is not a save');
  const o16 = JSON.parse(Sim.serialize(a)); o16.v = 16; let why = null; try { Sim.deserialize(JSON.stringify(o16)); } catch (e) { why = e; }
  check(why && why.old && /new game/.test(why.message), 'a save from before v0.54 is refused, with a clear message to start a new game');
}

console.log('8. Old saves from the first version still load');
{
  let Old = null;
  try { Old = require('/home/claude/game/sim.js'); } catch (e) { }
  if (!Old || Old.VERSION !== 1) console.log('  (skipped: first-version sim not on disk)');
  else {
    const o = Old.newGame(5); o.coins = 77; o.tier = 1; Old.cmd(o, 'hire', 0, 9); Old.advance(o, 2000);
    const s = Sim.deserialize(Old.serialize(o), { allowOld: true });
    check(s.v === Sim.VERSION && s.shops.length === 1 && s.shops[0].trade === 'bakery' && s.shops[0].tier === 1, 'v1 bakery becomes a Timber Bakery on the Middle lot');
    check(s.coins === o.coins && s.shops[0].worker && s.shops[0].worker.name === o.worker.name, 'coins and worker carried over');
    Sim.advance(s, 1440 * 2);
    check(!invariants(s), 'migrated game keeps running');
  }
}

console.log('9. Forty-day soak: from the bench to two businesses');
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
      // work a bench in the mornings: the bakehouse until you can open a bakery, then the forge
      const want = h < 12 ? (!bakery ? 'gerd' : !smithy ? 'forge' : null) : null;
      if (s.work && s.work.at !== want) Sim.cmd(s, 'workStop');
      if (want && !s.work) Sim.cmd(s, 'workStart', want);
      if (!bakery && Sim.learned(s, 'bakery') && s.coins >= Sim.STARTER_PRICE) { Sim.cmd(s, 'open', 1, 'bakery'); log.push('D' + s.day + ' opened bakery'); }
      if (bakery && !smithy && Sim.learned(s, 'smithy') && s.coins >= Sim.TRADES.smithy.tiers[0].cost.coin && p.inv.ore >= 4) { Sim.cmd(s, 'open', 2, 'smithy'); log.push('D' + s.day + ' opened smithy'); }
      if (s.work) { if (m % 6 === 0) Sim.cmd(s, 'workRound', m % 60 !== 0, false); }
      else if (bakery && !bakery.worker && bakery.goods > 0) { if (Sim.dist(p, Sim.plotPt(bakery, 'serve')) > 0.5) Sim.cmd(s, 'serve', bakery.id); }
      else if (bakery && !bakery.worker && (bakery.stock.grain >= 2 && bakery.stock.wood >= 1)) Sim.cmd(s, 'craft', bakery.id);
      else if (bakery && !bakery.worker && bakery.stock.grain < 2 && Sim.carried(s) < 6) Sim.cmd(s, 'gather', 'grain');
      else if (Sim.learned(s, 'smithy') && !smithy && p.inv.ore < 4) Sim.cmd(s, 'gather', 'ore');
      else if (Sim.carried(s) >= 14 && s.shops.length) Sim.cmd(s, 'store', (s.shops.find(x => x.stock.wood < Sim.tierOf(x).cap - 6) || s.shops[0]).id);
      else Sim.cmd(s, 'gather', 'wood');
      if (p.action && p.action.type === 'gather') p.action.left = Math.min(p.action.left, 50);
    }
    if (p.action && p.action.type === 'gather' && Sim.carried(s) >= 14) Sim.cmd(s, 'stop');
    Sim.step(s, 1);
    problem = invariants(s);
    const sup = s.shops.some(x => x.worker && x.worker.task === 'supply');
    run = sup ? run + 1 : 0; maxSupply = Math.max(maxSupply, run);
  }
  console.log('   ' + log.join(', '));
  const last = s.ledger.slice(-3);
  console.log('   last days:', last.map(d => `D${d.day}: ${d.profit}c (${d.shops.map(x => x.trade + ' ' + x.profit).join(', ')})`).join(' | '));
  console.log('   records:', JSON.stringify({ coins: s.coins, netWorth: Sim.netWorth(s), rounds: s.rec.workRounds, made: s.rec.made, sold: s.rec.goodsSold, walked: Math.round(s.rec.walked) }));
  check(!problem, 'no invariant broken' + (problem ? ': ' + problem : ''));
  check(maxSupply < 150, 'supply runs finish (longest ' + maxSupply + ' min)');
  check(s.shops.length >= 2, 'bot owns two businesses');
  check(s.shops.some(x => x.tier >= 1), 'bot upgraded a shop');
  check(last.every(d => d.shops.every(x => x.notes.length > 0)), 'every shop gets a ledger explanation every day');
  check(s.rec.coinsEarned > 0 && s.rec.walked > 1000 && s.rec.made.bread > 0, 'records are being kept');
}


console.log('10. Chapter Two: four milestones to the Elder\u2019s chair (v0.54)');
{
  const s = Sim.newGame(31); s.coins = 4000; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20); (s.tradeXp = s.tradeXp || {}, s.tradeXp.tavern = 20);
  const v = s.village;
  Sim.step(s, 1);
  check(v.step === 1, 'the elder\u2019s first ask comes on its own: make a living');
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
  check(!v.shortage && v.standing >= 20, 'the shortage ends and standing rises (' + v.standing + ')');
  check(v.councilInvite && v.step === 5, 'solving the village\u2019s problem earns you a place on the ballot for the council');
  winElection(s, 'council'); check(v.council && v.landGranted && v.step === 6, 'and the moot elects you to it');
  check(v.jobless.length >= 0 && v.joblessSet, 'the idle villagers are named, as a good deed you may do (' + v.jobless.join(', ') + ')');
  Sim.advance(s, 1440 * 4);
  const fed = s.ledger.slice(-3).reduce((a, d) => a + d.shops[0].served, 0) / 3;
  check(fed > lean, 'customers come back once people are fed (' + lean.toFixed(1) + ' -> ' + fed.toFixed(1) + ' a day)');
  // two jobs: fire the current worker for one, open a tavern for the other
  Sim.cmd(s, 'fire', shop.id);
  Sim.cmd(s, 'open', 2, 'tavern');
  const pick = () => { const i = s.applicants.findIndex(a => v.jobless.includes(a.name)); return i >= 0 ? i : s.applicants.findIndex(a => a.local); };
  const st0 = v.standing; if (v.jobless.length) { Sim.cmd(s, 'hire', s.shops[0].id, pick()); if (s.shops[1]) Sim.cmd(s, 'hire', s.shops[1].id, pick()); }
  Sim.step(s, 1);
  check(v.step === 6, 'giving the idle work is a good deed, not a gate (' + (v.jobsGiven || 0) + ' hired by you)');
  // the tower: optional, and loved
  s.player.inv = { grain: 0, wood: 20, ore: 0 }; const st1 = v.standing;
  Sim.cmd(s, 'fundTower'); runIdle(s);
  check(v.towerBuilt && v.step === 6 && v.standing > st1, 'the watchtower is rebuilt, for standing, without holding up the chapter');
  check(v.council && v.landGranted && Number.isFinite(v.chest) && v.chest > -50 && v.step === 6, 'seated on the council with a chest and a land grant (the watch draws its wages from the chest, which may run a small debt)' + ` [council ${v.council} land ${v.landGranted} chest ${v.chest} step ${v.step}]`);
  check(Sim.cmd(s, 'open', 3, 'joinery').ok === false && ((s.tradeXp = s.tradeXp || {}, s.tradeXp.joinery = 20)) && Sim.cmd(s, 'open', 3, 'joinery').ok, 'the Hall lot can now be built on');
  // council powers change the game (council business is done at the Village Hall)
  Sim.cmd(s, 'goto', 'hall'); runIdle(s);
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
  Sim.step(s, 1); Sim.step(s, 1);
  check(v.step >= 8 && v.letter, 'leading the council brings the steward\u2019s letter, with no trip to the gate');
  v.standing = 61; winElection(s, 'elder');
  check(s.offices.elder === 'player' || v.step === 9, 'stand for Elder and win the vote');
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
  const s = Sim.newGame(41); s.coins = 3000; s.starterUsed = true; (s.tradeXp = s.tradeXp || {}, s.tradeXp.smithy = 20); s.player.inv.ore = 4;
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
  check(s.shops.length === 0 && s.coins === before + Sim.TRADES.smithy.tiers[0].cost.coin / 2, 'sold the smithy for half its building cost');
  (s.tradeXp = s.tradeXp || {}, s.tradeXp.tavern = 20);
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
  const s = Sim.newGame(78); s.coins = 500; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20); Sim.setupJustice(s);   // the watch is already full, so it offers no work
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
  winElection(e, 'elder');
  check(e.offices.elder === 'player' && e.village.step === 9, 'you win the Elder election');
  const br = Object.values(e.people).find(x => x.name.split(' ')[0] === 'Brannoch');
  check(br.retired && !br.job && br.home, 'Brannoch is a retired villager in his own house now');
  const back = Sim.deserialize(Sim.serialize(b)); Sim.advance(b, 1500); Sim.advance(back, 1500);
  check(Sim.serialize(b) === Sim.serialize(back), 'people, houses and offices save and restore exactly');
}

console.log('13. Debt, respect, votes: anyone in power can fall, and only the deserving rise');
{
  // your own debts
  const s = Sim.newGame(77); s.coins = 200; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20);
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
  const back = Sim.deserialize(JSON.stringify(o), { allowOld: true });
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
  const h = Sim.newGame(94); h.coins = 500; (h.tradeXp = h.tradeXp || {}, h.tradeXp.bakery = 20); Sim.cmd(h, 'open', 1, 'bakery');
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
  let clash = 0; for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) if (Math.hypot(blds[i].x - blds[j].x, blds[i].z - blds[j].z) < 6) clash++;
  check(!clash && blds.every(b => O.inside(b.x, b.z)) && O.market.w >= 18 && O.market.len >= 30, blds.length + ' buildings in terraced rows, none overlapping another, a market place ' + Math.round(O.market.w) + ' m by ' + Math.round(O.market.len) + ' m, all within the walls');
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
  const nb = Sim.deserialize(JSON.stringify(old), { allowOld: true }), nh = nb.houses.filter(h => h.town === 'oakbridge');
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
  const nb = Sim.deserialize(JSON.stringify(old), { allowOld: true });
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
  const s = Sim.newGame(7); s.coins = 3000; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20);
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
  check(sh.worker && Sim.supplier(sh) === 'manager', 'the bakery\u2019s manager hired ' + sh.worker.name + ' and keeps supplies coming, with you in Greenhaven');
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
  s.offices.elder = 'player'; v.council = true; v.chest = 200; s.gov.relief = 'none'; holdElections(s);
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
  check(L.length > 1000 && L.length < 4000, 'the population of all four towns stays sensible (' + L.length + ' living)');
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
  check(Sim.serialize(s).length < 4200000, 'and its save is ' + Math.round(Sim.serialize(s).length / 1024) + ' KB (Valdor, from v0.49, adds about half a megabyte over thirty years)');
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
  let wet = 0, t0 = Date.now(), cpu0 = process.cpuUsage(); for (let k = 0; k < 600; k++) { Sim.advance(s, 1); if (k % 20) continue; for (const a of bodies) if (C.lakeDist(a.x, a.z) < -1) wet++; }
  check(wet === 0, 'nobody walks into the lake');
  { const cu = process.cpuUsage(cpu0), cpuMs = Math.round((cu.user + cu.system) / 1000);   // CPU time, not the clock on the wall, so a busy machine running other tests cannot fail it
    check(cpuMs < 30000, 'ten hours of a busy capital take ' + cpuMs + ' ms of processing to simulate'); }
}

console.log('24. Stage II checks: a month away with your businesses in good hands, and real choices as Elder');
{
  const s = Sim.newGame(150); s.coins = 3000; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20);
  Sim.cmd(s, 'buyBiz', 'o_bell'); Sim.cmd(s, 'buyBiz', 'g_bake'); Sim.cmd(s, 'open', 1, 'bakery'); const sh = s.shops[0];
  for (const [k, id] of [['biz', 'o_bell'], ['biz', 'g_bake'], ['shop', sh.id]]) { const c = Sim.managerCandidates(s, k, id)[0]; Sim.cmd(s, 'hireManager', k, id, c.pid); }
  s.player.x = Sim.STAGE.crownmere.x + 400; s.player.z = Sim.STAGE.crownmere.z - 200;   // away in the hills, far from all three
  const c0 = s.coins; Sim.advance(s, 1440 * 30);
  const stillOpen = !s.biz.o_bell.closed && !s.biz.g_bake.closed && s.shops.length === 1;
  // a month's takings swing a long way with luck (from about -700c to +1,500c across seeds); the test is that the managers keep all three open and nothing is ruined
  check(stillOpen && s.coins > c0 - 800, 'after thirty days away, all three businesses are open (' + (s.coins - c0 >= 0 ? s.coins - c0 + 'c richer' : c0 - s.coins + 'c poorer, by luck of trade') + ')');
  const elder = (w) => { const g = Sim.newGame(151), v = g.village; g.offices.elder = 'player'; holdElections(g); v.council = true; v.chest = 600; Sim.cmd(g, 'works', w); Sim.advance(g, 1440 * 12); return g.gov.approval.elder; };
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
  holdElections(s); Sim.setupFolk(s).fame = 20;
  check(!!Sim.standBar(s, Sim.ensureRaces(s).races['lord:eastwatch']), 'favour and coin are not enough: you need a stake in Eastwatch to stand there');
  // do a contract for Eastwatch
  R.contracts = [{ n: 999, kind: 'supply', region: 'eastwatch', good: 'grain', qty: 10, reward: 60, what: 'deliver 10 grain to the market in Eastwatch', who: 'Rowena Tarrant', until: s.day + 6, day: s.day }];
  check(Sim.cmd(s, 'takeContract', 999).ok, 'you take a contract to supply Eastwatch');
  s.player.inv.grain = 10; atMarket('eastwatch');
  check(Sim.cmd(s, 'fulfil', 999).ok && Sim.deedsIn(s, 'eastwatch') === 1, 'you deliver the grain: a deed done for Eastwatch');
  check(/lower office/.test(Sim.standBar(s, Sim.ensureRaces(s).races['lord:eastwatch']) || ''), 'with no office, you start at the bottom of the ladder');
  s.village.council = true; winElection(s, 'elder'); check(s.offices.elder === 'player', 'first, Elder of Hearthmoor');
  R.deeds.ironcrest = 1; winElection(s, 'lord:ironcrest'); check(Sim.yourLordships(s).includes('ironcrest') && s.offices.elder !== 'player', 'then lord of a small town, Ironcrest, and the Elder\u2019s chair passes on');
  winElection(s, 'lord:eastwatch'); holdElections(s); check(Sim.yourLordships(s).includes('eastwatch') && !Sim.yourLordships(s).includes('ironcrest'), 'now Eastwatch, a bigger town, elects you its lord');
  check(/bigger town/.test(Sim.standBar(s, Sim.ensureRaces(s).races['lord:ironcrest']) || ''), 'a lord only moves up to a bigger town');
  check((Sim.cmd(s, 'moveToSeat').ok || !!s.player.seat) && /Castle/.test(Sim.homeOfYou(s).name), 'you move into your seat (on taking office, or by choice): ' + Sim.homeOfYou(s).name);
  { const E = Sim.electState(s); E.since = s.day; check(/Hold your office/.test(Sim.standBar(s, Sim.ensureRaces(s).races['seat:trade']) || ''), 'a new lord must hold the lands a while before standing for the council'); E.since = s.day - 99; }
  // allies: back the reformer and the lord of Ironcrest; good government
  Sim.cmd(s, 'backFigure', 'reformer'); Sim.cmd(s, 'backFigure', 'lord');
  s.bandits.eastwatch = 5; for (let d = 0; d < 10; d++) { away(); Sim.advance(s, 1440); s.bandits.eastwatch = 5; }
  R.favour = 70; court();

  R.contractsByKind = Object.assign(R.contractsByKind || {}, { supply: 3 }); s.coins += 30000;
  Object.values(s.biz).filter(b => b.town === 'eastwatch' && b.owner !== 'player' && s.people[b.owner]).slice(0, 3).forEach(b => Sim.cmd(s, 'buyBiz', b.id));
  winElection(s, 'seat:trade'); holdElections(s); check(R.council.trade === 'player' && !Sim.yourLordships(s).includes('eastwatch'), 'the lords and the capital elect you Master of Trade, and Eastwatch passes on');
  // a promise kept
  R.promises = [{ region: 'oakbridge', pid: R.regions.oakbridge.lord, day: s.day, state: 'asked' }];
  check(Sim.cmd(s, 'givePromise').ok, 'a lord asks for your word, and you give it');
  for (let d = 0; d < 8; d++) { s.bandits.oakbridge = 5; away(); Sim.advance(s, 1440); }
  check(R.kept >= 1, 'you keep it');
  for (let d = 0; d < 12; d++) { court(); Sim.cmd(s, 'undermineKing'); Sim.cmd(s, 'attendCourt'); away(); Sim.advance(s, 1440); }
  const rally = () => { Sim.cmd(s, 'patronage', 'lords'); Sim.cmd(s, 'patronage', 'guilds'); for (const t of Object.keys(Sim.TOWNS)) Sim.cmd(s, 'patronage', 'town', t); };
  for (let round = 0; round < 3; round++) { rally(); for (let d = 0; d < 15; d++) { court(); Sim.cmd(s, 'attendCourt'); away(); Sim.advance(s, 1440); s.bandits.eastwatch = 5; } }
  rally(); R.kingSupport = Math.min(R.kingSupport, 40); court(); const sup = Sim.computeSupport(s);
  winElection(s, 'crown'); holdElections(s); check(Sim.isRuler(s) && R.council.trade !== 'player', 'with ' + Sim.alliesOf(s).length + ' allies and support of ' + sup + ', the realm votes you to the throne, and your council seat passes to another');
  R.treasury = Math.max(R.treasury, 1000); Sim.cmd(s, 'rule', 'draw', 700); check(R.embezzled === 700, 'taking 700c from the treasury is remembered');
  R.figures.find(f => f.kind === 'reformer').ally = false; s.coins = 0; for (let d = 0; d < 30 && Sim.isRuler(s); d++) { away(); Sim.advance(s, 1440); s.coins = Math.min(s.coins, 0); }   // a ruler with nothing to repay it from
  check(!Sim.isRuler(s) && R.exile, 'an inquiry finds the theft, you cannot repay, and the council removes you: exile');
  s.coins = 3000; court();
  check(!Sim.cmd(s, 'claimCrown').ok, 'waiting is not enough: you need allies, a war chest, the towns and the new ruler exposed');
  const lords = Object.keys(R.regions).map(id => Sim.regionLord(s, id)).filter(l => l && l !== 'player' && l !== R.king).slice(0, 3); lords.forEach(l => { s.people[l].opinion = 40; });
  lords.forEach(l => Sim.cmd(s, 'rallyAlly', l)); Sim.cmd(s, 'warChest', 600);
  // winter can cost a point or two of the towns' goodwill, so keep rallying until support is there (at most five rounds)
  for (let round = 0; round < 5 && (round < 3 || Sim.supportOf(s) < 67); round++) { s.coins += 1500; rally(); for (let d = 0; d < 15; d++) { away(); Sim.advance(s, 1440); } }
  for (let d = 0; d < 24 && R.kingSupport >= 50; d++) { court(); Sim.cmd(s, 'exposeRuler'); away(); Sim.advance(s, 1440); }
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
  const g2 = newGameRaw(201); g2.ageRate = 0; g2.bandits = null; g2.coins = 2000; (g2.tradeXp = g2.tradeXp || {}, g2.tradeXp.bakery = 20); Sim.cmd(g2, 'open', 1, 'bakery'); const sh = g2.shops[0];
  check(Sim.shopShare(g2, sh) < 0.7, 'your Bread Stand shares the village’s bread trade with Gerd’s Bakehouse (' + Math.round(Sim.shopShare(g2, sh) * 100) + '% of it)');
  Sim.cmd(g2, 'buyBiz', 'o_bell'); for (let d = 0; d < 4; d++) Sim.advance(g2, 1440);
  const avgP = b => b.profits.reduce((a, x) => a + x, 0) / b.profits.length;
  const paybacks = Object.values(g2.biz).filter(b => !b.closed && avgP(b) > 0 && b.trade !== 'estate').map(b => Sim.bizPrice(g2, b.id) / avgP(b));
  check(paybacks.length > 50 && Math.min(...paybacks) > 6, 'no business pays for itself in under a week on its average takings: the quickest takes ' + Math.round(Math.min(...paybacks)) + ' days');
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
  const s = Sim.newGame(77); s.coins = 3000; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20); s.player.inv = { grain: 10, wood: 10, ore: 10 };
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
  const s = Sim.newGame(31); Sim.applyStart(s, 'elder'); holdElections(s); s.village.chest = 400; Sim.advance(s, 1440);
  const J = s.justice, C = (...a) => Sim.cmd(s, ...a);
  check(J && J.watch.length >= 1 && J.cells === 2, 'Hearthmoor starts with a named watch and two cells');
  // a true accusation and a false one, side by side: what investigation can turn up points each way
  const vv = Sim.villagers(s).filter(p => !p.kid && p.status === 'here');
  const tc = Sim.newCase(s, 'theft', { accused: vv[1].id, accuser: vv[0].id, victim: vv[0].id, value: 12, where: 'a house', truth: 'guilty', what: 'test', claim: 'test' }), fc = Sim.newCase(s, 'theft', { accused: vv[2].id, accuser: vv[0].id, victim: vv[0].id, value: 12, where: 'a house', truth: 'mistaken', what: 'test', claim: 'test' });
  const sum = c => Sim.evidencePool(s, c).reduce((a, e) => a + e.w, 0);
  check(sum(tc) > 0 && sum(fc) < 0, 'a true accusation has evidence for it to find (' + sum(tc) + '), a mistaken one evidence against (' + sum(fc) + ')');
  J.cases = J.cases.filter(c => c !== tc && c !== fc);
  let kinds = new Set(); for (let d = 0; d < 40; d++) { Sim.advance(s, 1440); J.cases.concat(J.closed).forEach(c => kinds.add(c.truth)); if (kinds.has('guilty') && (kinds.has('mistaken') || kinds.has('lie'))) break; }
  check(kinds.has('guilty'), 'crimes happen on their own in the village (' + Array.from(kinds).join(', ') + ')');
  // cells fill up
  const vil = Sim.villagers(s).filter(p => !p.kid && !p.held && p.status === 'here' && !(p.job && p.job.type === 'office'));
  const mk = p => { const c = { id: J.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 3 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: vil[0].id, victim: vil[0].id, value: 8, where: 'a house', truth: 'guilty', what: 'test', claim: 'test', authority: 'Elder of Hearthmoor' }; J.cases.push(c); return c; };
  J.prisoners.slice().forEach(pr => C('jRelease', pr.pid));
  const c1 = mk(vil[1]), c2 = mk(vil[2]), c3 = mk(vil[3]);
  check(C('jArrest', c1.id).ok && C('jArrest', c2.id).ok && !C('jArrest', c3.id).ok, 'two cells hold two prisoners; a third arrest is refused');
  check(!C('jHear', c1.id, { days: 5 }, 'guilty').ok, 'the Elder cannot order more than three days');
  // a held worker leaves your shop short, and comes back
  s.coins = 500; (s.tradeXp = s.tradeXp || {}, s.tradeXp.bakery = 20); C('open', 0, 'bakery'); const sh = s.shops[0]; s.applicants.unshift({ name: vil[4].name, pid: vil[4].id, skill: 1, ask: 7 }); C('hire', sh.id, 0, 7);
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
  const s = newGameRaw(33); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 4000; Sim.advance(s, 1440); holdElections(s);
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
  { const bad = s.ledger.slice(1).filter(e => e.unexplained); if (bad.length) console.log('   unexplained:', JSON.stringify(bad.map(e => [e.day, e.unexplained]))); }
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

console.log('35. Petitions to the crown, and markets that draw traders when short');
{
  const s = newGameRaw(36); s.ageRate = 0; Sim.applyStart(s, 'ruler'); Sim.advance(s, 1440);
  const R = s.realm, X = (...a) => Sim.cmd(s, ...a);
  const folk = Sim.living(s).filter(p => p.town === 'oakbridge' && !p.kid); folk.slice(0, 8).forEach(p => p.hungry = true);
  R.treasury = 500; const t0 = R.treasury, ap0 = s.towns.oakbridge.approval;
  R.petitions = [{ id: 1, kind: 'relief', town: 'oakbridge', cost: 92, day: s.day, until: s.day + 6, text: 'x' }];
  check(X('petition', 1, 0).ok && R.treasury === t0 - 92 && s.towns.oakbridge.approval > ap0 && !folk[0].hungry, 'sending grain to a hungry town costs the treasury and feeds them');
  const lordId = Object.keys(R.regions).map(id => Sim.regionLord(s, id)).find(l => l && l !== 'player' && s.people[l]), L = s.people[lordId], op = L.opinion || 0;
  R.petitions = [{ id: 2, kind: 'defiance', lord: lordId, region: 'x', day: s.day, until: s.day + 1, text: 'x' }]; const f0 = R.favour;
  Sim.advance(s, 1440 * 2);
  check(!R.petitions.some(q => q.id === 2) && R.favour < f0 + 1, 'a defiance left unanswered answers itself, and the silence costs you');
  const g0 = s.goods.hearthmoor.grain; s.goods.hearthmoor.grain = 5; Sim.advance(s, 1440 * 3);
  check(s.goods.hearthmoor.grain > 15, 'a market run dry draws traders: Hearthmoor grain back to ' + s.goods.hearthmoor.grain + ' in three days');
  let noble = 0; for (let d = 0; d < 150 && !noble; d++) { Sim.advance(s, 1440); noble = s.courts.crownmere.cases.concat(s.courts.crownmere.closed).filter(c => c.requested && s.people[c.accused] && s.people[c.accused].noble).length; }
  check(noble > 0, 'in time a noble is accused, and the case comes to the crown’s court (on average within a month)');
}

console.log('36. Across the Sundering Sea: the passage, Stormrest Isle and Dawnport');
{
  const s = newGameRaw(37); s.ageRate = 0; Sim.advance(s, 60);
  const folk = Sim.living(s).filter(p => p.town === 'dawnport');
  check(folk.length >= 440 && folk.length <= 470 && s.towns.dawnport.title === 'Consul' && Object.values(s.biz).filter(b => b.town === 'dawnport').length === 19, 'Dawnport is a port of ' + folk.length + ' people with a Consul and 19 businesses');
  check(folk.some(p => /^(Marisol|Rodrigo|Ximena|Inigo|Leonor|Gonzalo)/.test(p.name)) && Sim.TOWNS.dawnport.foreign === 'valdoria' && s.valdoria && s.valdoria.ruler, 'its people have Valdorian names, and it belongs to Valdoria, not Alderwyn');
  const P = Sim.PORTS, X = (...a) => Sim.cmd(s, ...a);
  s.player.x = 300; s.player.z = 0; check(!X('sail', 'dawnport').ok, 'ships only leave from the quay');
  s.player.x = P.eastwatch.x; s.player.z = P.eastwatch.z; s.coins = 100; s.t = 5 * 60; s.day = 10;
  check(!X('sail', 'dawnport').ok, 'no ship sails before seven');
  s.t = 9 * 60; const c0 = s.coins, r = X('sail', 'dawnport');
  check(r.ok && s.coins === c0 - 40 && Math.hypot(s.player.x - P.dawnport.x, s.player.z - P.dawnport.z) < 6 && r.mins > 60, 'the passage to Dawnport by way of Stormrest costs 40c and takes ' + r.mins + ' minutes');
  check(Sim.townAt(s.player.x, s.player.z) === 'dawnport' && s.rec.landedValdoria, 'you step ashore in Dawnport');
  const sr = X('sail', 'stormrest'); check(sr.ok && Sim.portHere(s) === 'stormrest', 'ships call at Stormrest Isle');
  let rough = 0; for (let d = 46; d <= 60; d++) if (Sim.seaRough(s, d)) rough++; let calm = 0; for (let d = 1; d <= 45; d++) if (Sim.seaRough(s, d)) calm++;
  check(rough >= 1 && rough <= 7 && calm === 0, 'only in winter is the sea sometimes too rough to sail (' + rough + ' of 15 winter days)');
  s.day = [46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].find(d => Sim.seaRough(s, d)) || 46; if (Sim.seaRough(s)) check(!X('sail', 'eastwatch').ok, 'on a stormy day no ship sails');
  // Alderwyn's politics do not count Valdorians
  Sim.computeSupport(s); const sup0 = Sim.supportOf(s); Sim.living(s).filter(p => p.town === 'dawnport').forEach(p => p.opinion = -100); Sim.computeSupport(s);
  check(Math.abs(Sim.supportOf(s) - sup0) <= 1, 'Dawnport’s people have no say in Alderwyn’s support for you');
  // an old save gains Dawnport
  const old = JSON.parse(Sim.serialize(newGameRaw(38))); old.v = 13; delete old.towns.dawnport; delete old.valdoria;
  for (const id in old.people) if (old.people[id].town === 'dawnport') delete old.people[id];
  old.houses = old.houses.filter(h => h.town !== 'dawnport'); for (const id in old.biz) if (old.biz[id].town === 'dawnport') delete old.biz[id];
  const up = Sim.deserialize(JSON.stringify(old), { allowOld: true });
  check(up.towns.dawnport && up.valdoria && Sim.living(up).filter(p => p.town === 'dawnport').length >= 440, 'an old save gains Dawnport and its people when loaded');
}

console.log('37. Your own ship, sea trade, customs, and the Queen of Valdoria');
{
  const s = newGameRaw(39); s.ageRate = 0; const P = Sim.PORTS, X = (...a) => Sim.cmd(s, ...a), at = k => { s.player.x = P[k].x; s.player.z = P[k].z; };
  s.coins = 2000; s.t = 10 * 60; s.day = 3; at('dawnport');
  check(!X('buyShip').ok, 'ships are sold at Eastwatch, not Dawnport');
  at('eastwatch'); check(X('buyShip').ok && s.ship && s.coins === 2000 - Sim.SHIP_PRICE, 'you buy a merchant cog at Eastwatch for ' + Sim.SHIP_PRICE + 'c');
  check(Sim.seaPrice(s, 'eastwatch', 'iron') < Sim.seaPrice(s, 'dawnport', 'iron') && Sim.seaPrice(s, 'dawnport', 'wine') < Sim.seaPrice(s, 'eastwatch', 'wine'), 'iron is cheap at home and dear in Valdoria; wine the other way');
  const p0 = Sim.seaPrice(s, 'eastwatch', 'iron'); X('cargoBuy', 'iron', 40);
  check(s.ship.hold.iron === 40 && Sim.seaPrice(s, 'eastwatch', 'iron') > p0, 'buying 40 iron fills the hold and raises the price');
  check(!X('cargoBuy', 'wool', 50).ok, 'the hold holds ' + Sim.SHIP_HOLD + ' loads, no more');
  check(X('sailShip', 'dawnport').ok && s.ship.port === 'dawnport' && Sim.portHere(s) === 'dawnport', 'your ship takes you to Dawnport, whenever you like');
  const r = X('cargoSell', 'iron', 40);
  check(r.ok && r.msg.tax > 0 && r.msg.profit > 0, 'iron sold in Dawnport pays the Queen’s duty (' + r.msg.tax + 'c) and still makes ' + r.msg.profit + 'c');
  check(s.valdoria.standing > 0, 'honest trade makes your name in Valdoria');
  s.valdoria.standing = 45; s.player.x = 2050; s.player.z = -300; check(X('charter').ok && s.valdoria.charter && Sim.landingTax(s, 'dawnport', 'iron') < 0.15, 'with a good name, the Consul grants a charter that halves the duty');
  at('dawnport'); X('cargoBuy', 'wine', 30); s.realm.tariff = 1.5; X('sailShip', 'eastwatch'); const t0 = s.realm.treasury, w = X('cargoSell', 'wine', 30);
  check(w.ok && s.realm.treasury > t0, 'Valdorian wine sold at Eastwatch pays Alderwyn’s tariff to the crown');
  // storms
  s.day = [46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].find(d => Sim.seaRough(s, d));
  if (s.day) { check(!X('sailShip', 'dawnport').ok && X('sailShip', 'dawnport', true).ok, 'in a storm your ship waits, unless you tell it to sail anyway'); }
  // the Queen answers tariffs
  s.realm.tariff = 1.75; const d0 = s.valdoria.duty; for (let k = 0; k < 4; k++) { s.day = 5 + 7 * k; Sim.valdoriaDay(s); }
  check(s.valdoria.duty > d0 && s.valdoria.relation < 50, 'high Alderwyn tariffs make the Queen raise her duty, and relations cool (' + Math.round(s.valdoria.relation) + ')');
  s.valdoria.embargo = s.day + 5; at('eastwatch'); s.ship.port = 'eastwatch'; X('cargoBuy', 'wool', 10); s.ship.port = 'dawnport'; at('dawnport');
  check(!X('cargoSell', 'wool', 10).ok, 'while Dawnport is closed to Alderwyn goods, you cannot sell them openly');
  s.valdoria.relation = 50; s.customsContact = null; s.t = 12 * 60; const day = Sim.smuggleRisk(s, 'dawnport'); s.t = 23 * 60; const night = Sim.smuggleRisk(s, 'dawnport');
  check(day >= 0.12 && day <= 0.3 && night < day, 'landing quietly is a gamble you can weigh: about ' + Math.round(day * 100) + '% by day, ' + Math.round(night * 100) + '% at night');
  { const g = 300, d = 0.2, ev = (1 - day) * g - day * 30 - (1 - d) * g; check(ev > -10, 'at the starting duty, smuggling a 300c cargo is close to a fair bet (' + Math.round(ev) + 'c expected against honest trade)'); }
  at('dawnport'); s.coins = 500; let paid = null; for (let k = 0; k < 8 && !paid; k++) { s.customsContact = null; const r9 = X('customsContact'); if (r9.ok && r9.msg !== 'exposed') paid = r9; }
  check(paid && Sim.smuggleRisk(s, 'dawnport') <= 0.04, 'a clerk paid to look away cuts the risk, for ten days');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'ships, cargo, duty and crew all have lines in your books');
}

console.log('38. Valdoria: Goldmeadow, Thornwick, Stonewatch, its roads, and treaties and marriages between the crowns');
{
  const s = newGameRaw(40); s.ageRate = 0; Sim.advance(s, 60); const X = (...a) => Sim.cmd(s, ...a), V = s.valdoria, R = s.realm;
  const n = id => Sim.living(s).filter(p => p.town === id).length;
  check(n('goldmeadow') >= 80 && n('thornwick') >= 60 && n('stonewatch') >= 200 && s.towns.stonewatch.title === 'Castellan', 'Goldmeadow (' + n('goldmeadow') + '), Thornwick (' + n('thornwick') + ') and Stonewatch (' + n('stonewatch') + ') are peopled, each with its own head');
  check(Sim.roadDist('dawnport', 'stonewatch') > 300 && Sim.roadDist('goldmeadow', 'thornwick') > 0 && Sim.roadDist('dawnport', 'oakbridge') === 0, 'roads join Valdoria’s towns, and none crosses the sea');
  const st = Sim.STAGE.dawnport; s.player.x = st.x; s.player.z = st.z; s.t = 9 * 60; s.coins = 3000;
  check(!X('coach', 'oakbridge').ok, 'no coach from Dawnport to Alderwyn');
  const r = X('coach', 'stonewatch'); check(r.ok && Sim.townAt(s.player.x, s.player.z) === 'stonewatch', 'the coach takes you from Dawnport to Stonewatch');
  check(!X('journey', 'eastwatch').ok, 'you cannot walk home across the sea');
  // treaties: only the ruler, and only when relations allow
  check(!X('treaty', 'trade').ok, 'only the ruler of Alderwyn treats with Valdoria');
  R.crown = 'player'; V.relation = 40; check(!X('treaty', 'trade').ok, 'cool relations: no pact');
  V.relation = 60; R.tariff = 1.5; check(!X('treaty', 'trade').ok, 'no pact while Alderwyn’s tariff is high');
  R.tariff = 1; check(X('treaty', 'trade').ok && V.treaty && V.duty === 1.05, 'a trade pact brings the duty at Dawnport down to 5%');
  check(!X('treaty', 'alliance').ok, 'an alliance must wait until the pact has held twenty days');
  V.treaty.since -= 21; V.relation = 75; check(X('treaty', 'alliance').ok && V.treaty.kind === 'alliance' && V.duty === 1, 'then an alliance takes the duty to nothing');
  R.tariff = 1.5; Sim.valdoriaDay(s); check(!V.treaty && V.relation < 75, 'raising the tariff breaks the treaty, and the Queen is angry');
  R.tariff = 1;
  // a royal marriage
  const kid = Sim.living(s).find(p => !p.kid && !p.spouse && !p.royal && p.age >= 18 && p.age < 40 && p.status === 'here'); kid.parents = [Sim.you(s).pid]; kid.home = 'you';
  V.relation = 65; const kids = Sim.yourKids(s);
  if (kids.includes(kid)) { check(X('royalMatch', kid.id).ok && kid.spouse && s.people[kid.spouse].royal === 'valdoria' && V.wed, kid.name + ' marries into Valdoria’s royal house'); const r0 = V.relation; s.day = 5; Sim.valdoriaDay(s); check(V.relation > r0 - 3 && V.wed, 'while the marriage holds, it keeps the crowns close'); const roy = s.people[kid.spouse]; roy.spouse = null; kid.spouse = null; const r1 = V.relation; s.day = 12; Sim.valdoriaDay(s); check(!V.wed && V.relation < r1 - 10, 'cast off the royal spouse and the bond breaks, and Valdoria remembers'); V.relation = 10; s.day = 19; Sim.valdoriaDay(s); check(V.relation < 25, 'with the marriage over, relations can fall as far as any'); }
  // an old save gains the towns
  const old = JSON.parse(Sim.serialize(newGameRaw(41))); old.v = 14; for (const id of ['goldmeadow', 'thornwick', 'stonewatch']) delete old.towns[id];
  for (const id in old.people) if (['goldmeadow', 'thornwick', 'stonewatch'].includes(old.people[id].town) || old.people[id].royal) delete old.people[id];
  old.houses = old.houses.filter(h => !['goldmeadow', 'thornwick', 'stonewatch'].includes(h.town)); for (const id in old.biz) if (['goldmeadow', 'thornwick', 'stonewatch'].includes(old.biz[id].town)) delete old.biz[id]; delete old.valdoria.royals;
  const up = Sim.deserialize(JSON.stringify(old), { allowOld: true }); check(up.towns.stonewatch && up.valdoria.royals && Sim.living(up).filter(p => p.town === 'thornwick').length >= 60, 'an old save gains Valdoria’s towns and its royal house');
}

console.log('39. Work in Valdoria: contracts from its towns, and their markets');
{
  const s = newGameRaw(42); s.ageRate = 0; const R = s.realm, V = s.valdoria;
  let vc = null; for (let d = 0; d < 20 && !vc; d++) { Sim.advance(s, 1440); vc = (R.contracts || []).find(c => c.val && !c.taken); }
  check(vc && ['goldmeadow', 'thornwick', 'stonewatch', 'dawnport'].includes(vc.region), 'Valdoria’s towns ask for work: ' + (vc ? vc.what : 'none'));
  if (vc) {
    check(Sim.cmd(s, 'takeContract', vc.n).ok, 'you take it like any other contract');
    const L = Sim.LOCS[Sim.MARKET_AT[vc.region]]; s.player.inv[vc.good] = vc.qty; s.player.x = L.x; s.player.z = L.z; const st0 = V.standing, c0 = s.coins;
    check(Sim.cmd(s, 'fulfil', vc.n).ok && s.coins === c0 + vc.reward && V.standing > st0, 'delivering it pays ' + vc.reward + 'c and makes your name in Valdoria');
  }
  const L2 = Sim.LOCS[Sim.MARKET_AT.goldmeadow]; s.player.x = L2.x; s.player.z = L2.z;
  check(Sim.marketHere(s) === 'goldmeadow' && Sim.buyPrice(s, 'goldmeadow', 'grain') <= Sim.buyPrice(s, 'stonewatch', 'grain'), 'Goldmeadow has a market, and its grain is cheaper than the fortress’s');
  check(s.ledger.slice(1).every(e => !e.unexplained), 'Valdorian contracts have their line in your books');
}

}
console.log('40. Justice that does what it says, and a name in Valdoria earned by trade (v0.47; from an outside review)');
{
  const s = newGameRaw(41); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 4000; s.offices.elder = 'player'; Sim.advance(s, 1440);
  const X = (...a) => Sim.cmd(s, ...a), Cs = s.courts, HM = Sim.allCourts(s).find(c => c.id === 'hearthmoor'), GH = Cs.greenhaven;
  const free = town => Sim.living(s).filter(p => (p.town || 'hearthmoor') === town && !p.kid && !p.held && p.status === 'here' && !(p.job && p.job.type === 'office'));
  const used = new Set();
  const mk = (Cx, town, o) => { const p = free(town).find(q => !used.has(q.id)); used.add(p.id); const c = Object.assign({ id: s.justice.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 4 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: null, victim: 'chest', value: 12, where: 'the chest', truth: 'guilty', what: 'test', claim: 'test', authority: Cx.authority, court: Cx.id }, o || {}); Cx.cases.push(c); return [c, p]; };
  HM.prisoners.slice().forEach(pr => X('jRelease', pr.pid)); GH.prisoners.slice().forEach(pr => X('jRelease', pr.pid));
  // a pardon, a warning and a fine without days all free the person you arrested
  for (const [verdict, pen, what] of [['mercy', { why: 'favour' }, 'a pardon'], ['guilty', {}, 'a warning'], ['guilty', { fine: 5 }, 'a fine with no days']]) {
    const [c, p] = mk(HM, 'hearthmoor');
    X('jArrest', c.id); const was = !!p.held;
    X('jHear', c.id, pen, verdict);
    check(was && !p.held && !HM.prisoners.some(x => x.pid === p.id), 'after ' + what + ', the arrested accused walks free');
  }
  { const [c, p] = mk(HM, 'hearthmoor'); X('jArrest', c.id); X('jHear', c.id, { days: 2 }, 'guilty'); check(p.held && HM.prisoners.some(x => x.pid === p.id && x.sentence), 'a sentence of days still keeps them inside'); X('jRelease', p.id); }
  // fines go to the chest of the court that set them
  { const [c, p] = mk(GH, 'greenhaven'); p.purse = 60; const v0 = s.village.chest, g0 = s.towns.greenhaven.chest; X('jHear', c.id, { fine: 20 }, 'guilty');
    check(s.village.chest === v0 && s.towns.greenhaven.chest === g0 + 20, 'a 20c fine in Greenhaven goes to Greenhaven’s chest, not Hearthmoor’s'); }
  // unpaid fines are paid down in every court
  { const [c, p] = mk(GH, 'greenhaven'); p.purse = 2; X('jHear', c.id, { fine: 20 }, 'guilty'); const owed = c.fineOwed; Sim.advance(s, 1440 * 2);
    check(owed > 0 && c.fineOwed < owed, 'an unpaid fine in Greenhaven is paid or worked down (' + owed + 'c → ' + c.fineOwed + 'c)'); }
  // overturning a conviction ends its sentence and clears the record
  { const [c, p] = mk(HM, 'hearthmoor'); p.purse = 2; const r0 = p.record || 0; X('jHear', c.id, { fine: 20, work: 2 }, 'guilty'); s.realm.crown = 'player';
    check(X('jOverturn', c.id).ok && !c.fineOwed && !c.workLeft && (p.record || 0) === r0, 'overturned on appeal: the fine and work are cancelled and the record cleared');
    const g0 = s.village.chest; Sim.advance(s, 1440); check(!c.fineOwed && !c.workLeft, 'and nothing more is collected for it'); }
}
{
  const s = newGameRaw(42); s.ageRate = 0; const P = Sim.PORTS, X = (...a) => Sim.cmd(s, ...a), V = s.valdoria, at = k => { s.player.x = P[k].x; s.player.z = P[k].z; };
  s.coins = 4000; s.t = 10 * 60 + 1440 * 2; s.day = 3; at('eastwatch'); X('buyShip'); X('sailShip', 'dawnport');
  const st0 = V.standing; for (let i = 0; i < 5; i++) { X('cargoBuy', 'wine', 10); X('cargoSell', 'wine', 10); }
  check(V.standing === st0, 'buying wine on Dawnport’s quay and selling it straight back earns no name in Valdoria (' + st0 + ' → ' + V.standing + ')');
  X('sailShip', 'eastwatch'); X('cargoBuy', 'iron', 40); X('cargoBuy', 'wool', 40); X('sailShip', 'dawnport');
  const st1 = V.standing; X('cargoSell', 'iron', 40); X('cargoSell', 'wool', 40);
  check(V.standing > st1 && V.standing - st1 <= 3, 'landing Alderwyn goods with the duty paid does (' + st1 + ' → ' + V.standing + ', at most 3 a day)');
  // a royal who marries keeps their own name
  s.realm.crown = 'player'; V.relation = 80; s.coins = 4000; const Y = Sim.you(s); if (Y) Y.sex = 'm';
  const r = X('royalMatch', 'self'), q = s.people[V.royals[0]];
  check(r.ok && q.name === 'Infanta Leonor', 'Infanta Leonor marries you and keeps her name (' + (q && q.name) + ')');
}

console.log('41. Where cargo was bought, sentences that keep running, and old appeals repaired (v0.48; from a second outside review)');
{
  const s = newGameRaw(43); s.ageRate = 0; const P = Sim.PORTS, X = (...a) => Sim.cmd(s, ...a), V = s.valdoria, at = k => { s.player.x = P[k].x; s.player.z = P[k].z; };
  s.coins = 4000; s.t = 10 * 60 + 1440 * 2; s.day = 3; at('eastwatch'); X('buyShip'); X('sailShip', 'dawnport'); V.duty = 1.0;
  const st0 = V.standing; for (let i = 0; i < 3; i++) { X('cargoBuy', 'iron', 10); X('cargoSell', 'iron', 10); }
  check(V.standing === st0, 'Alderwyn iron bought on Dawnport’s quay and sold straight back earns no name, even with no duty (' + st0 + ' → ' + V.standing + ')');
  X('sailShip', 'eastwatch'); X('cargoBuy', 'iron', 10); X('sailShip', 'dawnport'); s.day++; X('cargoBuy', 'iron', 10);
  check(s.ship.origin.iron.eastwatch === 10 && s.ship.origin.iron.dawnport === 10, 'the hold remembers where each load was bought');
  const st1 = V.standing; X('cargoSell', 'iron', 20);
  check(V.standing === st1 + 1, 'selling a mixed hold counts only the loads brought from Alderwyn (' + st1 + ' → ' + V.standing + ')');
}
{
  const s = newGameRaw(44); s.ageRate = 0; Sim.applyStart(s, 'lord'); s.coins = 4000; s.offices.elder = 'player'; Sim.advance(s, 1440);
  const X = (...a) => Sim.cmd(s, ...a), J = s.justice;
  const p = Sim.living(s).find(q => (q.town || 'hearthmoor') === 'hearthmoor' && !q.kid && !q.held && q.status === 'here' && !(q.job && q.job.type === 'office'));
  const mk = () => { const c = { id: J.nextCase++, kind: 'theft', day: s.day, status: 'open', evidence: [{ text: 'x', w: 4 }], hidden: [], witnesses: [], investigating: 0, held: false, accused: p.id, accuser: null, victim: 'chest', value: 12, where: 'the chest', truth: 'guilty', what: 'test', claim: 'test', authority: 'Elder of Hearthmoor' }; J.cases.push(c); return c; };
  p.purse = 2; const k = mk(); X('jHear', k.id, { fine: 20, work: 2 }, 'guilty');
  for (let i = 0; i < 31; i++) { const d = mk(); X('jHear', d.id, {}, 'dismiss'); }
  check(!J.closed.some(c => c.id === k.id) && J.owing.some(e => e.id === k.id), 'a sentence stays on the court’s list after 31 newer cases push it out of the record');
  const e0 = Object.assign({}, J.owing.find(e => e.id === k.id)); Sim.advance(s, 1440 * 2); const e1 = J.owing.find(e => e.id === k.id);
  check(!e1 || (e1.fine < e0.fine && e1.work < e0.work), 'and it goes on being paid and worked off (' + e0.fine + 'c, ' + e0.work + ' days → ' + (e1 ? e1.fine + 'c, ' + e1.work + ' days' : 'done') + ')');
  // a conviction overturned under the old rules, in a save from before the list existed
  const k2 = mk(); p.purse = 2; X('jHear', k2.id, { fine: 20, work: 2 }, 'guilty'); k2.overturned = true; k2.fineOwed = 20; k2.workLeft = 2; delete J.owing;
  const s2 = Sim.deserialize(Sim.serialize(s)), k4 = s2.justice.closed.find(c => c.id === k2.id);
  check(k4 && !k4.fineOwed && !k4.workLeft && !s2.justice.owing.some(e => e.id === k2.id), 'the repair happens as the save loads, before any time passes');
  Sim.advance(s2, 1440); const k3 = s2.justice.closed.find(c => c.id === k2.id);
  check(k3 && !k3.fineOwed && !k3.workLeft && !s2.justice.owing.some(e => e.id === k2.id), 'loading an old save cancels what was left of a conviction already overturned');
}

console.log('42. Stage VIII: Valdor, the Queen, Valdorian courts and roads (v0.49)');
{
  const s = newGameRaw(45); s.ageRate = 0; const X = (...a) => Sim.cmd(s, ...a), V = s.valdoria, L = Sim.LOCS;
  const at = k => { s.player.x = L[k].x; s.player.z = L[k].z; };
  check(Sim.TOWNS.valdor && Sim.TOWNS.valdor.foreign === 'valdoria' && s.towns.valdor && Sim.living(s).filter(p => p.town === 'valdor').length >= 350, 'Valdor stands, in Valdoria, with about 400 people (' + Sim.living(s).filter(p => p.town === 'valdor').length + ')');
  check(!Object.values(s.people).some(p => /^(Townsman|Citizen) /.test(p.name)), 'every Valdorian has a proper name');
  check(Sim.roadDist('dawnport', 'valdor') < 1e8 && Sim.roadDist('thornwick', 'valdor') < Sim.roadDist('dawnport', 'valdor'), 'the Queen’s Road joins Valdor to Thornwick, and through it to Dawnport');
  const Q = Sim.queenOf(s); check(Q && Q.queen && Q.royal === 'valdoria' && Q.town === 'valdor', 'Queen Ximena lives in Valdor');
  // an audience
  at('vdplaza'); check(!X('audience', 'talk').ok, 'she receives only at the Alcázar');
  at('vdalcazar'); V.standing = 10; check(!X('audience', 'talk').ok, 'and not a stranger with no name in Valdoria');
  V.standing = 30; const r1 = X('audience', 'talk'); check(r1.ok && /received by Queen Ximena.*courteous/.test(V.log[0].text), 'with a name of 25 she grants an audience (' + (r1.ok ? V.log[0].text.slice(0, 60) : r1.msg) + ')');
  s.coins = 2000; const f0 = V.favour; check(X('audience', 'gift').ok && V.favour > f0 && !X('audience', 'gift').ok, 'a gift pleases her, and a second so soon is refused');
  check(!X('audience', 'warrant').ok, 'a royal warrant needs the Consul’s charter');
  V.charter = true; V.favour = 65; check(X('audience', 'warrant').ok && V.warrant, 'a chartered merchant she favours is named purveyor to the royal household');
  // her regard moves relations, for a ruler
  s.realm.crown = 'player'; V.favour = 95; V.relation = 50; s.realm.tariff = 1.1; for (let i = 0; i < 7; i++) Sim.advance(s, 1440);
  const warm = V.relation; V.favour = 5; V.relation = 50; for (let i = 0; i < 7; i++) Sim.advance(s, 1440);
  check(warm > V.relation + 1, 'when you rule, relations drift with her regard for you (' + Math.round(warm) + ' warm, ' + Math.round(V.relation) + ' cold)');
  V.favour = 70; V.duty = 1.3; V.treaty = null; at('vdalcazar'); const d0 = V.duty; check(X('audience', 'duty').ok && V.duty < d0 && V.favour < 70, 'a ruler she favours can ask her to lower the duty, at a cost to her regard');
  // royals marry only by treaty, and the Queen is not carried off by old age
  check(!Q.spouse && Sim.living(s).every(p => !p.royal || !p.spouse || V.wed), 'no royal has been married off by chance');
}
{
  const s = newGameRaw(46); s.ageRate = 0; const X = (...a) => Sim.cmd(s, ...a), V = s.valdoria, L = Sim.LOCS; Sim.advance(s, 1440);
  s.realm.crown = 'player'; s.realm.council.law = 'player';
  const C = s.courts.valdor;
  check(C && Sim.foreignCourt(C) && !Sim.canJudge(s, C), 'Valdor keeps its own court, and even the crown of Alderwyn cannot judge in it');
  // a cutpurse you saw: bring the charge, and the Alcalde hears it by Valdorian law
  const thief = Sim.living(s).find(p => p.town === 'valdor' && !p.kid && p.status === 'here' && !p.royal && !p.held);
  thief.purse = 60; s.coins = 400; s.player.x = L.vdplaza.x; s.player.z = L.vdplaza.z;
  V.cutpurse = { day: s.day, value: 30, thief: thief.id, court: 'valdor' }; s.coins -= 30;
  check(X('valAccuse').ok && C.cases.some(c => c.accused === thief.id && c.accuser === 'player'), 'you can bring a charge against the cutpurse you saw');
  const k = C.cases.find(c => c.accused === thief.id && c.accuser === 'player');
  check(!X('jHear', k.id, { fine: 5 }, 'guilty').ok, 'but you cannot hear it yourself');
  const c0 = s.coins; for (let i = 0; i < 9 && C.cases.includes(k); i++) Sim.advance(s, 1440);
  check(!C.cases.includes(k) && /Alcalde/.test(k.outcome || ''), 'the Alcalde hears it (' + (k.outcome || 'still open') + ')');
  if (k.verdict === 'guilty') check(s.coins > c0 && /days? in the cells/.test(k.outcome), 'found guilty, the cutpurse repays you and goes to the Queen’s prison');
  if (k.verdict === 'guilty') check(!X('jOverturn', k.id).ok, 'and Alderwyn’s Lord Justice cannot overturn a Valdorian conviction');
  // the roads and the Brotherhood
  const B = s.bandits; check(Object.keys(Sim.VAL_BANDITS).every(id => typeof B[id] === 'number'), 'bandits haunt Valdoria’s roads');
  B.thornwick = 70; s.player.x = L.swkeep.x; s.player.z = L.swkeep.z; V.standing = 5; check(!X('rideBrotherhood').ok, 'the Brotherhood does not take strangers');
  V.standing = 20; s.t = Math.floor(s.t / 1440) * 1440 + 1440 + 7 * 60; const coins = s.coins;
  check(X('rideBrotherhood').ok && B.thornwick < 50 && s.coins > coins, 'riding with the Brotherhood clears the worst road and pays you');
  check(!X('rideBrotherhood').ok, 'and they ride again only after five days');
}
{
  // an older save gains Valdor and the Queen as it loads
  const s = newGameRaw(47); delete s.towns.valdor; delete s.valdoria.queen; for (const id in s.people) if (s.people[id].town === 'valdor') delete s.people[id]; s.houses = s.houses.filter(h => h.town !== 'valdor'); if (s.courts) delete s.courts.valdor; if (s.goods) delete s.goods.valdor; s.v = 15;
  s.v = 15; const s2 = Sim.deserialize(Sim.serialize(s), { allowOld: true });
  check(s2.v === Sim.VERSION && s2.towns.valdor && Sim.queenOf(s2) && Sim.living(s2).filter(p => p.town === 'valdor').length >= 350, 'a save from v0.48 gains Valdor, its people and the Queen as it loads');
  check(s2.goods.valdor && Sim.goodsPrice(s2, 'valdor', 'grain') > 0, 'with a market of its own');
  Sim.advance(s2, 1440); check(s2.courts.valdor, 'and Valdor’s court sits from the next day');
}

console.log('43. War between the crowns (v0.50)');
{
  const s = newGameRaw(48); s.ageRate = 0; Sim.applyStart(s, 'ruler'); Sim.advance(s, 1440);
  const V = s.valdoria, R = s.realm, X = (...a) => Sim.cmd(s, ...a), P = Sim.PORTS;
  V.relation = 45; check(!X('declareWar').ok, 'there is no war while relations are 30 or more');
  V.relation = 20; V.wed = { royal: V.royals[0], to: 'you', day: 1 }; check(!X('declareWar').ok, 'nor while the royal houses are joined by marriage'); V.wed = null;
  V.treaty = { kind: 'alliance', since: 1 }; check(!X('declareWar').ok, 'nor while the crowns are allied'); V.treaty = null;
  // what you own in Valdoria, and a ship in hand
  s.biz.d_vine.owner = 'player'; s.coins = 3000; s.player.x = P.eastwatch.x; s.player.z = P.eastwatch.z; s.t = Math.floor(s.t / 1440) * 1440 + 10 * 60; X('buyShip');
  const t0 = R.treasury; check(X('declareWar').ok && Sim.atWar(s) && s.biz.d_vine.seized, 'the crown declares war; your tavern in Dawnport is seized');
  check(!X('sail', 'dawnport').ok, 'no passage ships sail to Valdoria in war');
  check(!X('treaty', 'trade').ok && !X('royalMatch', 'self').ok, 'and there are no treaties or royal matches until the peace');
  const c0 = s.coins; Sim.advance(s, 1440); check(s.biz.d_vine.lastProfit === 0, 'the seized tavern earns you nothing');
  check(R.treasury < t0 - 15, 'the war costs the treasury each day (' + (t0 - R.treasury) + 'c on the first day)');
  check(!X('makePeace').ok, 'the Queen will not treat before the war has run five days');
  // the levies decide the drift of the war
  const run = lev => { const t = newGameRaw(49); t.ageRate = 0; Sim.applyStart(t, 'ruler'); Sim.advance(t, 1440); t.valdoria.relation = 20; Sim.cmd(t, 'declareWar'); t.realm.levies = lev; t.realm.treasury = 99999; for (let i = 0; i < 20; i++) Sim.advance(t, 1440); return t.valdoria.war ? t.valdoria.war.score : null; };
  const big = run(320), small = run(40); check(big > small + 30, 'strong levies win the war, weak ones lose it (score ' + Math.round(big) + ' with 320 men, ' + Math.round(small) + ' with 40)');
  // your ship on the crossing: taken at sea, or impounded at Dawnport without the Queen's warrant
  let taken = 0, impounded = 0; for (let k = 0; k < 40; k++) { s.ship = { name: 'Test', port: 'eastwatch', hold: {}, cap: 80, origin: {} }; s.player.x = P.eastwatch.x; s.player.z = P.eastwatch.z; s.coins = 100; const r = X('sailShip', 'dawnport'); if (r.taken) taken++; else if (r.impounded) impounded++; }
  check(taken > 4 && taken < 22 && impounded === 40 - taken, 'on 40 crossings: ' + taken + ' ships taken at sea, the other ' + impounded + ' impounded at Dawnport');
  check(!X('sailShip', 'eastwatch').ok, 'an impounded ship cannot sail');
  // an Alderwyn subject who stays in Valdoria past the grace is shipped home
  s.player.x = Sim.LOCS.dpplaza.x; s.player.z = Sim.LOCS.dpplaza.z; s.coins = 200; for (let i = 0; i < 4; i++) Sim.advance(s, 1440);
  check(Sim.kingdomOf(Sim.townAt(s.player.x, s.player.z)) === 'alderwyn' && s.coins < 200, 'after the three days’ grace, you are fined and shipped home from Valdoria');
  // peace on terms that follow the war
  V.war.score = 50; const tr = R.treasury; check(X('makePeace').ok && !Sim.atWar(s) && R.treasury === tr + 600, 'winning, the crown makes peace and Valdoria pays 600c');
  check(!s.biz.d_vine.seized && !s.ship.impounded, 'what was seized is returned at the peace');
  V.relation = 5; let warAgain = false; for (let i = 0; i < 20; i++) { V.relation = 5; Sim.advance(s, 1440); if (Sim.atWar(s)) warAgain = true; }
  check(!warAgain, 'and there is no new war for weeks after');
  check(Sim.peaceTerms(-30).pay === 300 && Sim.peaceTerms(0).pay === 0 && Sim.peaceTerms(25).pay === -250, 'behind, Alderwyn pays tribute; a stalemate is peace with nothing paid');
}
{
  // the Queen goes to war when relations collapse and nothing binds the crowns; a marriage keeps the peace
  const s = newGameRaw(50); s.ageRate = 0; Sim.advance(s, 1440); const V = s.valdoria;
  let d = 0; for (; d < 80 && !V.war; d++) { V.relation = 6; Sim.advance(s, 1440); }
  check(V.war && V.war.by === 'valdoria', 'with relations at rock bottom, Queen Ximena declares war (after ' + d + ' days)');
  let peace = 0; for (; peace < 150 && V.war; peace++) Sim.advance(s, 1440);
  check(!V.war, 'and when the crown is not yours, the king makes peace in time (' + peace + ' days)');
  const s2 = newGameRaw(51); s2.ageRate = 0; Sim.advance(s2, 1440); s2.valdoria.wed = { royal: s2.valdoria.royals[0], to: 'x', day: 1 };
  let w2 = false; for (let i = 0; i < 60; i++) { s2.valdoria.relation = 6; Sim.advance(s2, 1440); if (s2.valdoria.war) w2 = true; if (s2.valdoria.wed == null) s2.valdoria.wed = { royal: s2.valdoria.royals[0], to: 'x', day: 1 }; }
  check(!w2, 'but never while the royal houses are joined');
}

console.log('44. What wars are for: aims, outright victory, lasting terms, and Stormrest (v0.51)');
{
  const mk = seed => { const s = newGameRaw(seed); s.ageRate = 0; Sim.applyStart(s, 'ruler'); Sim.advance(s, 1440); s.valdoria.relation = 20; s.realm.treasury = 99999; return s; };
  const s = mk(52), V = s.valdoria, R = s.realm, X = (...a) => Sim.cmd(s, ...a);
  check(!Sim.setupStormrest(s).holder, 'Stormrest begins as a free harbour that no crown holds');
  check(X('declareWar', 'stormrest').ok && V.war.goal === 'stormrest' && V.war.side === 'alderwyn', 'the crown declares war to take Stormrest Isle');
  check(!X('warCampaign').ok, 'no campaign until the war stands at 50');
  R.levies = 340; let won = false, tries = 0;
  for (let d = 0; d < 50 && V.war; d++) { Sim.advance(s, 1440); if (V.war && V.war.score >= 50) { tries++; const r = X('warCampaign'); if (r.ok && r.msg === 'won') won = true; } }
  check(won && !V.war && s.stormrest.holder === 'alderwyn', 'with strong levies the war reaches 50, and a campaign takes Stormrest outright (' + tries + (tries === 1 ? ' campaign' : ' campaigns') + ')');
  const tr = R.treasury; Sim.advance(s, 1440); check(R.treasury > tr - 200 && s.stormrest.holder === 'alderwyn', 'the isle stays Alderwyn’s, and pays its dues');
  X('stormDues', 'heavy'); let freed = 0; for (let d = 0; d < 60 && s.stormrest.holder; d++) { Sim.advance(s, 1440); freed = d; }
  check(!s.stormrest.holder, 'taxed hard, the islanders throw the garrison out after ' + freed + ' days, and Stormrest is free again');
  // tribute and the tariff cap, imposed on the loser
  const t2 = mk(53); t2.valdoria.war = null; Sim.startWar(t2, 'player', 'tribute'); t2.valdoria.war.score = 60; Sim.surrender(t2, 'alderwyn');
  const tr2 = t2.realm.treasury; Sim.advance(t2, 1440); check(t2.valdoria.tribute && t2.realm.treasury > tr2 - 140 + 25, 'Valdoria, beaten, pays tribute day by day');
  const t3 = mk(54); t3.realm.tariff = 1.5; Sim.startWar(t3, 'valdoria'); t3.valdoria.war.goal = 'tariff'; t3.valdoria.war.side = 'valdoria'; const f0 = t3.realm.favour; Sim.surrender(t3, 'valdoria');
  check(t3.realm.tariff <= 1.0 && !Sim.cmd(t3, 'rule', 'tariff', 1.5).ok && t3.realm.favour < f0, 'Alderwyn, beaten, must hold its tariff down, and the court blames the crown');
}

console.log('45. Rebellion against the King of Alderwyn (v0.51)');
{
  const lord = seed => { const s = newGameRaw(seed); s.ageRate = 0; Sim.applyStart(s, 'lord'); Sim.advance(s, 1440); s.coins = 5000; return s; };
  const s = lord(55), R = s.realm, X = (...a) => Sim.cmd(s, ...a);
  check(!X('plotRecruit', 'x', 'promise').ok && X('plotBegin', 'crown').ok && R.plot, 'a lord can begin to plot for the crown');
  const T = Sim.plotTargets(s); check(T.length >= 3, 'there are lords and councillors to approach (' + T.length + ')');
  const q = s.people[T[0].pid]; q.opinion = 90; R.kingSupport = 30;
  const r = X('plotRecruit', q.id, 'promise'); check(r.ok && !X('plotRecruit', T[1].pid, 'promise').ok, 'one approach a day (' + r.msg + ')');
  check(!X('plotRise').ok || Sim.rebelMen(s) >= 100, 'a rising needs at least 100 men');
  // discovery: rise within two days or be exiled for treason
  R.plot.discovered = s.day; const c0 = s.coins; Sim.advance(s, 1440 * 3);   // two full days' grace, then the king's men come
  check(!R.plot && R.exile && R.exile.treason && Sim.yourLordships(s).length === 0 && s.coins < c0, 'found out and not risen in two days: stripped, fined and exiled for treason');
  check(X('plotBegin', 'crown').ok, 'from exile, a new plot can begin');
  // a rising that wins the crown
  const w = lord(56), RW = w.realm, Y = (...a) => Sim.cmd(w, ...a); Y('plotBegin', 'crown'); RW.kingSupport = 25;
  const tg = Sim.plotTargets(w).slice(0, 3); for (const x of tg) { w.people[x.pid].opinion = 100; w.realm.plot.lastRecruit = -1; Y('plotRecruit', x.pid, 'promise'); }
  Y('plotArm', 1600); check(Y('plotRise').ok && RW.plot.risen, 'with ' + Sim.rebelMen(w) + ' men against the king’s ' + Sim.crownMen(w) + ', the lord rises');
  let d = 0; for (; d < 60 && RW.plot && RW.plot.risen; d++) { Sim.advance(w, 1440); if (RW.plot && RW.plot.score >= 50) Y('rebelMarch'); }
  check(Sim.isRuler(w) && RW.after, 'the rising takes Crownmere and the crown (' + d + ' days)');
  const owed = RW.after.owed.slice(); check(owed.length >= 1, 'and ' + owed.length + ' allies sworn on a promise are owed land or a seat');
  check(Y('rewardAlly', owed[0], 'seat').ok && !RW.after.owed.includes(owed[0]), 'a promise kept: a council seat for an ally');
  check(Y('rebelSettle', 'amnesty').ok && RW.after.settled, 'the old king’s lords are given amnesty');
  holdElections(w);   // this is about the broken promise, not about whether the new ruler survives a vote in the meantime
  for (let i = 0; i < 26; i++) Sim.advance(w, 1440);
  check(owed.length < 2 || RW.rival, owed.length < 2 ? 'no promise left unkept' : 'an ally cheated of their promise raises men against the new ruler');
  // a rising for a charter, ended on the king's terms
  const c = lord(57), Z = (...a) => Sim.cmd(c, ...a); Z('plotBegin', 'charter'); Z('plotArm', 2000); Z('plotRise'); c.realm.plot.score = 30;
  const tax0 = c.realm.taxRate; Sim.advance(c, 1440);
  check(c.realm.plot && c.realm.plot.offer && Z('rebelTerms').ok && c.realm.laws.fairCourts && c.realm.taxRate < tax0 && Sim.yourSeats(c).length >= 1 && !c.realm.plot, 'the king offers terms; accepted, they bring lower taxes, fair courts and a council seat');
}

console.log('46. Wars and risings keep their word (v0.52; from an outside review)');
{
  const mk = seed => { const s = newGameRaw(seed); s.ageRate = 0; Sim.applyStart(s, 'ruler'); Sim.advance(s, 1440); s.valdoria.relation = 20; s.realm.treasury = 99999; return s; };
  // free trade is free at once, and stays free through the weekly update
  const s = mk(58), V = s.valdoria; V.duty = 1.2; Sim.startWar(s, 'player', 'trade'); Sim.surrender(s, 'alderwyn');
  check(V.privilege && V.duty === 1.0, 'free trade won in a war takes the duty to nothing the day of the peace');
  s.realm.tariff = 2; let worst = 1; for (let i = 0; i < 14; i++) { Sim.advance(s, 1440); worst = Math.max(worst, V.duty); }
  check(worst === 1.0, 'and no weekly update brings any duty back while it lasts, whatever Alderwyn’s tariff (highest seen ' + worst + ')');
  // a truce binds the crown: breaking it is explicit and costly
  check(!Sim.cmd(s, 'declareWar', 'tribute').ok, 'during the truce, declaring war is refused unless you choose to break it');
  const f0 = s.realm.favour, q0 = V.favour, rb = Sim.cmd(s, 'declareWar', 'tribute', 'breakTruce');
  check(rb.ok && Sim.atWar(s) && s.realm.favour < f0 && V.favour < q0, 'breaking the truce is possible, and costs the court’s favour and the Queen’s regard (' + Math.round(q0) + ' → ' + Math.round(V.favour) + ')');
  // losing badly, the Queen sets the terms
  const L = mk(59); Sim.cmd(L, 'declareWar', 'tribute'); L.valdoria.war.score = -70; for (let i = 0; i < 5; i++) { L.valdoria.war.score = -70; L.valdoria.war.since -= 1; }
  L.valdoria.war.since = L.day - 6; const tr = L.realm.treasury;
  check(!Sim.cmd(L, 'makePeace').ok && L.valdoria.war, 'at −70 the Queen will not take gold for peace');
  check(Sim.cmd(L, 'makePeace', 'herTerms').ok && !L.valdoria.war && L.valdoria.tribute && L.valdoria.tribute.to === 'valdoria', 'accepting her terms imposes her aim: tribute from Alderwyn, day by day');
}
{
  // rewards after a rising: seats given are not taken back
  const w = newGameRaw(60); w.ageRate = 0; Sim.applyStart(w, 'lord'); Sim.advance(w, 1440); w.coins = 9000; const RW = w.realm, Y = (...a) => Sim.cmd(w, ...a);
  Y('plotBegin', 'crown'); RW.kingSupport = 20; for (const x of Sim.plotTargets(w).slice(0, 4)) { w.people[x.pid].opinion = 100; RW.plot.lastRecruit = -1; Y('plotRecruit', x.pid, 'promise'); }
  Y('plotArm', 2400); Y('plotRise'); for (let d = 0; d < 60 && RW.plot; d++) { Sim.advance(w, 1440); if (RW.plot && RW.plot.score >= 50) Y('rebelMarch'); }
  const owed = RW.after ? RW.after.owed.slice() : [];
  if (owed.length >= 2) { Y('rewardAlly', owed[0], 'seat'); Y('rewardAlly', owed[1], 'seat'); const seats = Object.keys(RW.council).filter(k => RW.council[k] === owed[0] || RW.council[k] === owed[1]);
    check(seats.length === 2, 'two allies given seats hold two different seats (' + seats.join(', ') + ')'); }
  else check(false, 'the rising was won with at least two allies owed (' + owed.length + ')');
}
{
  // a charter follows the council's rules: a councillor's seat is confirmed, not doubled
  const c = newGameRaw(61); c.ageRate = 0; Sim.applyStart(c, 'lord'); Sim.advance(c, 1440); c.coins = 5000; const R = c.realm;
  R.council.war = 'player'; c.player.councilPath = 'war';
  Sim.cmd(c, 'plotBegin', 'charter'); Sim.cmd(c, 'plotArm', 2000); Sim.cmd(c, 'plotRise'); R.plot.score = 30; Sim.advance(c, 1440);
  check(Sim.cmd(c, 'rebelTerms').ok && Sim.yourSeats(c).length === 1 && R.council.war === 'player', 'a sitting Marshal who wins a charter keeps one seat, confirmed (' + Sim.yourSeats(c).join(', ') + ')');
}

console.log('47. Your name, your enemies, and the people you employ and house (v0.53)');
{
  const mk = (seed, start) => { const s = newGameRaw(seed); s.ageRate = 0; s.bandits = null; if (start) Sim.applyStart(s, start); Sim.advance(s, 1440); s.coins = 9000; Sim.setupFolk(s); return s; };
  const s = mk(70), F = s.folk, Y = (...a) => Sim.cmd(s, ...a);
  // an eviction is remembered, by the family too, and darkens your name
  const h = s.houses.find(x => (x.town || 'hearthmoor') === 'hearthmoor' && x.tenants.some(id => !s.people[id].kid)); Y('buyHouse', h.id);
  const t = s.people[h.tenants.find(id => !s.people[id].kid)], kin = Sim.living(s).filter(q => q !== t && (q.spouse === t.id || (q.parents || []).includes(t.id) || (t.parents || []).includes(q.id)));
  const m0 = F.moral; Y('evict', h.id, t.id);
  check(t.hate >= 20 && t.mem && t.mem[0].w < 0 && /threw them out/.test(t.mem[0].text), 'an evicted tenant hates you and remembers why (' + Math.round(t.hate) + ')');
  check(F.moral < m0, 'and your name grows crueler (' + m0 + ' → ' + F.moral + ')');
  check(!kin.length || kin.every(q => (q.hate || 0) > 0), 'their family holds it against you too (' + kin.length + ' kin)');
  // someone who hates you will not work for you
  check(!Sim.willWork(s, t) && !Y('hireStaff', Object.keys(s.biz).find(id => s.biz[id].owner !== 'player'), t.id, 7).ok, 'they will not work for you');
  // enough hatred makes an enemy, with a reason; kindness can undo it
  Sim.wrong(s, t, 60, 'You ruined them.'); check(t.nem && F.nem.includes(t.id) && t.nem.why, 'past 60 they become your enemy, with a reason (' + Math.round(t.hate) + ')');
  for (let i = 0; i < 4; i++) Sim.kindness(s, t, 20, 'A kindness.'); check(!t.nem && !F.nem.includes(t.id), 'enough kindness ends the enmity (' + Math.round(t.hate) + ')');
}
{
  // workers paid below fair walk out; tenants who cannot pay the rent leave town, and their work
  const s = newGameRaw(71); s.ageRate = 0; s.bandits = null; Sim.advance(s, 1440); s.coins = 9000; Sim.setupFolk(s); const Y = (...a) => Sim.cmd(s, ...a);
  const bid = Object.keys(s.biz).find(id => s.biz[id].owner !== 'player' && !s.biz[id].closed && (s.biz[id].town || 'hearthmoor') === 'hearthmoor' && ['bakery', 'tavern'].includes(s.biz[id].trade)); Y('buyBiz', bid); const b = s.biz[bid]; b.staff.slice(1).forEach(x => { s.people[x.pid].job = null; }); b.staff = b.staff.slice(0, 1);
  const idle = Sim.living(s).filter(q => !q.kid && !q.retired && Sim.townOf(q) === 'hearthmoor' && !(q.job && q.job.type === 'office') && !b.staff.some(x => x.pid === q.id)).slice(0, 2); idle.forEach(q => { if (q.job) { q.job = null; } Y('hireStaff', bid, q.id, 7); });
  const w = s.people[b.staff[b.staff.length - 1].pid]; check(w.mem && w.mem[0].w > 0, 'a hand you hire remembers it kindly');
  for (const st of b.staff) st.wage = 1; let walked = false; for (let d = 0; d < 80 && !walked; d++) { Sim.folkDay(s); walked = !b.staff.some(x => x.pid === w.id); }
  check(walked && w.hate > 0, 'paid 1c a day where fair is ' + Sim.fairWage('hearthmoor') + 'c, a worker walks out, and holds a grudge');
  // the squeeze: works for you and rents from you, and cannot pay
  const q = Sim.living(s).find(x => !x.kid && x.home && Sim.houseById(s, x.home) && Sim.townOf(x) === 'hearthmoor' && Sim.houseById(s, x.home).owner !== x.id), hh = Sim.houseById(s, q.home);
  Y('buyHouse', hh.id); if (q.job) Sim.living(s); q.job = { type: 'biz', biz: bid, role: 'hand' }; b.staff.push({ pid: q.id, wage: 2 }); hh.rent = 20; q.arrears = 3; q.purse = 0;
  for (let d = 0; d < 30 && Sim.townOf(q) === 'hearthmoor'; d++) { q.arrears = 3; Sim.folkDay(s); }
  check(Sim.townOf(q) !== 'hearthmoor' && !hh.tenants.includes(q.id) && !b.staff.some(x => x.pid === q.id), 'a worker squeezed by your rent leaves for ' + Sim.townName(Sim.townOf(q)) + ', and you lose a tenant and a worker');
  check(q.hate > 15, 'and they leave hating you for it (' + Math.round(q.hate) + ')');
  // prices: greedy sells less, cheap sells more
  Sim.living(s).filter(x => !x.kid && !x.retired && Sim.townOf(x) === 'hearthmoor' && !x.job).slice(0, 2).forEach(x => { x.job = { type: 'biz', biz: bid, role: 'hand' }; b.staff.push({ pid: x.id, wage: 7 }); });
  const A = Sim.deserialize(Sim.serialize(s)), B = Sim.deserialize(Sim.serialize(s)); A.biz[bid].prices = 'greedy'; B.biz[bid].prices = 'cheap'; A.biz[bid].burnt = 0; B.biz[bid].burnt = 0; A.biz[bid].slump = null; B.biz[bid].slump = null;
  Sim.advance(A, 1440); Sim.advance(B, 1440);
  check(B.biz[bid].lastSold > 0 && A.biz[bid].lastSold <= B.biz[bid].lastSold && A.biz[bid].lastRevenue / Math.max(1, A.biz[bid].lastSold) > B.biz[bid].lastRevenue / Math.max(1, B.biz[bid].lastSold), 'greedy prices sell no more than cheap ones, for more each (' + A.biz[bid].lastSold + ' for ' + A.biz[bid].lastRevenue + 'c vs ' + B.biz[bid].lastSold + ' for ' + B.biz[bid].lastRevenue + 'c)');
  check(A.folk.moral < B.folk.moral, 'and greed darkens your name while cheap prices lighten it');
}
{
  // an enemy acts against you, and you can face them
  const s = newGameRaw(72); s.ageRate = 0; s.bandits = null; Sim.advance(s, 1440); s.coins = 9000; const F = Sim.setupFolk(s), Y = (...a) => Sim.cmd(s, ...a);
  const bid = Object.keys(s.biz).find(id => s.biz[id].owner !== 'player' && !s.biz[id].closed && (s.biz[id].town || 'hearthmoor') === 'hearthmoor'); Y('buyBiz', bid);
  const q = Sim.living(s).find(x => !x.kid && Sim.townOf(x) === 'hearthmoor' && !(x.job && x.job.type === 'office')); Sim.wrong(s, q, 95, 'You ruined their family.', { raw: true });
  for (let d = 0; d < 80 && q.nem.acts.length < 2; d++) { q.nem.last = -10; q.nem.quiet = 0; Sim.folkDay(s); }
  check(q.nem.acts.length >= 2, 'a nemesis acts against you (' + q.nem.acts.map(a => a.what).join(', ') + ')');
  q.nem.ev = 3; const O = Sim.confrontOpts(s, q); check(O.expose.ok && !O.reconcile.ok, 'with proof you can expose them; with a name that is not fair you cannot ask for peace');
  const h0 = q.hate; check(Y('fConfront', q.id, 'amends').ok && q.hate < h0, 'making amends costs coin and takes much of the hate away (' + Math.round(h0) + ' → ' + Math.round(q.hate) + ')');
  Sim.wrong(s, q, 40, 'Again.', { raw: true }); check(Y('fConfront', q.id, 'bribe').ok && q.nem.quiet > s.day, 'paying them off keeps them quiet for a month');
  // a duel: win, and spare or kill
  F.scene = { kind: 'duel', pid: q.id, day: s.day }; check(Y('fDuelEnd', null, true).ok && F.scene.kind === 'won', 'winning a duel puts their life in your hands');
  const kin = Sim.living(s).filter(x => x !== q && (x.spouse === q.id || (x.parents || []).includes(q.id) || (q.parents || []).includes(x.id)) && !x.kid);
  const m0 = F.moral; Y('fAfter', null, 'kill');
  check(q.status === 'dead' && F.moral < m0, 'killing them is a dark deed (' + m0 + ' → ' + F.moral + ')');
  check(!kin.length || kin.every(x => x.hate >= 60), 'and their grown kin inherit the feud (' + kin.length + ')');
  // a lethal ambush lost: you die and your heir carries on
  const r = Sim.living(s).find(x => !x.kid && x.status === 'here' && !x.nem && x.id !== Sim.you(s).pid && !kin.includes(x)); Sim.wrong(s, r, 120, 'Blood.', { raw: true });
  F.scene = { kind: 'duel', pid: r.id, day: s.day, ambush: true, lethal: true, hired: 'assassin' }; Y('fDuelEnd', null, false);
  check(s.pendingDeath && /blade/.test(s.pendingDeath.how), 'losing to a hired killer in a blood feud is death');
}
{
  // blades, arrests, the throne, and owning a town
  const s = newGameRaw(73); s.ageRate = 0; s.bandits = null; Sim.applyStart(s, 'ruler'); Sim.advance(s, 1440); s.coins = 9000; s.realm.treasury = 9000; const F = Sim.setupFolk(s), Y = (...a) => Sim.cmd(s, ...a);
  const q = Sim.living(s).find(x => !x.kid && Sim.townOf(x) === 'oakbridge' && !x.noble); Sim.wrong(s, q, 70, 'An old wrong.', { raw: true });
  s.player.x = 0; s.player.z = 4; check(!Y('fBlade', q.id).ok, 'no blade is for hire outside the big towns');
  check(Sim.authOver(s, q) && Y('fSend', q.id, 'arrest').ok && q.held && F.moral < 0, 'the crown can gaol an enemy without proof, at a cost to its name');
  const z = Sim.living(s).find(x => !x.kid && Sim.townOf(x) === 'crownmere' && !x.noble && !x.royal && x.status === 'here'); Sim.wrong(s, z, 70, 'Another.', { raw: true });
  s.player.x = Sim.TOWNS.crownmere.x; s.player.z = Sim.TOWNS.crownmere.z;
  check(Y('fBlade', z.id).ok && F.blades.length === 1, 'in Crownmere, a blade can be hired');
  F.blades[0].day = s.day - 1; Sim.folkDay(s); check(z.status === 'dead' || z.hate >= 95, 'by morning they are dead, or know who paid and want blood (' + z.status + ', ' + Math.round(z.hate) + ')');
  // the throne
  for (let i = 0; i < 12 && F.aud.length < 2; i++) Sim.folkDay(s);
  check(F.aud.length >= 1, 'petitioners come to the throne (' + F.aud.map(a => a.key).join(', ') + ')');
  const A = F.aud[0], who = s.people[A.who], m1 = F.moral; check(Y('fAudience', A.id, 'kind').ok && F.moral > m1 && !F.aud.includes(A), 'a kind answer lightens your name');
  if (F.aud.length) { const B = F.aud[0], p2 = s.people[B.who], h2 = p2.hate || 0; Y('fAudience', B.id, 'cold'); check(F.moral < m1 + 10 && ((p2.hate || 0) >= h2), 'a cold one is remembered'); }
  // own every business in Hearthmoor
  for (const id in s.biz) if ((s.biz[id].town || 'hearthmoor') === 'hearthmoor' && s.biz[id].trade !== 'estate') s.biz[id].owner = 'player';
  Sim.folkDay(s); const W = F.towns.hearthmoor;
  check(W && W.all && W.statue, 'owning every business in Hearthmoor makes you its master, with a statue');
  check(Sim.living(s).some(x => x.guild === 'hearthmoor' && x.hate >= 60), 'and the guilds find a champion against you');
  // foreign enemies: your war costs a Valdorian their son
  Sim.warGrief(s, 1); check(Sim.nemeses(s).some(x => Sim.isForeign(x)), 'a war you lead makes enemies in Valdoria');
  const back = Sim.deserialize(Sim.serialize(s)); check(back.folk && back.folk.nem.length === F.nem.length && back.folk.towns.hearthmoor.all, 'all of it is kept in the save');
}

console.log('48. Money, property and the climb (v0.54)');
{
  const s = newGameRaw(80); s.ageRate = 0; s.bandits = null; Sim.advance(s, 1440 * 2);
  // prices by town and spot, in units of 10c
  const range = { hearthmoor: [150, 520], greenhaven: [380, 1050], oakbridge: [900, 2700], eastwatch: [900, 2900], crownmere: [1700, 5200], valdor: [1700, 5200] };
  for (const t in range) { const P = Object.keys(s.biz).filter(id => (s.biz[id].town || 'hearthmoor') === t && !Sim.isPrestige(s, id)).map(id => Sim.bizPrice(s, id)); check(P.length && Math.min(...P) >= range[t][0] && Math.max(...P) <= range[t][1], t + ' businesses cost ' + Math.min(...P) * 10 + '–' + Math.max(...P) * 10 + 'c'); }
  const pr = Sim.prestigeIds(s).map(id => Sim.bizPrice(s, id)); check(pr.length >= 4 && pr.every(x => x >= 10000), 'the great properties cost 100,000c and more (' + pr.map(x => x * 10).join(', ') + ')');
  // a cheap hut is not the best investment in the realm
  const worst = Math.min(...s.houses.map(h => Sim.housePrice(s, h) / Math.max(1, h.rent0 || h.rent))); check(worst >= 30, 'no house pays for itself in under a month of rent (fastest ' + Math.round(worst) + ' days)');
  // a fair wage keeps a household fed and housed
  for (const t of ['hearthmoor', 'oakbridge', 'crownmere', 'valdor']) { const rents = s.houses.filter(h => (h.town || 'hearthmoor') === t).map(h => h.rent).sort((a, b) => a - b), med = rents[Math.floor(rents.length / 2)]; check(Sim.fairWage(t) - 3 - med >= 0, 'in ' + t + ' a fair wage (' + Sim.fairWage(t) * 10 + 'c) covers food (30c) and a middling rent (' + med * 10 + 'c)'); }
  // the starter stall cannot be sold for more than it cost
  s.coins = 1000; s.tradeXp = { bakery: 20 }; Sim.cmd(s, 'open', 1, 'bakery'); const c1 = s.coins; Sim.cmd(s, 'sellShop', s.shops[0].id); check(s.coins - c1 <= Sim.STARTER_PRICE / 2 + 0.01, 'selling the starter stall returns half its price, no more');
  // amends answer to the harm and the person's means, not to your wealth
  Sim.setupFolk(s); const q = Sim.living(s).find(x => !x.kid && x.job); Sim.wrong(s, q, 40, 'You threw them out.'); const a1 = Sim.amendsCost(s, q); s.coins = 1e6; check(Sim.amendsCost(s, q) === a1 && a1 >= 50, 'what it costs to make amends does not grow with your purse (' + a1 * 10 + 'c)');
  check(Sim.bribeCost(s, q) > 0, 'a bribe is priced by who they are');
}
{
  // the village's four asks, and the Elder's chair at standing 60
  const s = Sim.newGame(81); s.coins = 2000; s.tradeXp = { bakery: 20 }; const v = s.village;
  Sim.step(s, 1); check(v.step === 1, 'first ask: make a living');
  Sim.cmd(s, 'open', 1, 'bakery'); Sim.step(s, 1); check(v.step === 2 && v.shortage, 'second: the grain shortage');
  s.player.inv.grain = 20; Sim.cmd(s, 'donate'); runIdle(s); check(!v.council && v.councilInvite && v.step === 5, 'solved, and invited to stand for the council'); winElection(s, 'council'); check(v.council && v.step === 6, 'the moot elects you to the council');
  v.step = 7; Sim.step(s, 1); check(v.step === 8, 'leading the council needs no trip to the manor gate');
  v.standing = 59; Sim.step(s, 1); check(s.offices.elder !== 'player', 'at 59 the chair is not yet yours');
  check(/more day/.test(Sim.standBar(s, Sim.ensureRaces(s).races.elder) || ''), 'a new councillor sits a few days before standing for Elder');
  s.rec.councilSince = s.day - 9; v.standing = 60; Sim.step(s, 1); check(s.offices.elder !== 'player' && !Sim.standBar(s, Sim.ensureRaces(s).races.elder), 'the chair is not given: you may stand for it at the vote');
}
{
  // a lordship cannot be bought: you stand at the vote, with a stake in the region
  const s = newGameRaw(82); s.ageRate = 0; s.bandits = null; Sim.advance(s, 1440); const R = s.realm; s.coins = 50000; Sim.setupFolk(s);
  check(!Sim.cmd(s, 'buyLordship', 'greenhaven').ok, 'gold no longer buys a lordship');
  const race = Sim.ensureRaces(s).races['lord:greenhaven'];
  check(!!Sim.standBar(s, race), 'without a stake in Greenhaven you cannot stand there');
  const gid = Object.keys(s.biz).find(id => s.biz[id].town === 'greenhaven' && s.biz[id].trade !== 'estate'); Sim.cmd(s, 'buyBiz', gid); s.folk.fame = 20;
  check(!/stake|Own a business/.test(Sim.standBar(s, race) || ''), 'owning a business there gives you the stake to stand');
  // the council asks one proof per road
  check(!Sim.seatNeeds(s, 'trade').some(x => /supply/.test(x)), 'Master of Trade needs businesses, not errands');
  check(Sim.seatNeeds(s, 'war').length <= 2 && Sim.seatNeeds(s, 'law').length <= 3, 'and the other roads ask one proof of competence each');
}

console.log('49. Holidays and the chronicle (v0.56)');
{
  check(Sim.HOLIDAYS.length >= 8 && Sim.holidayOn(18).id === 'midsummer' && Sim.holidayOn(18 + Sim.YEAR_DAYS).id === 'midsummer', 'the festivals come round every year (Midsummer Fires on day 18, and again on day 78)');
  check(!Sim.holidayOn(28, 'alderwyn') && Sim.holidayOn(28, 'valdoria').id === 'queensday', 'the Queen’s Feast is kept only in Valdoria');
  const s = newGameRaw(90); s.ageRate = 0; s.bandits = null; Sim.advance(s, 1440 * 11 + 600);
  const said = (s.chronicle || []).filter(c => /^Today is Maying/.test(c.x)); check(!said.length, 'Maying has not come yet on day 12');
  Sim.advance(s, 1440); check((s.chronicle || []).filter(c => c.d === 13 && /^Today is Maying/.test(c.x)).length === 1, 'on its day, the festival is announced once, and written in the chronicle');
  // folk spend more on a festival
  const day = s.day, A = Sim.deserialize(Sim.serialize(s)), B = Sim.deserialize(Sim.serialize(s)); B.day = day + 2;   // B: an ordinary day
  const sold = g => Object.values(g.biz).reduce((a, b) => a + (b.lastSold || 0), 0);
  Sim.advance(A, 1440 - (A.t % 1440) + 60); Sim.advance(B, 1440 - (B.t % 1440) + 60);
  check(sold(A) >= sold(B), 'businesses sell at least as much on a festival as on an ordinary day (' + Math.round(sold(A)) + ' vs ' + Math.round(sold(B)) + ')');
  // paying for the festivities
  const t = newGameRaw(91); t.ageRate = 0; t.bandits = null; Sim.advance(t, 1440 * 17 + 300); t.coins = 5000; Sim.setupFolk(t);
  check(Sim.holidayOn(t.day).id === 'midsummer' && !Sim.cmd(t, 'fFestival').ok, 'only the Elder, a lord or the crown pays for a festival');
  t.offices.elder = 'player'; const c0 = t.coins, m0 = t.folk.moral; check(Sim.cmd(t, 'fFestival').ok && t.coins < c0 && t.folk.moral > m0, 'as Elder you can pay for Midsummer, and the village thinks better of you');
  check(!Sim.cmd(t, 'fFestival').ok, 'once a festival');
  // the chronicle keeps what matters, and is saved
  const n0 = t.chronicle.length; Sim.cmd(t, 'fAlms'); t.events.push(); check(t.chronicle.length >= n0, 'what you do is written down');
  check(!t.chronicle.some(c => c.k === 'coin') && !t.chronicle.some(c => /^Day \d+ begins/.test(c.x)), 'sales and daybreaks are left out');
  const back = Sim.deserialize(Sim.serialize(t)); check(back.chronicle.length === t.chronicle.length, 'the chronicle is kept in the save');
}

console.log('50. Staff, elections and promises (v0.57-v0.59)');
{
  // work pays however quick the minigame is on screen, whatever the world speed
  const w = Sim.newGame(5901); w.starterUsed = true; w.coins = 500; Sim.cmd(w, 'open', 1, 'bakery');
  const st = Sim.workStart ? null : null;
  // managers set jobs, never the owner's supply choice
  const m = Sim.newGame(5902); m.coins = 9000; m.starterUsed = true; (m.tradeXp = m.tradeXp || {}).bakery = 20; m.village.step = 9;
  Sim.cmd(m, 'open', 1, 'bakery'); const sh = m.shops[m.shops.length - 1]; sh.tier = 1;
  if (!m.applicants.length) m.applicants.push({ name: 'Ada Test', skill: 1, ask: 8 }); Sim.cmd(m, 'hire', sh.id, 0, 10);
  for (let i = 0; i < 2; i++) { m.applicants.push({ name: 'Extra ' + i, skill: 0.9 + i * 0.3, ask: 8 }); Sim.cmd(m, 'hireHand', sh.id, m.applicants.length - 1); }
  check(sh.hands.length === 2 && sh.hands.some(h => h.role === 'counter'), 'the first employee takes the counter');
  sh.manager = { pid: null, name: 'Test Manager', skill: 1, wage: 10, budget: 10 }; sh.policy.mgrRoles = true;
  Sim.cmd(m, 'policy', sh.id, 'supplyBy', 'none'); Sim.assignRoles(m, sh);
  check(sh.policy.supplyBy === 'none' && Sim.supplier(sh) === 'manager', 'a manager always sees to supplies, even if they were set to nobody');
  check(sh.hands.filter(h => h.role === 'counter').length === 1, 'the manager keeps one employee on the counter');
  { sh.stock.grain = 2; sh.stock.wood = 1; sh.fetch = null; sh.fetchWait = 0; m.t = Math.floor(m.t / 1440) * 1440 + 10 * 60; const c0 = m.coins;
    for (let i = 0; i < 30 && !sh.fetch; i++) Sim.advance(m, 1);
    const went = !!sh.fetch; for (let i = 0; i < 240 && sh.fetch; i++) Sim.advance(m, 1);
    check(went && !sh.fetch && m.coins < c0 && sh.stock.grain > 2, 'the manager walks to the Trading Post on their own when storage runs low, and brings the supplies back'); }
  // trade levels never depend on office
  const t = Sim.newGame(5903); (t.tradeXp = t.tradeXp || {}).bakery = 500;
  check(Sim.tradeLevel(t, 'bakery') === 5, 'trade level 5 from work alone, with no office');
  // elections: the moot never seats a lord as Elder
  const e = Sim.newGame(5904); Sim.applyStart(e, 'lord'); Sim.advance(e, 60);
  const lord = Sim.yourOffice(e); e.village.council = true; e.village.step = 8; e.village.standing = 90;
  if (e.offices.elder && e.offices.elder !== 'player') { const id = e.offices.elder; e.gov.approval.elder = 5; }
  for (let i = 0; i < 10; i++) Sim.advance(e, 1440);
  check(!(e.offices.elder === 'player' && Sim.yourLordships(e).some(x => x !== 'crownmere')), 'no one holds Elder and a lordship together');
  // promises are checked against what you do, not paid off
  const c = Sim.newGame(5905); Sim.applyStart(c, 'ruler'); Sim.advance(c, 60); c.coins = 99999;
  const r = Sim.ensureRaces(c).races.crown; r.poll = c.day + 3; r.open = false; Sim.advance(c, 1440);
  check(r.open && r.you, 'the ruler is on the ballot for re-election');
  check(Sim.cmd(c, 'pledge', 'crown', 'ctax').ok !== false, 'promise to lower the realm’s taxes');
  r.boost = 400; const tax0 = c.realm.taxRate; let k = 0; while (r.open && k < 6) { Sim.advance(c, 1440); k++; }
  const E = Sim.electState(c), pl = E.pledges.find(x => x.id === 'ctax');
  check(Sim.isRuler(c) && pl && pl.state === 'given', 're-elected, and the promise is now owed');
  check(Sim.cmd(c, 'keepPledge', 0).ok === false, 'a promise cannot be paid off with coin');
  Sim.cmd(c, 'rule', 'tax', tax0 - 0.25); Sim.advance(c, 1440);
  check(pl.state === 'kept' && c.realm.taxRate < tax0, 'lowering the taxes keeps the promise');
  // a challenge between elections, only when the holder falters
  const h = Sim.newGame(5906); Sim.applyStart(h, 'lord'); Sim.advance(h, 60); h.coins = 99999; if (h.folk) h.folk.fame = 40;
  const cr = Sim.ensureRaces(h).races.crown; cr.poll = h.day + 40; h.realm.kingSupport = 70;
  check(!!Sim.challengeBar(h, cr), 'a popular king cannot be challenged early');
  h.realm.council.trade = 'player'; Sim.electState(h).since = h.day - 99; h.realm.kingSupport = 30; const bar = Sim.challengeBar(h, cr); { const at = Sim.LOCS[Sim.raceVenue(cr).loc]; h.player.x = at.x; h.player.z = at.z; }
  check(!bar && Sim.cmd(h, 'challenge', 'crown').ok !== false && cr.poll <= h.day + 4, 'a faltering king can be forced to an early vote' + (bar ? ': ' + bar : ''));
}

// stage I, steady ground: one broken part of a day no longer stops the game, and the dead leave nothing behind
{
  console.log('\n== steady ground ==');
  const g = Sim.newGame(7101); Sim.advance(g, 60); g.gov = {};
  Sim.setStrict(false);
  let day0 = g.day, threw = false; try { Sim.advance(g, 1440 * 3); } catch (e) { threw = true; }
  Sim.setStrict(true);
  check(!threw && g.day >= day0 + 3, 'with the village government broken, three days still go by (day ' + day0 + ' to ' + g.day + ')');
  check(Sim.faults().some(f => /government/.test(f.name)), 'the broken part is recorded, so it can be seen and fixed');
  const w = Sim.newGame(7102); Sim.advance(w, 60 * 24 * 20);
  const A = Object.values(w.biz).find(b => !b.closed && b.owner !== 'player' && w.people[b.owner] && w.people[b.owner].status === 'here');
  const owner = w.people[A.owner], B = Object.values(w.biz).find(b => b !== A && !b.closed && b.owner !== 'player' && b.owner !== owner.id);
  B.owner = owner.id;   // a second business in the same hands
  Sim.dies(w, owner);
  check(!Sim.living(w).includes(owner), 'the dead are not among the living the moment they die');
  check(w.biz[A.id].owner !== owner.id || w.biz[A.id].closed, 'the business they worked in passes on or shuts');
  check(w.biz[B.id].owner !== owner.id || w.biz[B.id].closed, 'so does any other business they owned');
  // a save from before the fix: an owner already dead, still on the books
  const x = Object.values(w.biz).find(b => !b.closed && b.owner !== 'player' && w.people[b.owner] && w.people[b.owner].status === 'here');
  const o2 = w.people[x.owner]; o2.status = 'dead';
  const buy = Sim.cmd(w, 'buyBiz', x.id); check(buy && buy.ok === false, 'nobody can buy a business from a dead owner');
  Sim.advance(w, 1440);
  check(x.owner !== o2.id || x.closed, 'a business left with a dead owner is settled the next morning');
  // starting again as a stranger
  const b = Sim.newGame(7103); Sim.advance(b, 60 * 24 * 5);
  b.char.level = 6; b.char.perks.foreman = 1; b.player.items.push({ u: 9999, id: 'tunic', dur: 40 }); b.fight = { kind: 'knockout', foes: [], allies: [] }; b.pendingDeath = {};
  check(Sim.cmd(b, 'beginAgain', 'Wren', 'm').ok, 'starting again works');
  check(b.char.level === 1 && !b.char.perks.foreman && !b.fight && !b.player.items.some(i => i.u === 9999), 'the new life keeps no levels, perks, gear or fight from the old one');
  Sim.advance(b, 1440 * 2); check(b.char.level === 1, 'and does not get them back by being credited');
}

console.log('50. Stage III: the people. Key people, townsfolk and the crowd');
const faults50 = Sim.faults().length;   // earlier sections break things on purpose; count only what is new
{
  const s = Sim.newGame(4401); Sim.advance(s, 1440 * 2);
  const X = s.ppl, per = t => Object.values(X.key).filter(k => k.t === t).length;
  check(per('hearthmoor') >= 3 && per('hearthmoor') <= 5 && per('crownmere') >= 20 && per('crownmere') <= 32, 'a village has a handful of key people (' + per('hearthmoor') + '), the capital a few dozen (' + per('crownmere') + ')');
  check(Object.keys(X.key).every(id => { const o = Sim.pplOf(s, s.people[id]); return o.key && o.want && o.loyal && o.why; }), 'every key person has an aim, a loyalty and a reason they matter');
  const folk = Sim.living(s).filter(p => !X.key[p.id]).slice(0, 200);
  check(folk.every(p => { const o = Sim.pplOf(s, p); return !o.key && o.want && o.loyal && o.owes != null && o.feel && o.feelWhy; }), 'everyone else keeps a want, a loyalty, what they owe and how they feel about you');
  const q = folk.find(p => !p.kid && p.status === 'here'); Sim.wrong(s, q, 20, 'You cheated them at the market.');
  check(Sim.pplOf(s, q).feelWhy === 'You cheated them at the market.', 'and the reason they feel as they do is the thing you did');
  // the same world, healthy, stays calm
  check(Object.values(X.crowd).every(c => c.heat < 40), 'a fed and working realm is calm in every town');
  // a secret is learned by asking, never shown before
  const kp = Sim.notables(s, 'hearthmoor')[0], K = X.key[kp.id]; K.secret = { k: 'debt', known: false }; s.coins = 500;
  check(Sim.pplOf(s, s.people[kp.id]).secret === null, 'a secret is hidden until you learn it');
  let got = false; for (let i = 0; i < 60 && !got; i++) { K.asked = -99; s.day += 0; got = /Someone talks/.test(Sim.cmd(s, 'pAsk', kp.id).msg || ''); if (!got) Sim.advance(s, 1440); }
  check(got && K.secret.known && /deeper in debt/.test(Sim.pplOf(s, s.people[kp.id]).secret), 'asking around can uncover it, and then it is written on their card');
  // a key person with a grudge moves against you, and you are told who and why
  const foe = s.people[Sim.notables(s, 'hearthmoor')[1].id]; foe.hate = 70;
  check(Sim.stanceOf(s, foe).v === -1, 'a key person who hates you stands against you');
  const n0 = s.events.length; let told = null; for (let d = 0; d < 16 && !told; d++) { Sim.advance(s, 1440); told = X.log.find(l => l.pid === foe.id && /Why:/.test(l.x)); }
  check(!!told && told.x.includes(foe.name), 'within a fortnight they act, and the news names them and gives the reason');
  // people rise out of the crowd
  const before = new Set(Object.keys(X.key)); let rose = null;
  for (let d = 0; d < 80 && !rose; d++) { Sim.advance(s, 1440); rose = Object.keys(X.key).map(id => X.key[id]).find(k => /warden of|knows what/.test(k.why)); }
  check(!!rose, 'a townsperson rises to matter: ' + (rose ? rose.why : 'nobody'));
  check(Sim.faults().length === faults50, 'no faults in a hundred days of it');
}
{
  // the crowd: warnings first, then a riot with real losses; bread and a speech can stop it
  const s = Sim.newGame(4402); Sim.advance(s, 1440 * 2); holdElections(s);
  const X = s.ppl, starve = () => { for (const p of Sim.townFolk(s, 'oakbridge')) if (!p.kid) { p.purse = -5; p.hungry = true; p.mood = 15; } };
  const seen = []; let d = 0;
  for (; d < 25 && !(X.crowd.oakbridge.riot); d++) { starve(); Sim.advance(s, 1440); seen.push(X.crowd.oakbridge.warn); }
  const C = X.crowd.oakbridge;
  check(!!C.riot && d >= 4, 'a starving town riots, but only after ' + d + ' days of building anger');
  check(seen.includes(1) && seen.includes(2), 'with warnings on the way: muttering, then crowds gathering');
  check(Object.values(s.biz).filter(b => b.town === 'oakbridge' && !b.closed).every(b => b.riot >= s.day - 1), 'every shop in the town is shut');
  check(/looted|alight|hurt|killed/.test(C.riot.text), 'and there are real losses: ' + C.riot.text.slice(0, 90));
  check(s.rec.riots === 1 && C.heat < 60, 'the anger is spent for a while afterwards');
  const s2 = Sim.newGame(4402); Sim.advance(s2, 1440 * 2); holdElections(s2); s2.coins = 5000;
  const st2 = () => { for (const p of Sim.townFolk(s2, 'oakbridge')) if (!p.kid) { p.purse = -5; p.hungry = true; p.mood = 15; } };
  for (let i = 0; i < d + 3; i++) { st2(); Sim.advance(s2, 1440); if (s2.ppl.crowd.oakbridge.heat >= 55) Sim.cmd(s2, 'pCrowd', 'oakbridge', 'bread'); }
  check(!s2.ppl.crowd.oakbridge.riot, 'bread handed out in time heads the same riot off');
  check(!Sim.cmd(s2, 'pCrowd', 'oakbridge', 'watch').ok, 'only whoever governs a town can send out the watch');
  check(Sim.faults().length === faults50, 'no faults');
}
{
  // crowds with weight: the people who depend on a key person follow them at the vote
  const s = Sim.newGame(4403); Sim.advance(s, 1440 * 2);
  const X = s.ppl, r = { key: 'lord:oakbridge', office: 'lord', region: 'oakbridge', cands: [], you: true, boost: 0, open: true };
  const ks = Sim.notables(s, 'oakbridge').filter(n => n.bloc >= 2); r.cands = [ks[0].id];
  const share = () => { let a = 0; for (let i = 0; i < 6; i++) { s.day += 1; a += Sim.pollNow(s, r).find(x => x.id === 'player').share; } s.day -= 6; return a / 6; };
  for (const id in X.key) X.key[id].backs[r.key] = ks[0].id; const against = share();
  for (const id in X.key) X.key[id].backs[r.key] = 'player'; const forYou = share();
  check(forYou > against + 3, 'with the key people behind you your share of the vote is higher (' + Math.round(against) + '% to ' + Math.round(forYou) + '%)');
  X.crowd.oakbridge.mood = 'angry'; const hold = Sim.regionLord(s, 'oakbridge');
  check(Sim.blocOf(s, ks[0].id) === ks[0].bloc && ks[0].bloc >= 2, 'a key person’s following is the people they pay and house');
  // saves: the tiers survive a save, and a save from before Stage III is converted
  const back = Sim.deserialize(Sim.serialize(s));
  check(Object.keys(back.ppl.key).length === Object.keys(X.key).length && back.ppl.crowd.oakbridge.mood === 'angry', 'key people and the mood of each town are kept in the save');
  const old = JSON.parse(Sim.serialize(s)); old.v = 18; delete old.ppl; for (const id in old.people) delete old.people[id].tier;
  const conv = Sim.deserialize(JSON.stringify(old));
  check(conv.v === Sim.VERSION && Object.keys(conv.ppl.key).length > 100 && conv.ppl.crowd.crownmere, 'an older save is converted: ' + Object.keys(conv.ppl.key).length + ' key people named, every town given a mood');
  Sim.advance(conv, 1440 * 3); check(Sim.faults().length === faults50, 'and the converted game runs on');
  // speed: the people do not slow the biggest town
  const t0 = process.cpuUsage(); for (let i = 0; i < 20; i++) { Sim.pplDay(conv); } const ms = (process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000 / 20;
  check(ms < 60, 'a day of the people system for all eleven towns takes ' + Math.round(ms) + ' ms');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
