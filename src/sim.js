/* Hearthmoor simulation core.
   Pure game logic: no rendering, no DOM, no Math.random. The whole game state is
   plain JSON, so it can be saved, restored and tested headless. */
(function (root) {
  'use strict';

  const VERSION = 1;
  const DAY = 1440;
  const CARRY = 20;
  const SERVE_MIN = 3;
  const PATIENCE = 45;

  const P = {
    serve: { x: 0, z: 0.4 }, queue0: { x: 0, z: 2.6 }, oven: { x: -2.3, z: -0.8 },
    store: { x: 2.4, z: -0.6 }, bench: { x: 3.9, z: 2.4 },
    market: { x: 11.3, z: 11.1 }, well: { x: 6, z: -2.6 }, plaza: { x: 5, z: 6 },
    road: { x: 33, z: 3.5 }, home: { x: -8.4, z: 6.7 }, workerHome: { x: -8.6, z: -15.6 }
  };

  const LOCS = {
    bakery: { x: 0, z: 0, r: 4.6, name: 'Your Bakery' },
    field: { x: 17, z: -9, r: 6.5, name: 'Wheat Field' },
    forest: { x: -19, z: -11, r: 7, name: 'Pine Woods' },
    market: { x: 13, z: 13, r: 3.8, name: 'Trading Post' },
    home: { x: -10, z: 8, r: 3, name: 'Your Hut' },
    well: { x: 6, z: -4, r: 2, name: 'Village Well' }
  };

  const HOMES = [{ x: -17, z: 2 }, { x: -4, z: 17 }, { x: 4, z: 19 }, { x: 23, z: -1 }, { x: -1, z: -18 }, { x: 9, z: -17 }];
  const VILLAGERS = [
    { name: 'Aldric', job: 'field' }, { name: 'Maren', job: 'field' }, { name: 'Tobin', job: 'forest' },
    { name: 'Edda', job: 'forest' }, { name: 'Wynn', job: 'market' }, { name: 'Old Sela', job: 'well' }
  ];
  const TRAVELERS = ['A pilgrim', 'A tinker', 'A drover', 'A peddler', 'A soldier', 'A minstrel', 'A shepherd', 'A friar'];
  const APPLICANTS = ['Hilda', 'Bram', 'Osric', 'Linnet', 'Cade', 'Freya', 'Rolf', 'Agnes', 'Piers', 'Wenna'];

  const TIERS = [
    { name: 'Bread Stand', batch: 4, bakeMin: 60, cap: 12, travelers: 4, wtpBonus: 0, upkeep: 1 },
    { name: 'Timber Bakery', batch: 6, bakeMin: 50, cap: 24, travelers: 6, wtpBonus: 0.5, upkeep: 3, cost: { coin: 60, wood: 12 } },
    { name: 'Stone Bakery', batch: 8, bakeMin: 40, cap: 40, travelers: 10, wtpBonus: 1, upkeep: 6, cost: { coin: 180, wood: 25 } }
  ];
  const RECIPE = { grain: 2, wood: 1 };
  const BUY = { grain: 2, wood: 2 };
  const SELL = { grain: 1, wood: 1 };
  const GATHER = { grain: { min: 30, n: 2, loc: 'field' }, wood: { min: 40, n: 2, loc: 'forest' } };

  const GOALS = [
    { id: 'gather', text: 'Gather grain at the Wheat Field and wood in the Pine Woods', done: s => s.goals.gotGrain && s.goals.gotWood },
    { id: 'store', text: 'Store them at your bread stand', done: s => s.goals.stored },
    { id: 'bake', text: 'Bake your first batch at the oven', done: s => s.goals.baked },
    { id: 'sell', text: 'Sell 10 loaves', done: s => s.lifetime.sold >= 10 },
    { id: 'hire', text: 'Hire your first worker (open the book, Staff page)', done: s => s.goals.hired },
    { id: 'timber', text: 'Upgrade to a Timber Bakery (60c and 12 wood)', done: s => s.tier >= 1 },
    { id: 'stone', text: 'Upgrade to a Stone Bakery (180c and 25 wood)', done: s => s.tier >= 2 }
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
  const tier = s => TIERS[s.tier];
  const minuteOfDay = t => ((t % DAY) + DAY) % DAY;
  const hourOf = s => minuteOfDay(s.t) / 60;
  function clock(t) {
    const m = Math.floor(minuteOfDay(t));
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function hm(min) {
    const m = Math.round(min);
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  function moveTo(a, tx, tz, step) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d <= step || d < 0.05) { a.x = tx; a.z = tz; a.moving = false; return true; }
    a.x += dx / d * step; a.z += dz / d * step; a.face = Math.atan2(dx, dz); a.moving = true;
    return false;
  }
  function event(s, text, kind) {
    s.events.push({ t: s.t, text, kind: kind || 'info' });
    if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
  }
  const carried = s => s.player.inv.grain + s.player.inv.wood;
  const agentById = (s, id) => s.agents.find(a => a.id === id);
  const queueSlot = i => ({ x: P.queue0.x, z: P.queue0.z + i * 1.0 });

  function freshStats(s) {
    return {
      day: s.day, price: s.price, sold: 0, revenue: 0, served: 0, tooExpensive: 0, soldOut: 0, noService: 0,
      noServiceWhy: {}, supplies: 0, wages: 0, upkeep: 0, upkeepUnpaid: 0, otherIncome: 0,
      ovenIdleAt: null, shelfFullAt: null, batches: 0, batchesBy: { player: 0, worker: 0 },
      servedBy: { player: 0, worker: 0 }, playerMin: 0, workerMin: 0
    };
  }

  /* ---------- new game ---------- */
  function newGame(seed) {
    const s = {
      v: VERSION, t: 6 * 60, day: 1, rng: (seed | 0) || 12345, coins: 10, price: 5, tier: 0,
      player: { x: P.home.x, z: P.home.z, face: 0, dest: null, action: null, inv: { grain: 0, wood: 0 } },
      bakery: { grain: 0, wood: 0, bread: 0, oven: { loaded: false, progress: 0, need: 0 }, serveProgress: 0, queue: [] },
      worker: null, policy: { supplyRuns: false },
      agents: [], nextId: 1, schedule: [], applicants: [], ledger: [], events: [],
      goals: { gotGrain: false, gotWood: false, stored: false, baked: false, hired: false },
      lifetime: { sold: 0, revenue: 0, days: 0 }, stats: null
    };
    VILLAGERS.forEach((v, i) => {
      const home = HOMES[i];
      s.agents.push({
        id: s.nextId++, kind: 'villager', name: v.name, job: v.job, home, x: home.x, z: home.z + 1.5, face: 0,
        spot: jobSpot(s, v.job), mode: 'routine', phase: null, doing: 'Waking up', icon: null, iconUntil: 0, palette: i
      });
    });
    openDay(s);
    event(s, 'Day 1. You have 10 coins and an empty bread stand. The Wheat Field and Pine Woods are free to gather from.', 'story');
    return s;
  }

  function jobSpot(s, job) {
    const j = () => (rand(s) - 0.5);
    if (job === 'field') return { x: LOCS.field.x + j() * 8, z: LOCS.field.z + j() * 6 };
    if (job === 'forest') return { x: LOCS.forest.x + 3 + j() * 5, z: LOCS.forest.z + 2 + j() * 5 };
    if (job === 'market') return { x: LOCS.market.x + 1.6, z: LOCS.market.z - 0.6 };
    return { x: P.well.x + 1.2, z: P.well.z + 0.6 };
  }

  /* ---------- day cycle ---------- */
  function openDay(s) {
    s.day = Math.floor((s.t - 360) / DAY) + 1;
    s.stats = freshStats(s);
    const base = s.t - minuteOfDay(s.t);
    const sched = [];
    s.agents.filter(a => a.kind === 'villager').forEach(a => {
      if (rand(s) < 0.85) sched.push({ at: base + (8 + rand(s) * 10) * 60, id: a.id });
    });
    const n = Math.max(0, tier(s).travelers + Math.floor(rand(s) * 3) - 1);
    for (let i = 0; i < n; i++) sched.push({ at: base + (8 + rand(s) * 10) * 60, id: null });
    sched.sort((a, b) => a.at - b.at);
    s.schedule = sched;
    if (!s.worker) makeApplicants(s);
    if (s.day > 1) event(s, 'Day ' + s.day + ' begins.', 'story');
  }

  function makeApplicants(s) {
    s.applicants = [];
    for (let i = 0; i < 2; i++) {
      const skill = Math.round((0.7 + rand(s) * 0.6) * 100) / 100;
      const ask = Math.round(3 + skill * 6);
      let name;
      do { name = APPLICANTS[Math.floor(rand(s) * APPLICANTS.length)]; } while (s.applicants.some(a => a.name === name));
      s.applicants.push({ name, skill, ask });
    }
  }

  function skillLabel(skill) { return skill < 0.85 ? 'Slow but cheap' : skill < 1.1 ? 'Steady' : 'Quick hands'; }

  function closeDay(s) {
    const st = s.stats, T = tier(s);
    const w = s.worker;
    if (w) {
      const paid = Math.min(s.coins, w.wage);
      s.coins -= paid; st.wages += paid;
      const full = paid >= w.wage;
      if (!full) { w.mood -= 25; w.unpaid = (w.unpaid || 0) + 1; }
      else { w.unpaid = 0; w.mood += w.wage >= w.ask ? 6 + Math.min(6, (w.wage - w.ask) * 2) : -(w.ask - w.wage) * 7; }
      w.mood = clamp(w.mood, 0, 100);
      st.workerPaid = full;
    }
    const up = Math.min(s.coins, T.upkeep);
    s.coins -= up; st.upkeep = up; st.upkeepUnpaid = T.upkeep - up;
    const entry = Object.assign({}, st, {
      tierName: T.name, workerName: w ? w.name : null, workerMood: w ? Math.round(w.mood) : null,
      workerWage: w ? w.wage : null, workerAsk: w ? w.ask : null, coinsEnd: s.coins
    });
    entry.income = st.revenue + st.otherIncome;
    entry.costs = st.supplies + st.wages + st.upkeep;
    entry.profit = entry.income - entry.costs;
    entry.notes = explain(s, entry);
    s.ledger.push(entry);
    if (s.ledger.length > 14) s.ledger.shift();
    s.lifetime.days++;
    event(s, 'Books closed for Day ' + entry.day + ': ' + (entry.profit >= 0 ? 'profit ' : 'loss ') + Math.abs(entry.profit) + 'c. Open the book to see why.', entry.profit >= 0 ? 'good' : 'bad');

    if (w) {
      if (w.mood < 15) {
        if (w.warned) {
          event(s, w.name + ' has quit. Pay was too low or late.', 'bad');
          entry.notes.push({ text: w.name + ' quit after a second miserable day. Workers expect at least their asking wage, paid on time.' });
          s.worker = null; makeApplicants(s);
        } else {
          w.warned = true;
          event(s, w.name + ' is miserable and may quit tomorrow.', 'bad');
        }
      } else w.warned = false;
    }
    // bakery closes: customers still waiting go home
    s.bakery.queue.slice().forEach(id => { const a = agentById(s, id); if (a) leaveShop(s, a, null); });
    s.bakery.queue = [];
  }

  /* ---------- the ledger's explanations ---------- */
  const WHY = {
    nobodyAtCounter: 'nobody was at the counter',
    youBaking: 'you were busy at the oven',
    youAway: 'you were away from the stand',
    workerBaking: 'your worker was at the oven',
    workerErrand: 'your worker was out buying supplies',
    workerLunch: 'your worker was on lunch break'
  };
  function explain(s, e) {
    const notes = [];
    const T = TIERS[s.tier];
    const lo = Math.round(5 + T.wtpBonus), hi = Math.round(7 + T.wtpBonus);
    if (e.soldOut > 0) {
      let t = e.soldOut + (e.soldOut === 1 ? ' customer' : ' customers') + ' left because the shelves were empty.';
      if (e.ovenIdleAt) t += ' The oven stood idle from ' + e.ovenIdleAt + ' because storage had no grain or wood.';
      else t += ' Bake earlier in the day so a batch is ready when people arrive.';
      const n = { text: t };
      if (e.ovenIdleAt && s.worker && !s.policy.supplyRuns) n.fix = { label: 'Let ' + s.worker.name + ' buy supplies', cmd: ['policy', 'supplyRuns', true] };
      notes.push(n);
    }
    if (e.tooExpensive > 0) {
      const n = { text: e.tooExpensive + (e.tooExpensive === 1 ? ' customer' : ' customers') + ' walked away at ' + e.price + 'c a loaf. Most people here will pay ' + lo + '–' + hi + 'c.' };
      if (e.price > hi) n.fix = { label: 'Set price to ' + (lo + 1) + 'c', cmd: ['setPrice', lo + 1] };
      notes.push(n);
    }
    if (e.noService > 0) {
      const causes = Object.keys(e.noServiceWhy).sort((a, b) => e.noServiceWhy[b] - e.noServiceWhy[a]).map(k => WHY[k] || k);
      const n = { text: e.noService + (e.noService === 1 ? ' customer' : ' customers') + ' gave up waiting because ' + causes.join(', or ') + '.' };
      if (!s.worker) n.fix = { label: 'Hire help', cmd: ['page', 'staff'] };
      notes.push(n);
    }
    if (e.shelfFullAt && e.sold > 0) notes.push({ text: 'The shelf was full at ' + e.shelfFullAt + ', so no more bread could be baked. A bigger bakery holds more.' });
    if (e.price <= 2) notes.push({ text: 'At ' + e.price + 'c a loaf you barely cover bought supplies (about ' + (5 / T.batch).toFixed(1) + 'c a loaf).' });
    if (e.profit < 0) {
      notes.push({ text: 'You lost ' + (-e.profit) + 'c. Costs were ' + e.costs + 'c (supplies ' + e.supplies + 'c, wages ' + e.wages + 'c, upkeep ' + e.upkeep + 'c) against ' + e.income + 'c coming in.' });
    }
    if (e.upkeepUnpaid > 0) notes.push({ text: 'You could not cover ' + e.upkeepUnpaid + 'c of upkeep. Nothing was taken from you, but earn some coin before tomorrow.' });
    if (s.worker && e.workerName) {
      const w = s.worker;
      if (e.workerPaid === false) notes.push({ text: w.name + ' was not paid in full and is upset. Keep at least ' + w.wage + 'c by closing time.' });
      else if (w.wage < w.ask) notes.push({ text: w.name + ' asked for ' + w.ask + 'c a day but gets ' + w.wage + 'c. Mood is falling (' + Math.round(w.mood) + '/100).', fix: { label: 'Pay ' + w.ask + 'c a day', cmd: ['setWage', w.ask] } });
      if (w.mood < 30) notes.push({ text: w.name + ' is unhappy and works about 30% slower.' });
    }
    if (e.sold === 0 && e.batches === 0 && !s.goals.baked) {
      notes.push({ text: 'Nothing was baked yet. Gather grain and wood, store them at the stand, then bake at the oven.' });
    }
    if (!notes.length && e.profit > 0) notes.push({ text: 'A good day. Every customer who wanted bread at your price got some.' });
    return notes;
  }

  /* ---------- customers and villagers ---------- */
  function spawnScheduled(s) {
    while (s.schedule.length && s.schedule[0].at <= s.t) {
      const e = s.schedule.shift();
      const T = tier(s);
      let a;
      if (e.id == null) {
        a = {
          id: s.nextId++, kind: 'traveler', name: TRAVELERS[Math.floor(rand(s) * TRAVELERS.length)],
          x: P.road.x, z: P.road.z + (rand(s) - 0.5) * 3, face: -Math.PI / 2, mode: 'shop', phase: 'toShop',
          doing: 'Looking for bread', icon: null, iconUntil: 0, palette: 6 + Math.floor(rand(s) * 4)
        };
        a.wtp = clamp(normal(s, 6.5 + T.wtpBonus, 1.4), 2, 13);
        s.agents.push(a);
      } else {
        a = agentById(s, e.id);
        if (!a || a.mode === 'shop') continue;
        a.mode = 'shop'; a.phase = 'toShop'; a.doing = 'Going to buy bread';
        a.wtp = clamp(normal(s, 6 + T.wtpBonus, 1.4), 2, 13);
      }
      a.qty = rand(s) < 0.35 ? 2 : 1;
    }
  }

  function ovenWillProduce(s) {
    const b = s.bakery;
    return b.oven.loaded || (b.grain >= RECIPE.grain && b.wood >= RECIPE.wood);
  }

  function noServiceCause(s) {
    const w = s.worker;
    if (w && w.task === 'bake') return 'workerBaking';
    if (w && w.task === 'supply') return 'workerErrand';
    if (w && w.task === 'lunch') return 'workerLunch';
    const p = s.player;
    if (p.action && p.action.type === 'bake') return 'youBaking';
    if (dist(p, LOCS.bakery) > LOCS.bakery.r) return 'youAway';
    return 'nobodyAtCounter';
  }

  function leaveShop(s, a, reason) {
    const st = s.stats;
    if (reason === 'tooExpensive') { st.tooExpensive++; a.icon = 'angry'; }
    else if (reason === 'soldOut') { st.soldOut++; a.icon = 'angry'; }
    else if (reason === 'noService') {
      st.noService++; a.icon = 'angry';
      const k = noServiceCause(s); st.noServiceWhy[k] = (st.noServiceWhy[k] || 0) + 1;
    } else if (reason === 'served') a.icon = 'happy';
    else a.icon = null;
    a.iconUntil = s.t + 50;
    const qi = s.bakery.queue.indexOf(a.id);
    if (qi >= 0) s.bakery.queue.splice(qi, 1);
    if (a.kind === 'traveler') { a.mode = 'shop'; a.phase = 'leave'; a.doing = 'Leaving the village'; }
    else { a.mode = 'routine'; a.phase = null; }
    a.lastReason = reason;
  }

  function updateShopper(s, a, dt) {
    const speed = 1.0 * dt, b = s.bakery;
    if (a.phase === 'toShop') {
      const slot = queueSlot(b.queue.length);
      a.doing = 'Going to buy bread';
      if (moveTo(a, slot.x, slot.z, speed)) {
        if (s.price > a.wtp) {
          leaveShop(s, a, 'tooExpensive');
          if (s.stats.tooExpensive <= 2) event(s, a.name + ' thought ' + s.price + 'c a loaf was too much.', 'bad');
        } else if (b.bread <= 0 && !ovenWillProduce(s)) {
          leaveShop(s, a, 'soldOut');
          event(s, a.name + ' found empty shelves and left.', 'bad');
        } else {
          b.queue.push(a.id); a.phase = 'queue'; a.patience = PATIENCE; a.icon = 'wait';
        }
      }
    } else if (a.phase === 'queue') {
      const idx = b.queue.indexOf(a.id);
      if (idx < 0) { a.phase = 'toShop'; return; }
      const slot = queueSlot(idx);
      moveTo(a, slot.x, slot.z, speed);
      a.patience -= dt;
      a.doing = 'Waiting in line (' + Math.max(0, Math.round(a.patience)) + ' min of patience left)';
      if (a.patience <= 0) {
        const reason = b.bread <= 0 ? 'soldOut' : 'noService';
        leaveShop(s, a, reason);
        event(s, a.name + (reason === 'soldOut' ? ' gave up: no bread.' : ' gave up waiting: ' + (WHY[noServiceCause(s)] || 'nobody served them') + '.'), 'bad');
      }
    } else if (a.phase === 'leave') {
      if (moveTo(a, P.road.x, P.road.z, speed * 1.2)) a.gone = true;
    }
  }

  function villagerRoutine(s, a, dt) {
    const h = hourOf(s);
    let tgt, doing, working = false;
    if (h < 6 || h >= 21) { tgt = a.home; doing = 'Asleep'; }
    else if (h < 7) { tgt = a.spot; doing = 'Walking to work'; }
    else if (h < 12 || (h >= 13 && h < 17)) { tgt = a.spot; doing = jobDoing(a.job); working = true; }
    else if (h < 13) { tgt = { x: P.well.x + ((a.id % 3) - 1) * 1.2, z: P.well.z - 1.2 }; doing = 'Lunch by the well'; }
    else { tgt = { x: P.plaza.x + ((a.id % 4) - 1.5) * 1.3, z: P.plaza.z + ((a.id % 2) ? 1 : -1) }; doing = 'Chatting in the square'; }
    const arrived = moveTo(a, tgt.x, tgt.z, 0.9 * dt);
    a.doing = arrived ? doing : (doing === 'Asleep' ? 'Heading home' : doing.startsWith('Walking') ? doing : 'On the way: ' + doing.toLowerCase());
    a.working = arrived && working;
    a.indoors = arrived && doing === 'Asleep';
  }
  function jobDoing(job) {
    return { field: 'Reaping wheat', forest: 'Felling pines', market: 'Trading at the post', well: 'Drawing water' }[job] || 'Working';
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

  /* ---------- the oven and the counter ---------- */
  function ovenStep(s, dt, speed, who) {
    const b = s.bakery, o = b.oven, T = tier(s);
    if (!o.loaded) {
      if (b.bread + T.batch > T.cap) { if (!s.stats.shelfFullAt) s.stats.shelfFullAt = clock(s.t); return 'full'; }
      if (b.grain < RECIPE.grain || b.wood < RECIPE.wood) { if (!s.stats.ovenIdleAt) s.stats.ovenIdleAt = clock(s.t); return 'empty'; }
      b.grain -= RECIPE.grain; b.wood -= RECIPE.wood;
      o.loaded = true; o.progress = 0; o.need = T.bakeMin;
    }
    o.progress += dt * speed;
    if (o.progress >= o.need) {
      o.loaded = false; o.progress = 0;
      b.bread += T.batch;
      s.stats.batches++; s.stats.batchesBy[who]++;
      s.goals.baked = true;
      event(s, (who === 'player' ? 'You' : s.worker.name) + ' baked ' + T.batch + ' loaves.', 'good');
      return 'done';
    }
    return 'baking';
  }

  function playerAttending(s) {
    const p = s.player;
    return !p.dest && !p.action && dist(p, P.serve) < 0.8;
  }
  function workerAttending(s) {
    const w = s.worker;
    return !!w && (w.task === 'serve' || w.task === 'tend') && dist(w, P.serve) < 0.8;
  }
  function workerSpeed(w) { return w.skill * (w.mood < 30 ? 0.7 : 1); }

  function updateCounter(s, dt) {
    const b = s.bakery;
    const pa = playerAttending(s), wa = workerAttending(s);
    if (pa) s.stats.playerMin += dt;
    if (!b.queue.length) { b.serveProgress = 0; return; }
    const front = agentById(s, b.queue[0]);
    if (!front) { b.queue.shift(); return; }
    if (front.phase !== 'queue' || dist(front, P.queue0) > 0.6 || b.bread <= 0) return;
    const speed = Math.max(pa ? 1 : 0, wa ? workerSpeed(s.worker) : 0);
    if (speed <= 0) return;
    b.serveProgress += dt * speed;
    if (b.serveProgress >= SERVE_MIN) {
      const qty = Math.min(front.qty, b.bread);
      const coin = qty * s.price;
      b.bread -= qty; s.coins += coin;
      s.stats.sold += qty; s.stats.revenue += coin; s.stats.served++;
      s.stats.servedBy[pa ? 'player' : 'worker']++;
      s.lifetime.sold += qty; s.lifetime.revenue += coin;
      b.serveProgress = 0;
      leaveShop(s, front, 'served');
      event(s, front.name + ' bought ' + qty + (qty === 1 ? ' loaf' : ' loaves') + ' for ' + coin + 'c.', 'coin');
    }
  }

  /* ---------- the player ---------- */
  function updatePlayer(s, dt) {
    const p = s.player;
    if (p.dest) {
      if (moveTo(p, p.dest.x, p.dest.z, 1.5 * dt)) {
        const then = p.dest.then; p.dest = null;
        if (then) beginAction(s, then);
      }
      return;
    }
    p.moving = false;
    const a = p.action;
    if (!a) return;
    if (a.type === 'bake') {
      s.stats.playerMin += dt;
      const r = ovenStep(s, dt, 1, 'player');
      if (r !== 'baking') {
        p.action = null;
        if (r === 'empty') event(s, 'Storage needs ' + RECIPE.grain + ' grain and ' + RECIPE.wood + ' wood to bake.', 'bad');
        if (r === 'full') event(s, 'The shelf is full. Sell some bread first.', 'bad');
        if (r === 'done' && s.bakery.queue.length) walkTo(s, P.serve);
      }
      return;
    }
    if (a.type === 'gather') {
      a.left -= dt;
      if (a.left <= 0) {
        const g = GATHER[a.good];
        const n = Math.min(g.n, CARRY - carried(s));
        p.inv[a.good] += n;
        if (a.good === 'grain') s.goals.gotGrain = true; else s.goals.gotWood = true;
        if (carried(s) >= CARRY) { p.action = null; event(s, 'Your arms are full (' + CARRY + ' items). Store or sell what you carry.', 'info'); }
        else a.left = g.min;
      }
    }
  }

  function walkTo(s, pt, then) {
    s.player.action = null;
    s.player.dest = { x: pt.x, z: pt.z, then: then || null };
  }

  function beginAction(s, then) {
    const p = s.player;
    if (then.type === 'gather') {
      if (carried(s) >= CARRY) { event(s, 'Your arms are full. Store or sell what you carry first.', 'bad'); return; }
      p.action = { type: 'gather', good: then.good, left: GATHER[then.good].min };
    } else if (then.type === 'bake') {
      p.action = { type: 'bake' };
      p.face = Math.PI;
    } else if (then.type === 'store') {
      storeGoods(s);
    } else if (then.type === 'storeThenBake') {
      storeGoods(s);
      walkTo(s, P.oven, { type: 'bake' });
    }
  }

  function storeGoods(s) {
    const p = s.player, b = s.bakery, T = tier(s);
    let moved = 0;
    for (const g of ['grain', 'wood']) {
      const room = T.cap - b[g];
      const n = Math.max(0, Math.min(room, p.inv[g]));
      b[g] += n; p.inv[g] -= n; moved += n;
    }
    if (moved) { s.goals.stored = true; event(s, 'Stored ' + moved + ' items at the bakery.', 'info'); }
    else if (p.inv.grain + p.inv.wood > 0) event(s, 'Bakery storage is full (' + T.cap + ' of each).', 'bad');
    else event(s, 'You are not carrying any grain or wood.', 'info');
  }

  /* ---------- the worker ---------- */
  function updateWorker(s, dt) {
    const w = s.worker;
    if (!w) return;
    const h = hourOf(s), b = s.bakery, T = tier(s);
    w.indoors = false;
    if (w.task === 'supply' && h >= 6 && h < 20) { supplyRun(s, w, dt); s.stats.workerMin += dt; return; }
    if (h < 6 || h >= 20) {
      w.task = 'sleep';
      if (moveTo(w, w.home.x, w.home.z, 1.1 * dt)) { w.indoors = true; w.why = 'Asleep at home'; } else w.why = 'Walking home';
      return;
    }
    if (h < 7) { w.task = 'commute'; moveTo(w, P.serve.x, P.serve.z, 1.1 * dt); w.why = 'Walking to work for 07:00'; return; }
    if (h >= 19) { w.task = 'home'; moveTo(w, w.home.x, w.home.z, 1.1 * dt); w.why = 'Shift over at 19:00, heading home'; return; }
    if (h >= 12 && h < 12.5) { w.task = 'lunch'; moveTo(w, P.bench.x, P.bench.z, 1.1 * dt); w.why = 'Lunch break until 12:30'; return; }

    s.stats.workerMin += dt;
    const sp = workerSpeed(w);
    const low = !b.oven.loaded && (b.grain < RECIPE.grain || b.wood < RECIPE.wood);
    const target = Math.min(T.cap - T.batch, T.batch * 2);
    const missingCost = Math.max(0, RECIPE.grain - b.grain) * BUY.grain + Math.max(0, RECIPE.wood - b.wood) * BUY.wood;
    if (s.policy.supplyRuns && low && s.coins >= missingCost && h < 18 && !(w.supWait > s.t)) {
      w.task = 'supply'; w.sup = { phase: 'go' };
      w.why = 'Storage is out of grain or wood, so ' + w.name + ' is buying more at the Trading Post';
      supplyRun(s, w, dt); return;
    }
    if (b.queue.length && b.bread > 0) {
      w.task = 'serve'; moveTo(w, P.serve.x, P.serve.z, 1.1 * dt);
      w.why = 'Serving ' + b.queue.length + (b.queue.length === 1 ? ' waiting customer' : ' waiting customers');
      return;
    }
    if (b.oven.loaded || (!low && b.bread < target)) {
      w.task = 'bake';
      if (moveTo(w, P.oven.x, P.oven.z, 1.1 * dt)) {
        w.face = Math.PI;
        const r = ovenStep(s, dt, sp, 'worker');
        w.why = r === 'baking' ? 'Baking: ' + Math.round(b.oven.progress / b.oven.need * 100) + '% done, shelf has ' + b.bread + ' (aims for ' + target + ')' : 'Checking the oven';
      } else w.why = 'Going to the oven: shelf has only ' + b.bread + ' loaves';
      return;
    }
    w.task = 'tend'; moveTo(w, P.serve.x, P.serve.z, 1.1 * dt);
    if (low) {
      if (!s.stats.ovenIdleAt && b.bread < target) s.stats.ovenIdleAt = clock(s.t);
      w.why = s.policy.supplyRuns ? 'Waiting: no grain or wood, and not enough coin to buy more' : 'Waiting at the counter: no grain or wood in storage';
    } else w.why = 'Minding the counter: shelf is stocked (' + b.bread + ' loaves)';
  }

  function supplyRun(s, w, dt) {
    const b = s.bakery, T = tier(s);
    if (w.sup.phase === 'go') {
      w.why = 'Walking to the Trading Post for supplies';
      if (moveTo(w, P.market.x - 0.8, P.market.z, 1.1 * dt)) {
        // buy only what is missing, up to three batches' worth, within coin and storage limits
        let g = b.grain >= RECIPE.grain * 3 ? 0 : Math.min(RECIPE.grain * 3 - b.grain, T.cap - b.grain);
        let wd = b.wood >= RECIPE.wood * 3 ? 0 : Math.min(RECIPE.wood * 3 - b.wood, T.cap - b.wood);
        while (g * BUY.grain + wd * BUY.wood > s.coins && (g > 0 || wd > 0)) {
          if (g >= wd * 2 && g > 0) g--; else wd--;
        }
        if (g + wd <= 0) { w.task = null; w.sup = null; w.supWait = s.t + 90; w.why = 'Could not afford supplies'; return; }
        const cost = g * BUY.grain + wd * BUY.wood;
        s.coins -= cost; s.stats.supplies += cost;
        w.carry = { grain: g, wood: wd };
        w.sup.phase = 'back';
        event(s, w.name + ' bought ' + w.carry.grain + ' grain and ' + w.carry.wood + ' wood for ' + cost + 'c.', 'info');
      }
    } else {
      w.why = 'Carrying supplies back to the bakery';
      if (moveTo(w, P.store.x, P.store.z, 1.0 * dt)) {
        b.grain = Math.min(T.cap, b.grain + w.carry.grain);
        b.wood = Math.min(T.cap, b.wood + w.carry.wood);
        w.carry = null; w.task = null; w.sup = null;
      }
    }
  }

  /* ---------- commands from the player ---------- */
  function cmd(s, name, a, b) {
    const p = s.player, T = tier(s);
    switch (name) {
      case 'walk': walkTo(s, a); return ok();
      case 'goto': {
        const L = LOCS[a];
        if (a === 'bakery') { walkTo(s, P.serve); return ok(); }
        if (a === 'market') { walkTo(s, P.market); return ok(); }
        if (a === 'home') { walkTo(s, P.home); return ok(); }
        walkTo(s, { x: L.x, z: L.z + L.r * 0.6 }); return ok();
      }
      case 'gather': {
        const g = GATHER[a];
        if (carried(s) >= CARRY) return fail('Your arms are full. Store or sell first.');
        const L = LOCS[g.loc];
        const here = dist(p, L) < L.r;
        const spot = here ? { x: p.x, z: p.z } : (a === 'grain'
          ? { x: L.x - 3 + rand(s) * 6, z: L.z - 2 + rand(s) * 4 }
          : { x: L.x + 4 + rand(s) * 2, z: L.z + 3 + rand(s) * 2 });
        walkTo(s, spot, { type: 'gather', good: a });
        return ok();
      }
      case 'bake': {
        const bk = s.bakery;
        if (!bk.oven.loaded && bk.bread + T.batch > T.cap) return fail('The shelf is full. Sell bread before baking more.');
        if (!bk.oven.loaded && (bk.grain < RECIPE.grain || bk.wood < RECIPE.wood)) {
          const carry = p.inv.grain >= RECIPE.grain - bk.grain && p.inv.wood >= RECIPE.wood - bk.wood;
          if (!carry) return fail('The oven needs ' + RECIPE.grain + ' grain and ' + RECIPE.wood + ' wood in bakery storage.');
          walkTo(s, P.store, { type: 'storeThenBake' });
          return ok();
        }
        walkTo(s, P.oven, { type: 'bake' });
        return ok();
      }
      case 'store': {
        if (dist(p, LOCS.bakery) < LOCS.bakery.r) { storeGoods(s); return ok(); }
        walkTo(s, P.store, { type: 'store' }); return ok();
      }
      case 'serve': walkTo(s, P.serve); return ok();
      case 'buy': case 'sell': {
        if (dist(p, LOCS.market) > LOCS.market.r) return fail('Go to the Trading Post first.');
        const n = b || 1;
        if (name === 'buy') {
          const cost = BUY[a] * n;
          if (s.coins < cost) return fail('You need ' + cost + 'c for that.');
          if (carried(s) + n > CARRY) return fail('You can carry ' + CARRY + ' items at most.');
          s.coins -= cost; s.stats.supplies += cost; p.inv[a] += n;
          return ok('Bought ' + n + ' ' + a + ' for ' + cost + 'c.');
        }
        if (p.inv[a] < n) return fail('You have only ' + p.inv[a] + ' ' + a + '.');
        p.inv[a] -= n; const got = SELL[a] * n; s.coins += got; s.stats.otherIncome += got;
        return ok('Sold ' + n + ' ' + a + ' for ' + got + 'c.');
      }
      case 'setPrice': s.price = clamp(Math.round(a), 1, 15); return ok();
      case 'policy': s.policy[a] = !!b; return ok();
      case 'hire': {
        if (s.worker) return fail('You already have a worker.');
        const ap = s.applicants[a];
        if (!ap) return fail('That applicant has gone.');
        const wage = clamp(Math.round(b || ap.ask), 1, 30);
        s.worker = {
          name: ap.name, skill: ap.skill, ask: ap.ask, wage, mood: 60, x: P.road.x - 6, z: P.plaza.z,
          face: 0, home: P.workerHome, task: null, why: 'Just hired', warned: false, carry: null, sup: null, hiredDay: s.day
        };
        s.applicants = []; s.goals.hired = true;
        event(s, ap.name + ' is hired at ' + wage + 'c a day. Wages are paid at closing (21:00).', 'good');
        return ok();
      }
      case 'setWage': if (s.worker) s.worker.wage = clamp(Math.round(a), 1, 30); return ok();
      case 'fire': {
        if (!s.worker) return fail('No worker to let go.');
        const w = s.worker; s.worker = null; makeApplicants(s);
        event(s, 'You let ' + w.name + ' go.', 'info');
        return ok();
      }
      case 'upgrade': {
        const next = TIERS[s.tier + 1];
        if (!next) return fail('Your bakery is fully upgraded.');
        const wood = p.inv.wood + s.bakery.wood;
        if (s.coins < next.cost.coin || wood < next.cost.wood) return fail('Needs ' + next.cost.coin + 'c and ' + next.cost.wood + ' wood (you have ' + s.coins + 'c, ' + wood + ' wood).');
        s.coins -= next.cost.coin;
        let need = next.cost.wood;
        const fromInv = Math.min(p.inv.wood, need); p.inv.wood -= fromInv; need -= fromInv;
        s.bakery.wood -= need;
        s.tier++;
        event(s, 'Your bakery is now a ' + next.name + '! Bigger batches, more storage, and more travelers will stop by.', 'story');
        return ok();
      }
      case 'stop': p.action = null; p.dest = null; return ok();
    }
    return fail('Unknown command');
  }
  const ok = msg => ({ ok: true, msg });
  const fail = msg => ({ ok: false, msg });

  /* ---------- stepping ---------- */
  function crossed(a, b, mark) {
    return Math.floor((b - mark) / DAY) > Math.floor((a - mark) / DAY);
  }
  function rate(s) {
    const h = hourOf(s);
    return (h >= 21 || h < 6) ? 45 : 4; // game minutes per real second
  }
  function step(s, dt) {
    const before = s.t;
    s.t += dt;
    if (crossed(before, s.t, 21 * 60)) closeDay(s);
    if (crossed(before, s.t, 6 * 60)) openDay(s);
    const h = hourOf(s);
    if (h >= 6 && h < 21) spawnScheduled(s);
    updatePlayer(s, dt);
    updateWorker(s, dt);
    updateAgents(s, dt);
    updateCounter(s, dt);
  }
  function advance(s, minutes) {
    let left = minutes;
    while (left > 1e-9) { const d = Math.min(1, left); step(s, d); left -= d; }
  }

  /* ---------- saving ---------- */
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(str) {
    const s = JSON.parse(str);
    if (!s || typeof s !== 'object' || typeof s.v !== 'number') throw new Error('Not a Hearthmoor save');
    if (s.v > VERSION) throw new Error('This save is from a newer version');
    // future migrations go here: if (s.v === 1) { ...; s.v = 2; }
    if (!s.player || !s.bakery || !Array.isArray(s.agents)) throw new Error('Save is missing data');
    return s;
  }

  const api = {
    VERSION, P, LOCS, HOMES, TIERS, RECIPE, BUY, SELL, GATHER, GOALS, CARRY, WHY,
    newGame, step, advance, cmd, rate, serialize, deserialize, hourOf, clock, hm, tier, carried, skillLabel, dist
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
