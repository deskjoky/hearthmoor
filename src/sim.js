/* Hearthmoor simulation core (v2).
   Pure game logic: no rendering, no DOM, no Math.random. The whole game state is plain JSON,
   so it can be saved, restored and tested headless. */
(function (root) {
  'use strict';

  const VERSION = 2;
  const DAY = 1440;
  const CARRY = 20;
  const SERVE_MIN = 3;
  const PATIENCE = 45;
  const LEARN_SHIFTS = 2;
  const GOODS = ['grain', 'wood', 'ore'];

  /* ---------- trades ---------- */
  const TRADES = {
    bakery: {
      name: 'Bakery', craft: 'Bake', crafting: 'Baking', station: 'oven', product: 'bread', one: 'loaf', many: 'loaves',
      recipe: { grain: 2, wood: 1 }, wtp: 6, sd: 1.4, price: 5, villagerRate: 0.85, qty2: 0.35, qty3: 0, hours: [8, 18],
      tiers: [
        { name: 'Bread Stand', out: 4, min: 60, cap: 12, travelers: 3, upkeep: 1, cost: { coin: 30 } },
        { name: 'Timber Bakery', out: 6, min: 50, cap: 24, travelers: 5, upkeep: 3, cost: { coin: 80, wood: 12 } },
        { name: 'Stone Bakery', out: 8, min: 40, cap: 40, travelers: 8, upkeep: 6, cost: { coin: 200, wood: 25 } }
      ]
    },
    smithy: {
      name: 'Smithy', craft: 'Forge', crafting: 'Forging', station: 'forge', product: 'tools', one: 'tool', many: 'tools',
      recipe: { ore: 2, wood: 2 }, wtp: 22, sd: 5, price: 18, villagerRate: 0.3, qty2: 0, qty3: 0, hours: [8, 18],
      tiers: [
        { name: "Smith's Table", out: 1, min: 60, cap: 8, travelers: 2, upkeep: 2, cost: { coin: 60, ore: 4 } },
        { name: 'Timber Forge', out: 2, min: 55, cap: 16, travelers: 3, upkeep: 4, cost: { coin: 150, wood: 15 } },
        { name: 'Stone Forge', out: 3, min: 50, cap: 24, travelers: 5, upkeep: 8, cost: { coin: 320, ore: 20 } }
      ]
    },
    tavern: {
      name: 'Tavern', craft: 'Brew', crafting: 'Brewing', station: 'kettle', product: 'ale', one: 'mug of ale', many: 'mugs of ale',
      recipe: { grain: 3, wood: 1 }, wtp: 4.5, sd: 1.2, price: 3, villagerRate: 0.75, qty2: 0.45, qty3: 0.2, hours: [14, 21],
      tiers: [
        { name: 'Ale Stall', out: 6, min: 60, cap: 18, travelers: 3, upkeep: 1, cost: { coin: 40 } },
        { name: 'Taproom', out: 9, min: 50, cap: 36, travelers: 6, upkeep: 4, cost: { coin: 120, wood: 15 } },
        { name: 'Great Hall Tavern', out: 12, min: 40, cap: 60, travelers: 10, upkeep: 8, cost: { coin: 280, wood: 30 } }
      ]
    },
    joinery: {
      name: 'Joinery', craft: 'Build', crafting: 'Building', station: 'bench', product: 'furniture', one: 'stool', many: 'stools',
      recipe: { wood: 4 }, wtp: 14, sd: 3, price: 11, villagerRate: 0.3, qty2: 0, qty3: 0, hours: [8, 18],
      tiers: [
        { name: "Carpenter's Bench", out: 1, min: 45, cap: 8, travelers: 2, upkeep: 1, cost: { coin: 25 } },
        { name: 'Timber Workshop', out: 2, min: 45, cap: 16, travelers: 3, upkeep: 3, cost: { coin: 90, wood: 15 } },
        { name: 'Joinery Hall', out: 3, min: 40, cap: 24, travelers: 5, upkeep: 6, cost: { coin: 220, wood: 30 } }
      ]
    }
  };
  const TRADE_KEYS = Object.keys(TRADES);

  /* ---------- the map ---------- */
  const PLOTS = [{ x: -12, z: -2, name: 'West lot' }, { x: 0, z: -2, name: 'Middle lot' }, { x: 12, z: -2, name: 'East lot' }];
  const REL = { serve: { x: 0, z: 0.4 }, queue0: { x: 0, z: 2.6 }, station: { x: -2.3, z: -0.8 }, store: { x: 2.4, z: -0.6 }, bench: { x: 3.9, z: 2.4 } };
  const EMPLOYERS = [
    { id: 'gerd', trade: 'bakery', name: "Gerd's Bakehouse", boss: 'Gerd', x: -15, z: 16, shift: [6, 12], wage: 6 },
    { id: 'forge', trade: 'smithy', name: "Hollin's Forge", boss: 'Hollin', x: -5, z: 16, shift: [8, 14], wage: 8 },
    { id: 'tankard', trade: 'tavern', name: 'The Crooked Tankard', boss: 'Mother Ysolde', x: 5, z: 16, shift: [15, 21], wage: 6 },
    { id: 'ash', trade: 'joinery', name: 'Ash & Sons Joinery', boss: 'Ash', x: 15, z: 16, shift: [9, 15], wage: 7 }
  ];
  EMPLOYERS.forEach(e => { e.spot = { x: e.x + 2.3, z: e.z + 0.8 }; e.front = { x: e.x, z: e.z - 3.2 }; }); // their shops face the square, so the workstation is mirrored
  const LOCS = {
    field: { x: 24, z: -12, r: 6.5, name: 'Wheat Field' },
    forest: { x: -24, z: -14, r: 7, name: 'Pine Woods' },
    pit: { x: -24, z: 20, r: 5, name: 'Iron Pit' },
    market: { x: 25, z: 13, r: 3.8, name: 'Trading Post' },
    home: { x: -19, z: 6, r: 3, name: 'Your Hut' },
    well: { x: 6, z: 8, r: 2, name: 'Village Well' }
  };
  PLOTS.forEach((p, i) => { LOCS['plot' + i] = { x: p.x, z: p.z, r: 4.6, name: p.name, plot: i }; });
  EMPLOYERS.forEach(e => { LOCS['emp:' + e.id] = { x: e.x, z: e.z - 1.5, r: 3.8, name: e.name, emp: e.id }; });
  const P = {
    market: { x: 23.4, z: 11.6 }, well: { x: 6, z: 9.4 }, plaza: { x: 0, z: 8 },
    road: { x: 34, z: 5 }, home: { x: -17.1, z: 5.4 }
  };
  const HOMES = [{ x: -27, z: 4 }, { x: -12, z: -24 }, { x: 3, z: -25 }, { x: 15, z: -25 }, { x: 30, z: -4 }, { x: -10, z: 27 }];
  const WORKER_HOMES = [{ x: 6, z: 27 }, { x: 18, z: 24 }, { x: -30, z: -6 }];
  const VILLAGERS = [
    { name: 'Aldric', job: 'field' }, { name: 'Maren', job: 'field' }, { name: 'Tobin', job: 'forest' },
    { name: 'Edda', job: 'pit' }, { name: 'Wynn', job: 'market' }, { name: 'Old Sela', job: 'well' }
  ];
  const TRAVELERS = ['A pilgrim', 'A tinker', 'A drover', 'A peddler', 'A soldier', 'A minstrel', 'A shepherd', 'A friar'];
  const APPLICANTS = ['Hilda', 'Bram', 'Osric', 'Linnet', 'Cade', 'Freya', 'Rolf', 'Agnes', 'Piers', 'Wenna', 'Garth', 'Isolde'];

  const BUY = { grain: 2, wood: 2, ore: 3 };
  const SELL = { grain: 1, wood: 1, ore: 1 };
  const GATHER = { grain: { min: 30, n: 2, loc: 'field' }, wood: { min: 40, n: 2, loc: 'forest' }, ore: { min: 50, n: 2, loc: 'pit' } };

  const GOALS = [
    { id: 'job', text: 'Ask for work at one of the four shops across the square', done: s => s.rec.jobsHeld > 0 },
    { id: 'learn', text: 'Work ' + LEARN_SHIFTS + ' full shifts to learn that trade', done: s => TRADE_KEYS.some(t => learned(s, t)) },
    { id: 'open', text: 'Save up and open your own shop on an empty lot', done: s => s.rec.shopsOpened > 0 },
    { id: 'sell', text: 'Sell 10 goods from your own shop', done: s => s.rec.goodsSold >= 10 },
    { id: 'hire', text: 'Hire a worker for your shop', done: s => s.rec.workersHired > 0 },
    { id: 'two', text: 'Own two businesses', done: s => s.shops.length >= 2 },
    { id: 'top', text: 'Upgrade a shop to its finest building', done: s => s.shops.some(x => x.tier >= 2) }
  ];

  /* ---------- helpers ---------- */
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function normal(s, mean, sd) {
    const u = Math.max(1e-9, rand(s)), v = rand(s);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const minuteOfDay = t => ((t % DAY) + DAY) % DAY;
  const hourOf = s => minuteOfDay(s.t) / 60;
  function clock(t) {
    const m = Math.floor(minuteOfDay(t));
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function hm(min) { const m = Math.round(min); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; }
  function moveTo(a, tx, tz, step, s) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d <= step || d < 0.05) { if (s) s.rec.walked += d; a.x = tx; a.z = tz; a.moving = false; return true; }
    a.x += dx / d * step; a.z += dz / d * step; a.face = Math.atan2(dx, dz); a.moving = true;
    if (s) s.rec.walked += step;
    return false;
  }
  function event(s, text, kind) {
    s.events.push({ t: s.t, text, kind: kind || 'info' });
    if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
  }
  const carried = s => GOODS.reduce((a, g) => a + s.player.inv[g], 0);
  const agentById = (s, id) => s.agents.find(a => a.id === id);
  const shopById = (s, id) => s.shops.find(x => x.id === id);
  const shopOnPlot = (s, i) => s.shops.find(x => x.plot === i);
  const tierOf = shop => TRADES[shop.trade].tiers[shop.tier];
  const plotPt = (shop, k) => ({ x: PLOTS[shop.plot].x + REL[k].x, z: PLOTS[shop.plot].z + REL[k].z });
  const queueSlot = (shop, i) => { const q = plotPt(shop, 'queue0'); return { x: q.x, z: q.z + i * 1.0 }; };
  const empById = id => EMPLOYERS.find(e => e.id === id);
  function learned(s, trade) { return s.trades[trade] >= LEARN_SHIFTS; }
  function tradeSpeed(s, trade) { return 1 + Math.min(0.3, s.trades[trade] * 0.03); }
  function shopLabel(shop) { return tierOf(shop).name + ', ' + PLOTS[shop.plot].name; }
  function wtpMean(shop, traveler) { const T = TRADES[shop.trade]; return T.wtp * (1 + 0.08 * shop.tier + (traveler ? 0.08 : 0)); }
  function earn(s, n) { s.coins += n; s.rec.coinsEarned += n; }
  function spend(s, n) { s.coins -= n; s.rec.coinsSpent += n; }
  function goodsName(trade, n) { const T = TRADES[trade]; return n + ' ' + (n === 1 ? T.one : T.many); }
  function recipeText(trade) { const r = TRADES[trade].recipe; return Object.keys(r).map(g => r[g] + ' ' + g).join(' + '); }
  function costText(c) { return [c.coin ? c.coin + 'c' : null].concat(GOODS.filter(g => c[g]).map(g => c[g] + ' ' + g)).filter(Boolean).join(' and '); }

  function freshShopStats(shop) {
    return {
      id: shop.id, trade: shop.trade, price: shop.price, sold: 0, revenue: 0, served: 0, tooExpensive: 0, soldOut: 0, noService: 0,
      noServiceWhy: {}, supplies: 0, wages: 0, upkeep: 0, upkeepUnpaid: 0, idleAt: null, fullAt: null, batches: 0,
      batchesBy: { player: 0, worker: 0 }, servedBy: { player: 0, worker: 0 }, playerMin: 0, workerMin: 0
    };
  }
  function freshStats(s) {
    const st = { day: s.day, shops: {}, jobPay: 0, rawSales: 0, marketBuys: 0, notes: [] };
    s.shops.forEach(x => { st.shops[x.id] = freshShopStats(x); });
    return st;
  }
  const shopStats = (s, shop) => s.stats.shops[shop.id] || (s.stats.shops[shop.id] = freshShopStats(shop));

  function freshRecords() {
    return {
      coinsEarned: 0, coinsSpent: 0, wagesEarned: 0, rawSales: 0, bestDay: null, worstDay: null,
      made: { bread: 0, tools: 0, ale: 0, furniture: 0 }, sold: { bread: 0, tools: 0, ale: 0, furniture: 0 }, goodsSold: 0, salesRevenue: 0,
      served: 0, lost: 0, lostPrice: 0, gathered: { grain: 0, wood: 0, ore: 0 }, walked: 0,
      workersHired: 0, workersLetGo: 0, workersQuit: 0, wagesPaid: 0,
      shopsOpened: 0, upgrades: 0, invested: 0, jobsHeld: 0, shiftsWorked: 0, shiftsMissed: 0, timesFired: 0, jobsQuit: 0,
      peakCoins: 0, days: 0
    };
  }

  /* ---------- new game ---------- */
  function newGame(seed, name) {
    const s = {
      v: VERSION, t: 6 * 60, day: 1, rng: (seed | 0) || 12345, coins: 5, name: name || 'Wren',
      player: { x: P.home.x, z: P.home.z, face: 0, dest: null, action: null, inv: { grain: 0, wood: 0, ore: 0 } },
      shops: [], nextShop: 1, job: null, trades: { bakery: 0, smithy: 0, tavern: 0, joinery: 0 },
      agents: [], nextId: 1, schedule: [], applicants: [], ledger: [], events: [], rec: freshRecords(), stats: null
    };
    VILLAGERS.forEach((v, i) => {
      const home = HOMES[i];
      s.agents.push({
        id: s.nextId++, kind: 'villager', name: v.name, job: v.job, home, x: home.x, z: home.z + 1.5, face: 0,
        spot: jobSpot(s, v.job), mode: 'routine', phase: null, doing: 'Waking up', icon: null, iconUntil: 0, palette: i
      });
    });
    openDay(s);
    event(s, 'Day 1. You arrive in Hearthmoor with 5 coins. The four shops across the square are hiring.', 'story');
    return s;
  }

  function jobSpot(s, job) {
    const j = () => (rand(s) - 0.5);
    if (job === 'field') return { x: LOCS.field.x + j() * 8, z: LOCS.field.z + j() * 6 };
    if (job === 'forest') return { x: LOCS.forest.x + 3 + j() * 5, z: LOCS.forest.z + 2 + j() * 5 };
    if (job === 'pit') return { x: LOCS.pit.x + j() * 4, z: LOCS.pit.z + j() * 3 };
    if (job === 'market') return { x: LOCS.market.x + 1.6, z: LOCS.market.z - 0.6 };
    return { x: P.well.x + 1.2, z: P.well.z + 0.4 };
  }

  /* ---------- day cycle ---------- */
  function openDay(s) {
    s.day = Math.floor((s.t - 360) / DAY) + 1;
    s.stats = freshStats(s);
    const base = s.t - minuteOfDay(s.t);
    const sched = [];
    for (const shop of s.shops) {
      const T = TRADES[shop.trade], Ti = tierOf(shop);
      const [o, c] = T.hours;
      const when = () => base + (o + rand(s) * (c - o - 0.6)) * 60;
      s.agents.filter(a => a.kind === 'villager').forEach(a => { if (rand(s) < T.villagerRate) sched.push({ at: when(), id: a.id, shop: shop.id }); });
      const n = Math.max(0, Ti.travelers + Math.floor(rand(s) * 3) - 1);
      for (let i = 0; i < n; i++) sched.push({ at: when(), id: null, shop: shop.id });
    }
    sched.sort((a, b) => a.at - b.at);
    s.schedule = sched;
    makeApplicants(s);
    if (s.day > 1) event(s, 'Day ' + s.day + ' begins.', 'story');
  }

  function makeApplicants(s) {
    s.applicants = [];
    const taken = s.shops.filter(x => x.worker).map(x => x.worker.name);
    for (let i = 0; i < 2; i++) {
      const skill = Math.round((0.7 + rand(s) * 0.6) * 100) / 100;
      const ask = Math.round(3 + skill * 6);
      let name, guard = 0;
      do { name = APPLICANTS[Math.floor(rand(s) * APPLICANTS.length)]; guard++; } while ((s.applicants.some(a => a.name === name) || taken.includes(name)) && guard < 50);
      s.applicants.push({ name, skill, ask });
    }
  }
  function skillLabel(skill) { return skill < 0.85 ? 'Slow but cheap' : skill < 1.1 ? 'Steady' : 'Quick hands'; }

  function closeDay(s) {
    const st = s.stats;
    const entry = { day: st.day, shops: [], jobPay: st.jobPay, rawSales: st.rawSales, marketBuys: st.marketBuys, notes: st.notes.slice() };
    for (const shop of s.shops) {
      const ss = shopStats(s, shop), Ti = tierOf(shop), w = shop.worker;
      if (w) {
        const paid = Math.min(s.coins, w.wage);
        spend(s, paid); ss.wages += paid; s.rec.wagesPaid += paid;
        const full = paid >= w.wage;
        if (!full) { w.mood -= 25; w.unpaid = (w.unpaid || 0) + 1; }
        else { w.unpaid = 0; w.mood += w.wage >= w.ask ? 6 + Math.min(6, (w.wage - w.ask) * 2) : -(w.ask - w.wage) * 7; }
        w.mood = clamp(w.mood, 0, 100);
        ss.workerPaid = full; ss.workerName = w.name; ss.workerMood = Math.round(w.mood);
      }
      const up = Math.min(s.coins, Ti.upkeep);
      spend(s, up); ss.upkeep = up; ss.upkeepUnpaid = Ti.upkeep - up;
      const e = Object.assign({}, ss, { label: shopLabel(shop), tierName: Ti.name });
      e.costs = e.supplies + e.wages + e.upkeep; e.profit = e.revenue - e.costs;
      e.notes = explainShop(s, shop, e);
      entry.shops.push(e);
    }
    entry.income = entry.shops.reduce((a, e) => a + e.revenue, 0) + entry.jobPay + entry.rawSales;
    entry.costs = entry.shops.reduce((a, e) => a + e.costs, 0) + entry.marketBuys;
    entry.profit = entry.income - entry.costs;
    if (!entry.shops.length && !entry.notes.length) {
      entry.notes.push({ text: s.job ? 'Wages from your job are your income for now. Save up for a shop of your own.' : 'Ask for work at one of the shops across the square to start earning.' });
    }
    entry.coinsEnd = s.coins;
    s.ledger.push(entry);
    if (s.ledger.length > 14) s.ledger.shift();
    s.rec.days++;
    if (!s.rec.bestDay || entry.profit > s.rec.bestDay.profit) s.rec.bestDay = { profit: entry.profit, day: entry.day };
    if (!s.rec.worstDay || entry.profit < s.rec.worstDay.profit) s.rec.worstDay = { profit: entry.profit, day: entry.day };
    event(s, 'Books closed for Day ' + entry.day + ': ' + (entry.profit >= 0 ? 'up ' : 'down ') + Math.abs(entry.profit) + 'c. Open the ledger to see why.', entry.profit >= 0 ? 'good' : 'bad');

    for (const shop of s.shops) {
      const w = shop.worker;
      if (!w) continue;
      if (w.mood < 15) {
        if (w.warned) {
          event(s, w.name + ' has quit the ' + TRADES[shop.trade].name.toLowerCase() + '. Pay was too low or late.', 'bad');
          const e = entry.shops.find(x => x.id === shop.id);
          if (e) e.notes.push({ text: w.name + ' quit after a second miserable day. Workers expect at least their asking wage, paid on time.' });
          shop.worker = null; s.rec.workersQuit++;
        } else { w.warned = true; event(s, w.name + ' is miserable and may quit tomorrow.', 'bad'); }
      } else w.warned = false;
    }
    for (const shop of s.shops) {
      shop.queue.slice().forEach(id => { const a = agentById(s, id); if (a) leaveShop(s, a, shop, null); });
      shop.queue = [];
    }
  }

  /* ---------- ledger explanations ---------- */
  const WHY = {
    nobodyAtCounter: 'nobody was at the counter', youCrafting: 'you were busy at the workstation', youAway: 'you were away from the shop',
    workerCrafting: 'your worker was at the workstation', workerErrand: 'your worker was out buying supplies', workerLunch: 'your worker was on a break'
  };
  function explainShop(s, shop, e) {
    const notes = [], T = TRADES[shop.trade], Ti = tierOf(shop);
    const mean = wtpMean(shop, false), lo = Math.round(mean - T.sd * 0.7), hi = Math.round(mean + T.sd * 0.3);
    const cust = n => n + (n === 1 ? ' customer' : ' customers');
    if (e.soldOut > 0) {
      let t = cust(e.soldOut) + ' found no ' + T.product + ' on the shelf.';
      if (e.idleAt) t += ' Work stopped at ' + e.idleAt + ' because storage ran out of ' + recipeText(shop.trade).replace(/\d+ /g, '') + '.';
      else t += ' Make a batch earlier so stock is ready when people arrive.';
      const n = { text: t };
      if (e.idleAt && shop.worker && !shop.policy.supplyRuns) n.fix = { label: 'Let ' + shop.worker.name + ' buy supplies', cmd: ['policy', shop.id, 'supplyRuns', true] };
      notes.push(n);
    }
    if (e.tooExpensive > 0) {
      const n = { text: cust(e.tooExpensive) + ' walked away at ' + e.price + 'c. Most people here will pay about ' + lo + '–' + hi + 'c for ' + T.product + '.' };
      if (e.price > hi) n.fix = { label: 'Set price to ' + Math.max(1, Math.round(mean - T.sd * 0.4)) + 'c', cmd: ['setPrice', shop.id, Math.max(1, Math.round(mean - T.sd * 0.4))] };
      notes.push(n);
    }
    if (e.noService > 0) {
      const causes = Object.keys(e.noServiceWhy).sort((a, b) => e.noServiceWhy[b] - e.noServiceWhy[a]).map(k => WHY[k] || k);
      const n = { text: cust(e.noService) + ' gave up waiting because ' + causes.join(', or ') + '.' };
      if (!shop.worker) n.fix = { label: 'Hire help', cmd: ['page', 'staff'] };
      notes.push(n);
    }
    if (e.fullAt && e.sold > 0) notes.push({ text: 'Shelves were full at ' + e.fullAt + ', so no more could be made. A bigger building holds more.' });
    const unit = Object.keys(T.recipe).reduce((a, g) => a + T.recipe[g] * BUY[g], 0) / Ti.out;
    if (e.price <= unit) notes.push({ text: 'At ' + e.price + 'c you barely cover bought supplies (about ' + unit.toFixed(1) + 'c each).' });
    if (e.profit < 0) notes.push({ text: 'This shop lost ' + (-e.profit) + 'c: costs of ' + e.costs + 'c (supplies ' + e.supplies + 'c, wages ' + e.wages + 'c, upkeep ' + e.upkeep + 'c) against ' + e.revenue + 'c of sales.' });
    if (e.upkeepUnpaid > 0) notes.push({ text: 'You could not cover ' + e.upkeepUnpaid + 'c of upkeep. Nothing was taken from you, but earn some coin before tomorrow.' });
    const w = shop.worker;
    if (w && e.workerName) {
      if (e.workerPaid === false) notes.push({ text: w.name + ' was not paid in full and is upset. Keep at least ' + w.wage + 'c by closing time.' });
      else if (w.wage < w.ask) notes.push({ text: w.name + ' asked for ' + w.ask + 'c a day but gets ' + w.wage + 'c. Mood is falling (' + Math.round(w.mood) + '/100).', fix: { label: 'Pay ' + w.ask + 'c a day', cmd: ['setWage', shop.id, w.ask] } });
      if (w.mood < 30) notes.push({ text: w.name + ' is unhappy and works about 30% slower.' });
    }
    if (e.batches === 0 && e.sold === 0) notes.push({ text: 'Nothing was made here today. Store ' + recipeText(shop.trade) + ' and ' + T.craft.toLowerCase() + ' at the ' + T.station + '.' });
    if (!notes.length && e.profit > 0) notes.push({ text: 'A good day. Everyone who wanted ' + T.product + ' at your price got some.' });
    return notes;
  }

  /* ---------- customers and villagers ---------- */
  function spawnScheduled(s) {
    while (s.schedule.length && s.schedule[0].at <= s.t) {
      const e = s.schedule.shift();
      const shop = shopById(s, e.shop);
      if (!shop) continue;
      const T = TRADES[shop.trade];
      let a;
      if (e.id == null) {
        a = {
          id: s.nextId++, kind: 'traveler', name: TRAVELERS[Math.floor(rand(s) * TRAVELERS.length)],
          x: P.road.x, z: P.road.z + (rand(s) - 0.5) * 3, face: -Math.PI / 2, mode: 'shop', phase: 'toShop',
          doing: 'Looking for ' + T.product, icon: null, iconUntil: 0, palette: 6 + Math.floor(rand(s) * 4)
        };
        a.wtp = clamp(normal(s, wtpMean(shop, true), T.sd), 1, T.wtp * 3);
        s.agents.push(a);
      } else {
        a = agentById(s, e.id);
        if (!a) continue;
        if (a.mode === 'shop') { e.at = s.t + 60; insertSched(s, e); continue; }
        a.mode = 'shop'; a.phase = 'toShop';
        a.wtp = clamp(normal(s, wtpMean(shop, false), T.sd), 1, T.wtp * 3);
      }
      a.shop = shop.id;
      const r = rand(s);
      a.qty = r < T.qty3 ? 3 : r < T.qty3 + T.qty2 ? 2 : 1;
      a.doing = 'Going to buy ' + T.product;
    }
  }
  function insertSched(s, e) {
    const i = s.schedule.findIndex(x => x.at > e.at);
    if (i < 0) s.schedule.push(e); else s.schedule.splice(i, 0, e);
  }

  function canProduce(shop) {
    const r = TRADES[shop.trade].recipe;
    return shop.work.loaded || Object.keys(r).every(g => shop.stock[g] >= r[g]);
  }

  function noServiceCause(s, shop) {
    const w = shop.worker;
    if (w && w.task === 'craft') return 'workerCrafting';
    if (w && w.task === 'supply') return 'workerErrand';
    if (w && w.task === 'lunch') return 'workerLunch';
    const p = s.player;
    if (p.action && p.action.type === 'craft' && p.action.shop === shop.id) return 'youCrafting';
    if (dist(p, PLOTS[shop.plot]) > 4.6) return 'youAway';
    return 'nobodyAtCounter';
  }

  function leaveShop(s, a, shop, reason) {
    const st = shop ? shopStats(s, shop) : null;
    if (st && reason === 'tooExpensive') { st.tooExpensive++; a.icon = 'angry'; s.rec.lost++; s.rec.lostPrice++; }
    else if (st && reason === 'soldOut') { st.soldOut++; a.icon = 'angry'; s.rec.lost++; }
    else if (st && reason === 'noService') {
      st.noService++; a.icon = 'angry'; s.rec.lost++;
      const k = noServiceCause(s, shop); st.noServiceWhy[k] = (st.noServiceWhy[k] || 0) + 1;
    } else if (reason === 'served') a.icon = 'happy';
    else a.icon = null;
    a.iconUntil = s.t + 50;
    if (shop) { const qi = shop.queue.indexOf(a.id); if (qi >= 0) shop.queue.splice(qi, 1); }
    if (a.kind === 'traveler') { a.mode = 'shop'; a.phase = 'leave'; a.doing = 'Leaving the village'; }
    else { a.mode = 'routine'; a.phase = null; }
    a.lastReason = reason; a.shop = null;
  }

  function updateShopper(s, a, dt) {
    const speed = 1.0 * dt;
    if (a.phase === 'leave') { if (moveTo(a, P.road.x, P.road.z, speed * 1.2)) a.gone = true; return; }
    const shop = shopById(s, a.shop);
    if (!shop) { leaveShop(s, a, null, null); return; }
    const T = TRADES[shop.trade];
    if (a.phase === 'toShop') {
      const slot = queueSlot(shop, shop.queue.length);
      if (moveTo(a, slot.x, slot.z, speed)) {
        if (shop.price > a.wtp) {
          leaveShop(s, a, shop, 'tooExpensive');
          if (shopStats(s, shop).tooExpensive <= 2) event(s, a.name + ' thought ' + shop.price + 'c was too much for ' + T.product + '.', 'bad');
        } else if (shop.goods <= 0 && !canProduce(shop)) {
          leaveShop(s, a, shop, 'soldOut');
          event(s, a.name + ' found no ' + T.product + ' and left.', 'bad');
        } else { shop.queue.push(a.id); a.phase = 'queue'; a.patience = PATIENCE; a.icon = 'wait'; }
      }
    } else if (a.phase === 'queue') {
      const idx = shop.queue.indexOf(a.id);
      if (idx < 0) { a.phase = 'toShop'; return; }
      const slot = queueSlot(shop, idx);
      moveTo(a, slot.x, slot.z, speed);
      a.patience -= dt;
      a.doing = 'Waiting for ' + T.product + ' (' + Math.max(0, Math.round(a.patience)) + ' min of patience left)';
      if (a.patience <= 0) {
        const reason = shop.goods <= 0 ? 'soldOut' : 'noService';
        const why = WHY[noServiceCause(s, shop)];
        leaveShop(s, a, shop, reason);
        event(s, a.name + (reason === 'soldOut' ? ' gave up: no ' + T.product + '.' : ' gave up waiting: ' + why + '.'), 'bad');
      }
    }
  }

  function villagerRoutine(s, a, dt) {
    const h = hourOf(s);
    let tgt, doing, working = false;
    if (h < 6 || h >= 21) { tgt = a.home; doing = 'Asleep'; }
    else if (h < 7) { tgt = a.spot; doing = 'Walking to work'; }
    else if (h < 12 || (h >= 13 && h < 17)) { tgt = a.spot; doing = jobDoing(a.job); working = true; }
    else if (h < 13) { tgt = { x: P.well.x + ((a.id % 3) - 1) * 1.2, z: P.well.z + 1 }; doing = 'Lunch by the well'; }
    else { tgt = { x: P.plaza.x + ((a.id % 4) - 1.5) * 1.4, z: P.plaza.z + ((a.id % 2) ? 1.2 : -1) }; doing = 'Chatting in the square'; }
    const arrived = moveTo(a, tgt.x, tgt.z, 0.9 * dt);
    a.doing = arrived ? doing : (doing === 'Asleep' ? 'Heading home' : doing.startsWith('Walking') ? doing : 'On the way: ' + doing.toLowerCase());
    a.working = arrived && working;
    a.indoors = arrived && doing === 'Asleep';
  }
  function jobDoing(job) {
    return { field: 'Reaping wheat', forest: 'Felling pines', pit: 'Digging iron ore', market: 'Trading at the post', well: 'Drawing water' }[job] || 'Working';
  }

  function updateAgents(s, dt) {
    for (const a of s.agents) {
      if (a.icon && s.t > a.iconUntil && a.icon !== 'wait') a.icon = null;
      a.indoors = false;
      if (a.mode === 'shop') updateShopper(s, a, dt);
      else villagerRoutine(s, a, dt);
    }
    if (s.agents.some(a => a.gone)) s.agents = s.agents.filter(a => !a.gone);
  }

  /* ---------- workstation and counter ---------- */
  function workStep(s, shop, dt, speed, who) {
    const w = shop.work, T = TRADES[shop.trade], Ti = tierOf(shop), st = shopStats(s, shop);
    if (!w.loaded) {
      if (shop.goods + Ti.out > Ti.cap) { if (!st.fullAt) st.fullAt = clock(s.t); return 'full'; }
      if (!canProduce(shop)) { if (!st.idleAt) st.idleAt = clock(s.t); return 'empty'; }
      for (const g in T.recipe) shop.stock[g] -= T.recipe[g];
      w.loaded = true; w.progress = 0; w.need = Ti.min;
    }
    w.progress += dt * speed;
    if (w.progress >= w.need) {
      w.loaded = false; w.progress = 0;
      shop.goods += Ti.out;
      st.batches++; st.batchesBy[who]++;
      s.rec.made[T.product] += Ti.out;
      event(s, (who === 'player' ? 'You' : shop.worker.name) + ' made ' + goodsName(shop.trade, Ti.out) + '.', 'good');
      return 'done';
    }
    return 'working';
  }

  function playerAttending(s, shop) {
    const p = s.player;
    return !p.dest && !p.action && dist(p, plotPt(shop, 'serve')) < 0.8;
  }
  function workerAttending(shop) {
    const w = shop.worker;
    return !!w && (w.task === 'serve' || w.task === 'tend') && dist(w, plotPt(shop, 'serve')) < 0.8;
  }
  function workerSpeed(w) { return w.skill * (w.mood < 30 ? 0.7 : 1); }

  function updateCounter(s, shop, dt) {
    const pa = playerAttending(s, shop), wa = workerAttending(shop), st = shopStats(s, shop);
    if (pa) st.playerMin += dt;
    if (!shop.queue.length) { shop.serveProgress = 0; return; }
    const front = agentById(s, shop.queue[0]);
    if (!front) { shop.queue.shift(); return; }
    if (front.phase !== 'queue' || dist(front, plotPt(shop, 'queue0')) > 0.6 || shop.goods <= 0) return;
    const speed = Math.max(pa ? 1 : 0, wa ? workerSpeed(shop.worker) : 0);
    if (speed <= 0) return;
    shop.serveProgress += dt * speed;
    if (shop.serveProgress >= SERVE_MIN) {
      const T = TRADES[shop.trade];
      const qty = Math.min(front.qty, shop.goods), coin = qty * shop.price;
      shop.goods -= qty; earn(s, coin);
      st.sold += qty; st.revenue += coin; st.served++; st.servedBy[pa ? 'player' : 'worker']++;
      s.rec.sold[T.product] += qty; s.rec.goodsSold += qty; s.rec.salesRevenue += coin; s.rec.served++;
      shop.serveProgress = 0;
      leaveShop(s, front, shop, 'served');
      event(s, front.name + ' bought ' + goodsName(shop.trade, qty) + ' for ' + coin + 'c.', 'coin');
    }
  }

  /* ---------- the player ---------- */
  function jobSpotOf(s) { return s.job ? empById(s.job.emp).spot : null; }
  function inShift(s) {
    if (!s.job) return false;
    const e = empById(s.job.emp), h = hourOf(s);
    return h >= e.shift[0] && h < e.shift[1];
  }
  function playerAtWork(s) {
    const p = s.player, spot = jobSpotOf(s);
    return !!spot && !p.dest && !p.action && dist(p, spot) < 1.2;
  }

  function updatePlayer(s, dt) {
    const p = s.player;
    p.working = false;
    if (p.dest) {
      if (moveTo(p, p.dest.x, p.dest.z, 1.5 * dt, s)) { const then = p.dest.then; p.dest = null; if (then) beginAction(s, then); }
      return;
    }
    p.moving = false;
    if (s.job && inShift(s) && playerAtWork(s)) { s.job.workedMin += dt; p.working = true; p.face = Math.PI; }
    const a = p.action;
    if (!a) return;
    if (a.type === 'craft') {
      const shop = shopById(s, a.shop);
      if (!shop) { p.action = null; return; }
      shopStats(s, shop).playerMin += dt;
      const r = workStep(s, shop, dt, tradeSpeed(s, shop.trade), 'player');
      if (r !== 'working') {
        p.action = null;
        const T = TRADES[shop.trade];
        if (r === 'empty') event(s, 'Storage needs ' + recipeText(shop.trade) + ' to ' + T.craft.toLowerCase() + '.', 'bad');
        if (r === 'full') event(s, 'The shelves are full. Sell some ' + T.product + ' first.', 'bad');
        if (r === 'done' && shop.queue.length) walkTo(s, plotPt(shop, 'serve'));
      }
      return;
    }
    if (a.type === 'gather') {
      a.left -= dt;
      if (a.left <= 0) {
        const g = GATHER[a.good];
        const n = Math.min(g.n, CARRY - carried(s));
        p.inv[a.good] += n; s.rec.gathered[a.good] += n;
        if (carried(s) >= CARRY) { p.action = null; event(s, 'Your arms are full (' + CARRY + ' items). Store or sell what you carry.', 'info'); }
        else a.left = g.min;
      }
    }
  }

  function walkTo(s, pt, then) { s.player.action = null; s.player.dest = { x: pt.x, z: pt.z, then: then || null }; }

  function beginAction(s, then) {
    const p = s.player;
    if (then.type === 'gather') {
      if (carried(s) >= CARRY) { event(s, 'Your arms are full. Store or sell what you carry first.', 'bad'); return; }
      p.action = { type: 'gather', good: then.good, left: GATHER[then.good].min };
    } else if (then.type === 'craft') { p.action = { type: 'craft', shop: then.shop }; p.face = Math.PI; }
    else if (then.type === 'store') storeGoods(s, shopById(s, then.shop));
    else if (then.type === 'storeThenCraft') { const shop = shopById(s, then.shop); storeGoods(s, shop); if (shop) walkTo(s, plotPt(shop, 'station'), { type: 'craft', shop: shop.id }); }
  }

  function storeGoods(s, shop) {
    if (!shop) return;
    const p = s.player, Ti = tierOf(shop), r = TRADES[shop.trade].recipe;
    let moved = 0;
    for (const g of Object.keys(r)) {
      const n = Math.max(0, Math.min(Ti.cap - shop.stock[g], p.inv[g]));
      shop.stock[g] += n; p.inv[g] -= n; moved += n;
    }
    if (moved) event(s, 'Stored ' + moved + ' items at the ' + TRADES[shop.trade].name.toLowerCase() + '.', 'info');
    else if (Object.keys(r).some(g => p.inv[g] > 0)) event(s, 'Storage is full (' + Ti.cap + ' of each).', 'bad');
    else event(s, 'You are not carrying any ' + Object.keys(r).join(' or ') + '.', 'info');
  }

  /* ---------- jobs ---------- */
  function updateJob(s, before) {
    if (!s.job) return;
    const e = empById(s.job.emp), j = s.job;
    if (crossed(before, s.t, e.shift[0] * 60)) {
      j.workedMin = 0; j.midShift = false;
      event(s, 'Your shift at ' + e.name + ' starts now (' + pad(e.shift[0]) + '–' + pad(e.shift[1]) + ').', 'story');
    }
    if (crossed(before, s.t, e.shift[1] * 60)) endShift(s);
  }
  const pad = h => String(h).padStart(2, '0') + ':00';
  function endShift(s) {
    const j = s.job, e = empById(j.emp);
    const len = (e.shift[1] - e.shift[0]) * 60, frac = j.workedMin / len;
    if (frac >= 0.6) {
      earn(s, e.wage); s.stats.jobPay += e.wage; s.rec.wagesEarned += e.wage;
      j.shifts++; s.rec.shiftsWorked++;
      const before = s.trades[e.trade];
      s.trades[e.trade]++;
      let msg = e.boss + ' paid you ' + e.wage + 'c for the shift.';
      if (before < LEARN_SHIFTS && s.trades[e.trade] >= LEARN_SHIFTS) msg += ' You have learned the ' + TRADES[e.trade].name.toLowerCase() + ' trade and can open one of your own.';
      event(s, msg, 'good');
    } else if (j.midShift || frac >= 0.2) {
      const pay = Math.floor(e.wage * frac);
      if (pay > 0) { earn(s, pay); s.stats.jobPay += pay; s.rec.wagesEarned += pay; }
      event(s, 'You worked part of your shift at ' + e.name + (pay ? ' and were paid ' + pay + 'c.' : '.'), 'info');
    } else {
      j.strikes++; s.rec.shiftsMissed++;
      if (j.strikes >= 3) {
        event(s, e.boss + ' has let you go for missing shifts. You can find work elsewhere, or ask again tomorrow.', 'bad');
        s.stats.notes.push({ text: 'You were let go from ' + e.name + ' after missing three shifts.' });
        s.job = null; s.rec.timesFired++;
        return;
      }
      event(s, j.strikes === 2 ? e.boss + ': "Miss one more shift and you are out."' : 'You missed your shift at ' + e.name + '.', 'bad');
      s.stats.notes.push({ text: 'You missed your shift at ' + e.name + ' (' + j.strikes + ' of 3 strikes).' });
    }
    j.workedMin = 0; j.midShift = false;
  }

  /* ---------- workers ---------- */
  function workerHours(shop) {
    const [o, c] = TRADES[shop.trade].hours;
    const start = o - 1, end = c, lunch = Math.floor((o + c) / 2);
    return { start, end, lunch };
  }
  function updateWorker(s, shop, dt) {
    const w = shop.worker;
    if (!w) return;
    const h = hourOf(s), H = workerHours(shop), Ti = tierOf(shop), T = TRADES[shop.trade], st = shopStats(s, shop);
    const serve = plotPt(shop, 'serve');
    w.indoors = false;
    if (w.task === 'supply' && h >= 6 && h < H.end) { supplyRun(s, shop, w, dt); st.workerMin += dt; return; }
    if (h < H.start - 1 || h >= H.end + 1) {
      w.task = 'sleep';
      if (moveTo(w, w.home.x, w.home.z, 1.1 * dt)) { w.indoors = true; w.why = 'Off duty at home'; } else w.why = 'Walking home';
      return;
    }
    if (h < H.start) { w.task = 'commute'; moveTo(w, serve.x, serve.z, 1.1 * dt); w.why = 'Walking to work for ' + pad(H.start); return; }
    if (h >= H.end) { w.task = 'home'; moveTo(w, w.home.x, w.home.z, 1.1 * dt); w.why = 'Shift over at ' + pad(H.end) + ', heading home'; return; }
    if (h >= H.lunch && h < H.lunch + 0.5) { const b = plotPt(shop, 'bench'); w.task = 'lunch'; moveTo(w, b.x, b.z, 1.1 * dt); w.why = 'Short break until ' + clock(H.lunch * 60 + 30); return; }

    st.workerMin += dt;
    const sp = workerSpeed(w);
    const low = !shop.work.loaded && !canProduce(shop);
    const target = Math.min(Ti.cap - Ti.out, Ti.out * 2);
    const missingCost = Object.keys(T.recipe).reduce((a, g) => a + Math.max(0, T.recipe[g] - shop.stock[g]) * BUY[g], 0);
    if (shop.policy.supplyRuns && low && s.coins >= missingCost && h < H.end - 1 && !(w.supWait > s.t)) {
      w.task = 'supply'; w.sup = { phase: 'go' };
      supplyRun(s, shop, w, dt); return;
    }
    if (shop.queue.length && shop.goods > 0) {
      w.task = 'serve'; moveTo(w, serve.x, serve.z, 1.1 * dt);
      w.why = 'Serving ' + shop.queue.length + (shop.queue.length === 1 ? ' waiting customer' : ' waiting customers');
      return;
    }
    if (shop.work.loaded || (!low && shop.goods < target)) {
      w.task = 'craft';
      const stn = plotPt(shop, 'station');
      if (moveTo(w, stn.x, stn.z, 1.1 * dt)) {
        w.face = Math.PI;
        const r = workStep(s, shop, dt, sp, 'worker');
        w.why = r === 'working' ? T.crafting + ': ' + Math.round(shop.work.progress / shop.work.need * 100) + '% done, shelf has ' + shop.goods + ' (aims for ' + target + ')' : 'Checking the ' + T.station;
      } else w.why = 'Going to the ' + T.station + ': shelf has only ' + shop.goods;
      return;
    }
    w.task = 'tend'; moveTo(w, serve.x, serve.z, 1.1 * dt);
    if (low) {
      if (!st.idleAt && shop.goods < target) st.idleAt = clock(s.t);
      w.why = shop.policy.supplyRuns ? 'Waiting: storage is empty and there is not enough coin to buy ' + recipeText(shop.trade) : 'Waiting at the counter: storage needs ' + recipeText(shop.trade);
    } else w.why = 'Minding the counter: shelf is stocked (' + goodsName(shop.trade, shop.goods) + ')';
  }

  function supplyRun(s, shop, w, dt) {
    const Ti = tierOf(shop), r = TRADES[shop.trade].recipe, st = shopStats(s, shop);
    if (w.sup.phase === 'go') {
      w.why = 'Walking to the Trading Post for ' + Object.keys(r).join(' and ');
      if (moveTo(w, P.market.x - 0.8, P.market.z, 1.1 * dt)) {
        const want = {};
        for (const g of Object.keys(r)) want[g] = shop.stock[g] >= r[g] * 3 ? 0 : Math.min(r[g] * 3 - shop.stock[g], Ti.cap - shop.stock[g]);
        const cost = () => Object.keys(want).reduce((a, g) => a + want[g] * BUY[g], 0);
        while (cost() > s.coins && Object.values(want).some(v => v > 0)) {
          const g = Object.keys(want).sort((a, b) => want[b] / r[b] - want[a] / r[a])[0]; want[g]--;
        }
        const total = Object.values(want).reduce((a, b) => a + b, 0);
        if (total <= 0) { w.task = null; w.sup = null; w.supWait = s.t + 90; w.why = 'Could not afford supplies'; return; }
        const c = cost();
        spend(s, c); st.supplies += c;
        w.carry = want; w.sup.phase = 'back';
        event(s, w.name + ' bought ' + Object.keys(want).filter(g => want[g]).map(g => want[g] + ' ' + g).join(' and ') + ' for ' + c + 'c.', 'info');
      }
    } else {
      w.why = 'Carrying supplies back';
      const sp = plotPt(shop, 'store');
      if (moveTo(w, sp.x, sp.z, 1.0 * dt)) {
        for (const g in w.carry) shop.stock[g] = Math.min(Ti.cap, shop.stock[g] + w.carry[g]);
        w.carry = null; w.task = null; w.sup = null;
      }
    }
  }

  /* ---------- commands ---------- */
  const ok = msg => ({ ok: true, msg });
  const fail = msg => ({ ok: false, msg });
  function payCost(s, cost, shop) {
    const p = s.player;
    for (const g of GOODS) {
      let need = cost[g] || 0;
      const fromInv = Math.min(p.inv[g], need); p.inv[g] -= fromInv; need -= fromInv;
      if (need && shop) shop.stock[g] -= need;
    }
    spend(s, cost.coin || 0); s.rec.invested += cost.coin || 0;
  }
  function canPay(s, cost, shop) {
    if (s.coins < (cost.coin || 0)) return false;
    return GOODS.every(g => !cost[g] || s.player.inv[g] + (shop ? shop.stock[g] : 0) >= cost[g]);
  }
  function cmd(s, name, a, b, c) {
    const p = s.player;
    const shop = typeof a === 'number' ? shopById(s, a) : null;
    switch (name) {
      case 'walk': walkTo(s, a); return ok();
      case 'goto': {
        const L = LOCS[a];
        if (!L) return fail('Unknown place');
        if (L.plot != null) { const sh = shopOnPlot(s, L.plot); walkTo(s, sh ? plotPt(sh, 'serve') : { x: L.x, z: L.z + 2.6 }); return ok(); }
        if (L.emp) { walkTo(s, empById(L.emp).spot); return ok(); }
        if (a === 'market') { walkTo(s, P.market); return ok(); }
        if (a === 'home') { walkTo(s, P.home); return ok(); }
        if (a === 'well') { walkTo(s, P.well); return ok(); }
        walkTo(s, { x: L.x, z: L.z + L.r * 0.6 }); return ok();
      }
      case 'gather': {
        const g = GATHER[a];
        if (!g) return fail('Unknown resource');
        if (carried(s) >= CARRY) return fail('Your arms are full. Store or sell first.');
        const L = LOCS[g.loc];
        const here = dist(p, L) < L.r;
        let spot;
        if (here) spot = { x: p.x, z: p.z };
        else if (a === 'grain') spot = { x: L.x - 3 + rand(s) * 6, z: L.z - 2 + rand(s) * 4 };
        else if (a === 'wood') spot = { x: L.x + 4 + rand(s) * 2, z: L.z + 3 + rand(s) * 2 };
        else spot = { x: L.x - 1.5 + rand(s) * 3, z: L.z + 1 + rand(s) * 1.5 };
        walkTo(s, spot, { type: 'gather', good: a });
        return ok();
      }
      case 'apply': {
        const e = empById(a);
        if (!e) return fail('No such employer');
        if (s.job && s.job.emp === a) return fail('You already work here.');
        if (s.job) return fail('You already work at ' + empById(s.job.emp).name + '. Quit that job first.');
        s.job = { emp: a, strikes: 0, workedMin: 0, shifts: 0, hiredDay: s.day, midShift: false };
        if (inShift(s)) s.job.midShift = true;
        s.rec.jobsHeld++;
        event(s, e.boss + ' takes you on. Shifts run ' + pad(e.shift[0]) + '–' + pad(e.shift[1]) + ' for ' + e.wage + 'c a shift.' + (inShift(s) ? ' Your shift is on now.' : ''), 'good');
        return ok();
      }
      case 'quitJob': {
        if (!s.job) return fail('You have no job.');
        const e = empById(s.job.emp);
        if (inShift(s) && s.job.workedMin > 0) endShift(s);
        s.job = null; s.rec.jobsQuit++;
        event(s, 'You told ' + e.boss + ' you are moving on.', 'info');
        return ok();
      }
      case 'work': {
        if (!s.job) return fail('You have no job.');
        walkTo(s, jobSpotOf(s)); return ok();
      }
      case 'open': {
        const plot = a, trade = b;
        if (!PLOTS[plot]) return fail('No such lot.');
        if (shopOnPlot(s, plot)) return fail('That lot is taken.');
        if (!TRADES[trade]) return fail('Unknown trade.');
        if (!learned(s, trade)) return fail('Learn the trade first: work ' + LEARN_SHIFTS + ' shifts at ' + EMPLOYERS.find(e => e.trade === trade).name + '.');
        const cost = TRADES[trade].tiers[0].cost;
        if (!canPay(s, cost)) return fail('Opening a ' + TRADES[trade].name.toLowerCase() + ' costs ' + costText(cost) + '.');
        payCost(s, cost);
        const sh = { id: s.nextShop++, plot, trade, tier: 0, price: TRADES[trade].price, stock: { grain: 0, wood: 0, ore: 0 }, goods: 0, work: { loaded: false, progress: 0, need: 0 }, serveProgress: 0, queue: [], worker: null, policy: { supplyRuns: false }, openedDay: s.day };
        s.shops.push(sh); s.stats.shops[sh.id] = freshShopStats(sh);
        s.rec.shopsOpened++;
        event(s, 'You opened a ' + TRADES[trade].tiers[0].name + ' on the ' + PLOTS[plot].name + '! Customers will start coming tomorrow.', 'story');
        return ok();
      }
      case 'craft': {
        if (!shop) return fail('No such shop.');
        const T = TRADES[shop.trade], Ti = tierOf(shop);
        if (!shop.work.loaded && shop.goods + Ti.out > Ti.cap) return fail('The shelves are full. Sell before making more.');
        if (!shop.work.loaded && !canProduce(shop)) {
          const enough = Object.keys(T.recipe).every(g => p.inv[g] >= T.recipe[g] - shop.stock[g]);
          if (!enough) return fail('The ' + T.station + ' needs ' + recipeText(shop.trade) + ' in storage.');
          walkTo(s, plotPt(shop, 'store'), { type: 'storeThenCraft', shop: shop.id }); return ok();
        }
        walkTo(s, plotPt(shop, 'station'), { type: 'craft', shop: shop.id }); return ok();
      }
      case 'store': {
        if (!shop) return fail('No such shop.');
        if (dist(p, PLOTS[shop.plot]) < 4.6) { storeGoods(s, shop); return ok(); }
        walkTo(s, plotPt(shop, 'store'), { type: 'store', shop: shop.id }); return ok();
      }
      case 'serve': if (!shop) return fail('No such shop.'); walkTo(s, plotPt(shop, 'serve')); return ok();
      case 'buy': case 'sell': {
        if (dist(p, LOCS.market) > LOCS.market.r) return fail('Go to the Trading Post first.');
        if (!GOODS.includes(a)) return fail('They do not trade that.');
        const n = b || 1;
        if (name === 'buy') {
          const cost = BUY[a] * n;
          if (s.coins < cost) return fail('You need ' + cost + 'c for that.');
          if (carried(s) + n > CARRY) return fail('You can carry ' + CARRY + ' items at most.');
          spend(s, cost); s.stats.marketBuys += cost; p.inv[a] += n;
          return ok('Bought ' + n + ' ' + a + ' for ' + cost + 'c.');
        }
        if (p.inv[a] < n || n <= 0) return fail('You have only ' + p.inv[a] + ' ' + a + '.');
        p.inv[a] -= n; const got = SELL[a] * n; earn(s, got); s.stats.rawSales += got; s.rec.rawSales += got;
        return ok('Sold ' + n + ' ' + a + ' for ' + got + 'c.');
      }
      case 'setPrice': if (shop) shop.price = clamp(Math.round(b), 1, TRADES[shop.trade].wtp * 3); return ok();
      case 'policy': if (shop) shop.policy[b] = !!c; return ok();
      case 'hire': {
        if (!shop) return fail('Pick a shop to hire for.');
        if (shop.worker) return fail('That shop already has a worker.');
        const ap = s.applicants[b];
        if (!ap) return fail('That applicant has gone.');
        const wage = clamp(Math.round(c || ap.ask), 1, 40);
        const used = s.shops.filter(x => x.worker).map(x => x.worker.home);
        const home = WORKER_HOMES.find(h => !used.includes(h)) || WORKER_HOMES[0];
        shop.worker = { name: ap.name, skill: ap.skill, ask: ap.ask, wage, mood: 60, x: P.road.x - 6, z: P.plaza.z, face: 0, home, task: null, why: 'Just hired', warned: false, carry: null, sup: null, hiredDay: s.day };
        s.applicants.splice(b, 1); s.rec.workersHired++;
        event(s, ap.name + ' will work at your ' + TRADES[shop.trade].name.toLowerCase() + ' for ' + wage + 'c a day, paid at closing (21:00).', 'good');
        return ok();
      }
      case 'setWage': if (shop && shop.worker) shop.worker.wage = clamp(Math.round(b), 1, 40); return ok();
      case 'fire': {
        if (!shop || !shop.worker) return fail('No worker to let go.');
        const w = shop.worker; shop.worker = null; s.rec.workersLetGo++;
        event(s, 'You let ' + w.name + ' go.', 'info');
        return ok();
      }
      case 'upgrade': {
        if (!shop) return fail('No such shop.');
        const next = TRADES[shop.trade].tiers[shop.tier + 1];
        if (!next) return fail('This shop is fully upgraded.');
        if (!canPay(s, next.cost, shop)) return fail('Needs ' + costText(next.cost) + '. Goods you carry and goods in storage both count.');
        payCost(s, next.cost, shop);
        shop.tier++; s.rec.upgrades++;
        event(s, 'Your shop on the ' + PLOTS[shop.plot].name + ' is now a ' + next.name + '!', 'story');
        return ok();
      }
      case 'stop': p.action = null; p.dest = null; return ok();
    }
    return fail('Unknown command');
  }

  /* ---------- stepping ---------- */
  function crossed(a, b, mark) { return Math.floor((b - mark) / DAY) > Math.floor((a - mark) / DAY); }
  function rate(s) { const h = hourOf(s); return (h >= 21 || h < 6) ? 45 : 4; }
  function step(s, dt) {
    const before = s.t;
    s.t += dt;
    updateJob(s, before);
    if (crossed(before, s.t, 21 * 60)) closeDay(s);
    if (crossed(before, s.t, 6 * 60)) openDay(s);
    const h = hourOf(s);
    if (h >= 6 && h < 21) spawnScheduled(s);
    updatePlayer(s, dt);
    for (const shop of s.shops) updateWorker(s, shop, dt);
    updateAgents(s, dt);
    for (const shop of s.shops) updateCounter(s, shop, dt);
    if (s.coins > s.rec.peakCoins) s.rec.peakCoins = s.coins;
  }
  function advance(s, minutes) { let left = minutes; while (left > 1e-9) { const d = Math.min(1, left); step(s, d); left -= d; } }

  /* ---------- records ---------- */
  function propertyValue(s) {
    return s.shops.reduce((a, x) => a + TRADES[x.trade].tiers.slice(0, x.tier + 1).reduce((b, t) => b + (t.cost.coin || 0), 0), 0);
  }
  function netWorth(s) { return s.coins + propertyValue(s); }
  function summary(s) {
    return { name: s.name, day: s.day, clock: clock(s.t), coins: s.coins, shops: s.shops.length, job: s.job ? empById(s.job.emp).name : null, netWorth: netWorth(s) };
  }

  /* ---------- saving ---------- */
  function serialize(s) { return JSON.stringify(s); }
  function migrateV1(o) {
    const s = newGame(o.rng, 'Wren');
    s.t = o.t; s.day = o.day; s.coins = o.coins; s.trades.bakery = LEARN_SHIFTS;
    const sh = { id: s.nextShop++, plot: 1, trade: 'bakery', tier: o.tier || 0, price: o.price || 5, stock: { grain: o.bakery.grain || 0, wood: o.bakery.wood || 0, ore: 0 }, goods: o.bakery.bread || 0, work: { loaded: !!o.bakery.oven.loaded, progress: o.bakery.oven.progress || 0, need: o.bakery.oven.need || 0 }, serveProgress: 0, queue: [], worker: null, policy: { supplyRuns: !!(o.policy && o.policy.supplyRuns) }, openedDay: 1 };
    if (o.worker) {
      const w = o.worker;
      sh.worker = { name: w.name, skill: w.skill, ask: w.ask, wage: w.wage, mood: w.mood, x: P.plaza.x, z: P.plaza.z, face: 0, home: WORKER_HOMES[0], task: null, why: 'Back at work', warned: !!w.warned, carry: null, sup: null, hiredDay: 1 };
      s.rec.workersHired = 1;
    }
    s.shops.push(sh);
    s.player.inv.grain = o.player.inv.grain || 0; s.player.inv.wood = o.player.inv.wood || 0;
    s.rec.shopsOpened = 1; s.rec.upgrades = sh.tier; s.rec.goodsSold = (o.lifetime && o.lifetime.sold) || 0; s.rec.sold.bread = s.rec.goodsSold;
    s.rec.days = (o.lifetime && o.lifetime.days) || 0;
    s.events = []; s.ledger = [];
    s.stats = freshStats(s); s.stats.day = s.day;
    openDay(s);
    event(s, 'Hearthmoor has grown: the square now has four shops that hire, and you can open new trades. Your bakery moved to the Middle lot.', 'story');
    return s;
  }
  function deserialize(str) {
    let s = JSON.parse(str);
    if (!s || typeof s !== 'object' || typeof s.v !== 'number') throw new Error('Not a Hearthmoor save');
    if (s.v > VERSION) throw new Error('This save is from a newer version');
    if (s.v === 1) s = migrateV1(s);
    if (!s.player || !Array.isArray(s.shops) || !Array.isArray(s.agents) || !s.rec) throw new Error('Save is missing data');
    return s;
  }

  const api = {
    VERSION, TRADES, TRADE_KEYS, PLOTS, REL, EMPLOYERS, LOCS, P, HOMES, WORKER_HOMES, BUY, SELL, GATHER, GOALS, CARRY, GOODS, LEARN_SHIFTS, WHY,
    newGame, step, advance, cmd, rate, serialize, deserialize, hourOf, clock, hm, carried, skillLabel, dist,
    tierOf, plotPt, shopLabel, shopById, shopOnPlot, empById, learned, tradeSpeed, inShift, playerAtWork, wtpMean, recipeText, costText, goodsName,
    netWorth, propertyValue, summary, workerHours, canPay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
