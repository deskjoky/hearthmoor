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

console.log('55. Stage VIII: banking. Loans against what you own, the missed-payment ladder, your own bank, runs, and the crown in debt');
{
  const faults55 = Sim.faults().length;
  const at = (s, loc) => { const L = Sim.LOCS[loc === 'oaksq' ? 'bank:oakbridge' : loc]; s.player.x = L.x; s.player.z = L.z; };
  const ready = s => { Sim.setupBanks(s); s.village.standing = 80; s.coins = Math.max(s.coins, 60000); const K = s.bank.banks.oakbridge; K.repaid = 1; K.trust = 70; };
  const s = Sim.newGame(5501); Sim.applyStart(s, 'merchant'); s.coins = 6000; Sim.advance(s, 2); holdElections(s);
  Sim.cmd(s, 'buyBiz', 'o_wicks'); Sim.advance(s, 1440); at(s, 'oaksq');
  const V = Sim.bankView(s), B = V.bankHere;
  check(B && /Alder Bank/.test(B.name) && B.banker && s.people[s.bank.banks.oakbridge.pid].banker === 'oakbridge', 'Oakbridge has a bank, kept by ' + (B && B.banker));
  check(Sim.BANK_TOWNS.every(t => s.bank.banks[t] && Sim.BANK_SITE[t] && Sim.LOCS['bank:' + t]) && !s.bank.banks.hearthmoor, 'all five big towns have one, each a building on a street; Hearthmoor has only the moneylender');
  const pl = B.pledges.find(p => p.kind === 'biz');
  check(pl && pl.terms.max >= pl.value && pl.terms.rate >= 0.004 && pl.terms.rate <= 0.014, 'you can borrow against a business you own: up to ' + Math.floor(pl.terms.max) + 'c at ' + Math.round(pl.terms.rate * 1000) / 10 + '% a day');
  at(s, 'market'); check(!Sim.cmd(s, 'bankBorrow', 100, 'biz:o_wicks').ok, 'but only by walking into the bank');
  { const L = Sim.LOCS.oaksq; s.player.x = L.x; s.player.z = L.z; check(!Sim.cmd(s, 'bankBorrow', 100, 'biz:o_wicks').ok && Sim.atBank(s) === null, 'being in the same town is not enough: you must be at its door'); }
  at(s, 'oaksq'); const c0 = s.coins, n = Math.floor(pl.terms.max * 0.5); check(Sim.cmd(s, 'bankBorrow', n, 'biz:o_wicks').ok && s.coins === c0 + n, 'borrowing ' + n + 'c puts it in your purse');
  check(!Sim.cmd(s, 'bankBorrow', 50, 'biz:o_wicks').ok, 'the same pledge cannot back two loans');
  at(s, 'market'); for (let d = 0; d < 31; d++) Sim.advance(s, 1440);
  const L0 = s.bank.loans[0];
  check(L0.status === 'paid' && L0.paid >= 6 && s.bank.banks.oakbridge.repaid === 1 && s.bank.banks.oakbridge.trust > 50, 'paid every five days from wherever you are, it is cleared in thirty days, and the banker remembers');
  check(s.ledger.every(e => Math.abs(e.unexplained || 0) < 0.01), 'the ledger adds up to the coin with a loan running');
  // the ladder: warned, fined, then the pledge is taken and the rest handed back
  at(s, 'oaksq'); const t2 = Sim.bankTerms(s, 'oakbridge', Sim.pledges(s).find(p => p.kind === 'biz')); Sim.cmd(s, 'bankBorrow', Math.floor(t2.max * 0.5), 'biz:o_wicks'); at(s, 'market');
  const L1 = s.bank.loans[s.bank.loans.length - 1], keep = s.coins; let seen = [];
  for (let d = 0; d < 16 && L1.status === 'open'; d++) { s.coins = 0; Sim.advance(s, 1440); seen.push(L1.missed); }
  s.coins = Math.max(s.coins, 0) + keep;
  check(seen.includes(1) && seen.includes(2) && L1.status === 'seized', 'unpaid: a warning, then a fee, then the bank takes the pledge (missed: ' + seen.filter((x, i, a) => a.indexOf(x) === i).join(', ') + ')');
  check(s.biz.o_wicks.owner !== 'player' && s.bank.log.some(l => /comes back to you|still owed/.test(l.x)), 'the business is gone, sold, and what was left over came back: ' + (s.bank.log.find(l => /taken/.test(l.x)) || { x: '' }).x.slice(0, 90));
  check(s.bank.banks.oakbridge.seized === 1 && Sim.bankTerms(s, 'oakbridge', null).rate > t2.rate, 'and the next loan from that bank costs more');
  { // the books through a seizure: every coin that moves is booked to the bank or to interest
    at(s, 'oaksq'); s.coins = 3000; const pk = Sim.pledges(s)[0]; Sim.cmd(s, 'bankBorrow', Math.min(200, Math.floor(Sim.bankTerms(s, 'oakbridge', pk).max)), pk.kind + ':' + pk.id); const L2 = s.bank.loans[s.bank.loans.length - 1];
    L2.missed = 2; L2.next = s.day; s.coins = 5; const c0 = s.coins, b0 = s.stats.bank || 0, i0 = s.stats.interest || 0; Sim.bankDay(s);
    check(L2.status === 'seized' && Math.abs((s.coins - c0) - ((s.stats.bank - b0) - ((s.stats.interest || 0) - i0))) < 0.01, 'the ledger books every coin of a seizure (' + Math.round(s.coins - c0) + 'c back)'); }
  check(Sim.faults().length === faults55, 'no faults');
}
{
  // your own bank: deposits, loans, defaults; a run; and failing
  const at = (s, loc) => { const L = Sim.LOCS[loc === 'oaksq' ? 'bank:oakbridge' : loc]; s.player.x = L.x; s.player.z = L.z; };
  const ready = s => { Sim.setupBanks(s); s.village.standing = 80; s.coins = Math.max(s.coins, 60000); const K = s.bank.banks.oakbridge; K.repaid = 1; K.trust = 70; };
  const s = Sim.newGame(5502); s.coins = 6000; Sim.advance(s, 2); holdElections(s); at(s, 'ghgreen');
  const early = Sim.cmd(s, 'bankFound', 5000); check(!early.ok && /not ready/.test(early.msg), 'a newcomer with 6,000c cannot found a bank: ' + early.msg.slice(0, 70));
  ready(s); const k0 = s.coins;
  check(!Sim.cmd(s, 'bankFound', 1500).ok && Sim.cmd(s, 'bankFound', 5000).ok && s.coins === k0 - 10000 && Sim.bankIn(s, 'greenhaven'), 'a Merchant Prince a banker trusts can: 5,000c in its strongroom and a 5,000c royal charter');
  for (let d = 0; d < 60; d++) Sim.advance(s, 1440);
  const M = s.bank.mine, V = Sim.bankView(s).mine;
  check(M && M.deposits > 100 && (M.earned > 0) && M.loans.length > 0, 'in sixty days the town has saved ' + Math.round(M.deposits) + 'c with you, and you have lent to ' + new Set(M.loans.map(L => L.kind)).size + ' kinds of borrower');
  const worth = M.cash + M.loans.filter(L => L.status === 'open').reduce((a, L) => a + L.owed, 0) - M.deposits;
  check(worth > M.capital * 0.9 && worth < M.capital * 1.6, 'a careful bank makes a modest return: ' + Math.round(worth) + 'c on ' + M.capital + 'c in sixty days');
  check(s.ledger.every(e => Math.abs(e.unexplained || 0) < 0.01), 'your own ledger still adds up: the bank keeps its own books');
  // a run, met with coin
  M.trust = 10; M.cash = Math.round(M.deposits * 0.05); Sim.advance(s, 1440);
  check(M.run, 'with the strongroom nearly empty, people run on the bank');
  at(s, 'market'); check(!Sim.cmd(s, 'bankAdd', 1000).ok, 'coin goes into the strongroom in person, not from across the country');
  at(s, 'bank:greenhaven'); Sim.cmd(s, 'bankAdd', 1000); for (let d = 0; d < 3; d++) Sim.advance(s, 1440);
  check(s.bank.mine && !s.bank.mine.failed && !s.bank.mine.run, 'putting in coin sees it through');
  // a run left alone: the bank fails
  const g = Sim.newGame(5503); g.coins = 6000; Sim.advance(g, 2); holdElections(g); at(g, 'ghgreen'); ready(g); Sim.cmd(g, 'bankFound', 5000); for (let d = 0; d < 30; d++) Sim.advance(g, 1440);
  const G = g.bank.mine, m0 = g.folk.moral; G.cash = 1; G.trust = 0; G.loans = []; G.deposits = Math.max(G.deposits, 300); let d = 0; while (g.bank.mine && d < 10) { Sim.advance(g, 1440); d++; }
  check(!g.bank.mine && g.bank.past.length === 1 && g.folk.moral < m0 - 10, 'left alone, the run empties it and the bank fails, and your name suffers for it');
  // buying a bank: in person, at a great price, and then it is yours to walk into
  const b = Sim.newGame(5505); b.coins = 6000; Sim.advance(b, 2); holdElections(b); ready(b); at(b, 'bank:oakbridge');
  const price = Sim.bankPrice(b, 'oakbridge'), c0 = b.coins; check(price >= 15000 && Sim.cmd(b, 'bankBuy').ok && b.coins === c0 - price && b.bank.mine.town === 'oakbridge' && !b.bank.banks.oakbridge && Sim.bankView(b).atMine, 'buying the Alder Bank costs ' + price + 'c, and then it is yours');
}
{
  // the crown in your debt
  const at = (s, loc) => { const L = Sim.LOCS[loc === 'oaksq' ? 'bank:oakbridge' : loc]; s.player.x = L.x; s.player.z = L.z; };
  const ready = s => { Sim.setupBanks(s); s.village.standing = 80; s.coins = Math.max(s.coins, 60000); const K = s.bank.banks.oakbridge; K.repaid = 1; K.trust = 70; };
  const s = Sim.newGame(5504); s.coins = 9000; Sim.advance(s, 2); holdElections(s); at(s, 'ghgreen'); ready(s); Sim.cmd(s, 'bankFound', 5000);
  const M = s.bank.mine; M.loans.push({ id: 900, pid: 'crown', who: 'the crown of Alderwyn', kind: 'crown', amount: 1200, owed: 1200, rate: 0.008, due: s.day + 10, risk: 0, status: 'open', day: s.day });
  check(!Sim.cmd(s, 'bankRansom', 'seat').ok, 'under 1,500c owed, the crown will not bargain');
  M.loans[M.loans.length - 1].owed = 1600; const king = s.people[s.realm.king], op = king.opinion || 0;
  const r = Sim.cmd(s, 'bankRansom', 'seat', 'trade');
  check(r.ok && s.realm.council.trade === 'player' && Sim.crownOwes(s) === null && (king.opinion || 0) < op, 'at 1,600c, the crown names you Master of Trade to clear it, and the king resents it');
  M.loans.push({ id: 901, pid: 'crown', who: 'the crown of Alderwyn', kind: 'crown', amount: 1500, owed: 1700, rate: 0.008, due: s.day + 10, risk: 0, status: 'open', day: s.day });
  const t0 = s.realm.treasury, ks = s.realm.kingSupport; Sim.cmd(s, 'bankRansom', 'call');
  check(s.realm.treasury === t0 - 1700 && s.realm.kingSupport < ks && (king.hate || 0) > 0, 'calling it in empties the treasury and makes the king your enemy');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
