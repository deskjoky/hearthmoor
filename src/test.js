const Sim = require('./sim.js');
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); }
function runIdle(s, max = 3000) {
  let m = 0;
  while ((s.player.dest || s.player.action) && m < max) { Sim.step(s, 1); m++; }
  return m;
}
function invariants(s) {
  const nums = [s.coins, s.bakery.grain, s.bakery.wood, s.bakery.bread, s.player.x, s.player.z];
  if (nums.some(n => !Number.isFinite(n))) return 'non-finite number';
  if (s.coins < 0 || s.bakery.grain < 0 || s.bakery.wood < 0 || s.bakery.bread < 0) return 'negative stock or coin';
  if (s.bakery.bread > Sim.TIERS[s.tier].cap) return 'bread over capacity';
  if (s.agents.length > 60) return 'agents leaking';
  if (s.bakery.queue.some(id => !s.agents.find(a => a.id === id))) return 'dead id in queue';
  if (s.agents.some(a => !Number.isFinite(a.x) || !Number.isFinite(a.z))) return 'agent position NaN';
  return null;
}

console.log('1. Broke players can always recover');
{
  const s = Sim.newGame(7); s.coins = 0;
  Sim.cmd(s, 'gather', 'wood'); runIdle(s);
  check(s.player.inv.wood === Sim.CARRY, 'gathered a full load of wood for free (' + s.player.inv.wood + ')');
  Sim.cmd(s, 'goto', 'market'); runIdle(s);
  const r = Sim.cmd(s, 'sell', 'wood', s.player.inv.wood);
  check(r.ok && s.coins === 20, 'sold wood at the Trading Post for ' + s.coins + 'c');

  const t = Sim.newGame(8); t.coins = 0;
  Sim.cmd(t, 'gather', 'grain'); for (let i = 0; i < 70; i++) Sim.step(t, 1); Sim.cmd(t, 'stop');
  Sim.cmd(t, 'gather', 'wood'); for (let i = 0; i < 90; i++) Sim.step(t, 1); Sim.cmd(t, 'stop');
  const r2 = Sim.cmd(t, 'bake'); runIdle(t);
  check(r2.ok && t.bakery.bread >= 4, 'baked bread with zero coins (' + t.bakery.bread + ' loaves)');
}

console.log('2. Price changes demand (no unlimited-money button)');
{
  const rows = [];
  for (const price of [2, 4, 5, 6, 8, 10, 12]) {
    const s = Sim.newGame(99); s.coins = 2000;
    Sim.cmd(s, 'hire', 0, s.applicants[0].ask); Sim.cmd(s, 'policy', 'supplyRuns', true); Sim.cmd(s, 'setPrice', price);
    s.bakery.grain = 12; s.bakery.wood = 12;
    Sim.advance(s, 1440 * 8);
    const days = s.ledger.slice(1);
    const sold = days.reduce((a, d) => a + d.sold, 0) / days.length;
    const rev = days.reduce((a, d) => a + d.revenue, 0) / days.length;
    const profit = days.reduce((a, d) => a + d.profit, 0) / days.length;
    const walked = days.reduce((a, d) => a + d.tooExpensive, 0) / days.length;
    rows.push({ price, sold, rev, profit, walked });
  }
  console.table(rows.map(r => ({ price: r.price, 'loaves/day': r.sold.toFixed(1), 'revenue/day': r.rev.toFixed(1), 'profit/day': r.profit.toFixed(1), 'walked away': r.walked.toFixed(1) })));
  const by = p => rows.find(r => r.price === p);
  check(by(2).sold > by(8).sold && by(8).sold > by(12).sold, 'higher prices sell fewer loaves');
  check(by(12).rev < by(6).rev, 'very high prices earn less than fair prices');
  check(by(2).profit < by(5).profit, 'very low prices earn less profit than fair prices');
}

console.log('3. Save and restore mid-task gives identical futures');
{
  const a = Sim.newGame(3); a.coins = 300;
  Sim.cmd(a, 'hire', 1, 9); Sim.cmd(a, 'policy', 'supplyRuns', true);
  a.bakery.grain = 6; a.bakery.wood = 3;
  Sim.cmd(a, 'gather', 'wood');
  let guard = 0;
  while (!(a.worker.task === 'bake' && a.bakery.oven.loaded && a.bakery.oven.progress > 5) && guard < 5000) { Sim.step(a, 1); guard++; }
  check(a.worker.task === 'bake' && a.player.action, 'paused while worker is mid-bake and player mid-gather');
  const saved = Sim.serialize(a);
  const b = Sim.deserialize(saved);
  check(JSON.stringify(b.player.inv) === JSON.stringify(a.player.inv) && b.coins === a.coins && b.tier === a.tier, 'inventory, coins and buildings restored');
  check(b.worker.task === a.worker.task && b.bakery.oven.progress === a.bakery.oven.progress, 'worker task and oven progress restored');
  Sim.advance(a, 3000); Sim.advance(b, 3000);
  check(Sim.serialize(a) === Sim.serialize(b), 'both copies play out identically for 3000 more minutes');
  let bad = false; try { Sim.deserialize('{"hello":1}'); } catch (e) { bad = true; }
  check(bad, 'rejects a file that is not a save');
}

console.log('4. Forty-day soak with a simple player bot');
{
  const s = Sim.newGame(2024);
  let problem = null, supplyRun = 0, maxSupply = 0, firstHire = null, upgradeDays = [];
  for (let day = 0; day < 40 && !problem; day++) {
    for (let m = 0; m < 1440 && !problem; m++) {
      const h = Sim.hourOf(s);
      if (!s.player.dest && !s.player.action && h >= 6 && h < 20) {
        const T = Sim.TIERS[s.tier], next = Sim.TIERS[s.tier + 1];
        if (!s.worker && s.coins >= 20 && s.applicants.length) { Sim.cmd(s, 'hire', 0, s.applicants[0].ask); Sim.cmd(s, 'policy', 'supplyRuns', true); firstHire = firstHire || s.day; }
        if (next && s.coins >= next.cost.coin && s.player.inv.wood + s.bakery.wood >= next.cost.wood) { if (Sim.cmd(s, 'upgrade').ok) upgradeDays.push(s.day); }
        const atCounter = Sim.dist(s.player, Sim.P.serve) < 0.5;
        if (!s.worker && s.bakery.bread > 0 && h < 18) { if (!atCounter) Sim.cmd(s, 'serve'); }
        else if (!s.worker && s.bakery.bread < 4 && (s.bakery.grain >= 2 && s.bakery.wood >= 1)) Sim.cmd(s, 'bake');
        else if (!s.worker && s.bakery.grain < 2) { if (Sim.carried(s) >= 6) Sim.cmd(s, 'store'); else Sim.cmd(s, 'gather', 'grain'); }
        else if (Sim.carried(s) >= 16) Sim.cmd(s, 'store');
        else Sim.cmd(s, 'gather', 'wood');
        if (s.player.action && s.player.action.type === 'gather') s.player.action.left = Math.min(s.player.action.left, 40);
      }
      if (s.player.action && s.player.action.type === 'gather' && Sim.carried(s) >= 16) Sim.cmd(s, 'stop');
      Sim.step(s, 1);
      problem = invariants(s);
      if (s.worker && s.worker.task === 'supply') { supplyRun++; maxSupply = Math.max(maxSupply, supplyRun); } else supplyRun = 0;
    }
  }
  check(!problem, 'no invariant broken' + (problem ? ': ' + problem : ''));
  check(maxSupply < 150, 'supply runs finish (longest ' + maxSupply + ' min)');
  check(s.ledger.length >= 13, 'ledger keeps recent days (' + s.ledger.length + ')');
  const last = s.ledger.slice(-5);
  console.log('   hired on day ' + firstHire + ', upgrades on days ' + upgradeDays.join(', ') + ', final tier ' + Sim.TIERS[s.tier].name + ', coins ' + s.coins);
  console.log('   last days:', last.map(d => `D${d.day}: sold ${d.sold}, profit ${d.profit}c, you ${Sim.hm(d.playerMin)}, worker ${Sim.hm(d.workerMin)}`).join(' | '));
  check(s.tier === 2, 'bot reached the Stone Bakery');
  check(last.every(d => d.notes.length > 0), 'every day has a ledger explanation');
}

console.log('5. Hiring takes bakery work off the player');
{
  const s = Sim.newGame(55); s.coins = 100; s.bakery.grain = 12; s.bakery.wood = 12;
  // day 1 solo: player tends the stand and bakes all day
  for (let m = 0; m < 900; m++) {
    if (!s.player.dest && !s.player.action) {
      if (s.bakery.bread < 3 && s.bakery.queue.length === 0) Sim.cmd(s, 'bake'); else if (Sim.dist(s.player, Sim.P.serve) > 0.5) Sim.cmd(s, 'serve');
    }
    Sim.step(s, 1);
  }
  Sim.advance(s, 540);
  const solo = s.ledger[s.ledger.length - 1];
  Sim.cmd(s, 'hire', 0, s.applicants[0].ask); Sim.cmd(s, 'policy', 'supplyRuns', true);
  Sim.cmd(s, 'gather', 'wood');
  Sim.advance(s, 1440);
  const help = s.ledger[s.ledger.length - 1];
  console.log(`   solo day: you ${Sim.hm(solo.playerMin)} at the bakery, sold ${solo.sold}. With worker: you ${Sim.hm(help.playerMin)}, worker ${Sim.hm(help.workerMin)}, sold ${help.sold}`);
  check(help.playerMin < solo.playerMin / 4, 'player bakery hours drop sharply after hiring');
  check(help.sold >= solo.sold * 0.7, 'sales hold up with the worker in charge');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
