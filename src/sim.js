/* Hearthmoor simulation core (v2).
   Pure game logic: no rendering, no DOM, no Math.random. The whole game state is plain JSON,
   so it can be saved, restored and tested headless. */
(function (root) {
  'use strict';

  const VERSION = 9;
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
      recipe: { wood: 3 }, wtp: 15, sd: 3, price: 12, villagerRate: 0.3, qty2: 0, qty3: 0, hours: [8, 18],
      tiers: [
        { name: "Carpenter's Bench", out: 1, min: 45, cap: 8, travelers: 2, upkeep: 1, cost: { coin: 25 } },
        { name: 'Timber Workshop', out: 2, min: 45, cap: 16, travelers: 3, upkeep: 3, cost: { coin: 90, wood: 15 } },
        { name: 'Joinery Hall', out: 3, min: 40, cap: 24, travelers: 5, upkeep: 6, cost: { coin: 220, wood: 30 } }
      ]
    }
  };
  const TRADE_KEYS = Object.keys(TRADES);

  /* ---------- the map ----------
     Hearthmoor, rebuilt: a 160 m village grown around its square, its lanes and its stream.
     x runs east, z runs south, so north is -z. The square is at (0, 4). */
  // dir: which way a shop faces. 1 = its counter faces south (+z), -1 = it faces north (-z)
  const PLOTS = [
    { x: -14, z: 30, name: 'West lot', dir: -1 }, { x: 0, z: 31, name: 'Middle lot', dir: -1 }, { x: 14, z: 30, name: 'East lot', dir: -1 },
    { x: -30, z: -16, name: 'Hall lot', grant: true, dir: 1 }
  ];
  const REL = { serve: { x: 0, z: 0.4 }, queue0: { x: 0, z: 2.6 }, station: { x: -2.3, z: -0.8 }, store: { x: 2.4, z: -0.6 }, bench: { x: 3.9, z: 2.4 } };
  const EMPLOYERS = [
    { id: 'gerd', trade: 'bakery', name: "Gerd's Bakehouse", boss: 'Gerd', x: -12, z: -8, dir: 1, shift: [6, 12], wage: 6 },
    { id: 'forge', trade: 'smithy', name: "Hollin's Forge", boss: 'Hollin', x: 12, z: -8, dir: 1, shift: [8, 14], wage: 8 },
    { id: 'tankard', trade: 'tavern', name: 'The Crooked Tankard', boss: 'Mother Ysolde', x: -12, z: 17, dir: -1, shift: [15, 21], wage: 6 },
    { id: 'ash', trade: 'joinery', name: 'Ash & Sons Joinery', boss: 'Ash', x: 12, z: 17, dir: -1, shift: [9, 15], wage: 7 }
  ];
  // the mill: a village business on the millrace, run by its own miller (no shifts for hire yet)
  const MILL = { id: 'mill', trade: 'mill', name: "Tamsin's Mill", boss: 'Tamsin', x: -26, z: -42, dir: 1, shift: [6, 15], wage: 7, noJob: true };
  EMPLOYERS.concat([MILL]).forEach(e => { e.spot = { x: e.x - 2.3 * e.dir, z: e.z - 0.8 * e.dir }; e.front = { x: e.x, z: e.z + 3.2 * e.dir }; });
  MILL.spot = { x: -23.2, z: -40.5 };
  const BIZ_SITES = EMPLOYERS.concat([MILL]);
  const LOCS = {
    field: { x: -46, z: -30, r: 10, name: 'Wheat Field' },
    forest: { x: -62, z: 6, r: 10, name: 'Pine Woods' },
    pit: { x: 40, z: -52, r: 6, name: 'Iron Pit' },
    market: { x: 34, z: 12, r: 4, name: 'Trading Post' },
    home: { x: -38, z: 20, r: 3, name: 'Your Hut' },
    well: { x: 0, z: 4, r: 2.2, name: 'Village Well' },
    hall: { x: -31, z: 4, r: 5.5, name: 'Village Hall' },
    granary: { x: 26, z: -15, r: 3.4, name: 'Granary' },
    tower: { x: 64, z: -6, r: 4, name: 'Old Watchtower' },
    manor: { x: 2, z: -52, r: 7, name: 'Varrow Manor' },
    cottage: { x: 40, z: 38, r: 3.5, name: "Old Ama's Cottage" },
    mill: { x: -26, z: -42, r: 5, name: "Tamsin's Mill" },
    barn: { x: 30, z: -36, r: 5, name: 'The Barn' },
    bridge: { x: 50, z: 4, r: 4, name: 'Stream Bridge' },
    lots: { x: 0, z: 54, r: 10, name: 'Open land' },
    waystation: { x: 226, z: -34, r: 9, name: 'The Waystation' },
    ruin: { x: 290, z: -246, r: 12, name: 'Old Barrow Keep' },
    oakgate: { x: 404, z: -372, r: 12, name: 'Oakbridge Gate' }
  };
  PLOTS.forEach((p, i) => { LOCS['plot' + i] = { x: p.x, z: p.z, r: 4.6, name: p.name, plot: i }; });
  EMPLOYERS.forEach(e => { LOCS['emp:' + e.id] = { x: e.x, z: e.z + 1.5 * e.dir, r: 3.8, name: e.name, emp: e.id }; });
  const P = {
    market: { x: 34, z: 9.4 }, well: { x: 0, z: 5.8 }, plaza: { x: 0, z: 9 }, center: { x: 0, z: 4 },
    road: { x: 82, z: 4 }, home: { x: -35.6, z: 20 },
    hall: { x: -26, z: 4 }, granary: { x: 26, z: -12.2 }, tower: { x: 62, z: -1.6 }, gate: { x: 2, z: -38.6 }, cottage: { x: 38, z: 35.6 },
    manorRoad: { x: 2, z: -37 }, square: { x: 5, z: 1 }, mill: { x: -26, z: -38.2 },
    elderDesk: { x: -27.4, z: 6.2 }, guardPost: { x: 4.4, z: -38.4 }
  };
  // homes: whole households live together; rent is paid per household
  const HOUSES = [
    { name: 'Fern Cottage', x: -12, z: -24, cap: 4 }, { name: 'Brook House', x: 18, z: -24, cap: 4 }, { name: 'The Long Hut', x: -40, z: -8, cap: 5 },
    { name: 'Mill Row', x: -28, z: 27, cap: 3 }, { name: 'Thorn Hut', x: 28, z: 27, cap: 3 }, { name: 'Ash Lane', x: 28, z: -2, cap: 3 },
    { name: 'Elder’s House', x: -19, z: -14, cap: 3 }, { name: 'Hill Croft', x: 22, z: 42, cap: 3 }, { name: 'West Croft', x: -40, z: 34, cap: 3 },
    { name: 'Wood End', x: -22, z: 44, cap: 3 }
  ];
  const HOMES = HOUSES, WORKER_HOMES = [], NEW_HUTS = [];

  /* ---------- the land beyond the village (Stage II) ----------
     One continuous world, in metres, with Hearthmoor's square near the origin.
     Distances follow the world map: Oakbridge about 600 m north-east by road, Greenhaven further north-west. */
  const TOWNS = {
    hearthmoor: { name: 'Hearthmoor', x: 0, z: 4, r: 95 },
    oakbridge: { name: 'Oakbridge', x: 432, z: -432, r: 72, open: true },
    greenhaven: { name: 'Greenhaven', x: -238, z: -826, r: 95, open: true }
  };
  const ROADS = {
    east: [[88, 5], [120, 3], [160, -8], [200, -28], [240, -58], [272, -104], [298, -162], [326, -226], [356, -286], [384, -332], [404, -366]]
  };
  // the river Alder runs down from the mountains through Oakbridge, under its bridge, and on to the sea
  const RIVER = [[540, -1500], [500, -1100], [470, -800], [452, -560], [438, -432], [466, -300], [536, -180], [640, -60], [780, 60], [940, 160]];
  const WAYSTATION = { x: 226, z: -34 }, RUIN = { x: 290, z: -246 }, OAKGATE = { x: 404, z: -368 };

  /* ---------- the realm around the village ---------- */
  const REALM = {
    lord: 'Lord Edric Varrow', lordShort: 'Lord Varrow', elder: 'Elder Brannoch', steward: 'Steward Merrin', king: 'King Aldwin', capital: 'Highcrown',
    towns: ['Ashford', 'Kellmere', 'Highcrown']
  };
  const RUMORS = [
    'Ashford’s river barges are carrying twice the grain this year. Their mayor is getting rich.',
    'Kellmere’s mines found a new seam of iron. Smiths there pay well for good charcoal.',
    'They say ' + 'King Aldwin' + ' is calling his lords to Highcrown before winter.',
    'Bandits were seen on the Ashford road last week. Travel in daylight.',
    'Lord Varrow keeps to his manor. His steward does the real work.',
    'In Highcrown a shopkeeper bought a seat on the city council. Coin opens doors there.',
    'Kellmere and Ashford are quarrelling over the toll bridge again.',
    'A village that feeds its own in a lean year is remembered by its lord.'
  ];
  const PROJECTS = {
    pave: { name: 'Pave the square', cost: 60, text: 'Stone on the square. Every shop draws one more traveler a day.' },
    lanterns: { name: 'Lanterns on the square', cost: 40, text: 'Lamps for the evenings. Villagers shop a little more often.' },
    granary: { name: 'Enlarge the granary', cost: 50, text: 'A bigger store. No more grain shortages.' },
    well: { name: 'Dig a second well', cost: 35, text: 'Less hauling of water. Villagers are a little happier.' },
    road: { name: 'Mend the Ashford road', cost: 70, text: 'Carts come easier. One more traveler to every shop a day.' }
  };
  const TOLLS = { none: { name: 'No toll', coin: 0, travelers: 1 }, low: { name: 'Low toll (2c)', coin: 2, travelers: 0.85 }, high: { name: 'High toll (5c)', coin: 5, travelers: 0.6 } };
  const DISPUTES = [
    { a: 'Aldric', b: 'Maren', text: 'Aldric says Maren’s goats ate his barley. Maren says the fence was his to mend.', opts: [
      { label: 'Maren pays Aldric 5c', favor: { Aldric: 1, Maren: -1 }, standing: 3 },
      { label: 'Aldric mends his own fence', favor: { Aldric: -1, Maren: 1 }, standing: 3 },
      { label: 'The chest pays 5c and both mend the fence', favor: { Aldric: 1, Maren: 1 }, standing: 6, chest: -5 } ] },
    { a: 'Tobin', b: 'Edda', text: 'Tobin felled a pine that crushed the cart Edda uses to haul ore. Edda wants a new cart; Tobin says she parked it in the woods.', opts: [
      { label: 'Tobin builds Edda a cart', favor: { Tobin: -1, Edda: 1 }, standing: 3 },
      { label: 'Edda should have known better', favor: { Tobin: 1, Edda: -1 }, standing: 2 },
      { label: 'The chest pays 8c toward a new cart', favor: { Tobin: 1, Edda: 1 }, standing: 6, chest: -8 } ] },
    { a: 'Wynn', b: 'Old Sela', text: 'Wynn wants to sell water at the Trading Post. Old Sela says the well belongs to everyone.', opts: [
      { label: 'The well stays free', favor: { Wynn: -1, 'Old Sela': 1 }, standing: 5 },
      { label: 'Let Wynn sell it, and pay the chest 1c a day', favor: { Wynn: 1, 'Old Sela': -1 }, standing: 1, chestDaily: 1 },
      { label: 'Wynn may sell to travelers only', favor: { Wynn: 1, 'Old Sela': 0 }, standing: 4 } ] },
    { a: 'Maren', b: 'Tobin', text: 'Maren and Tobin both want the last plot by the stream for their sons’ cottages.', opts: [
      { label: 'Maren’s family has waited longer', favor: { Maren: 1, Tobin: -1 }, standing: 3 },
      { label: 'Tobin cleared the land himself', favor: { Maren: -1, Tobin: 1 }, standing: 3 },
      { label: 'Draw lots at the moot', favor: {}, standing: 4 } ] }
  ];
  const JOBLESS = ['Hilda', 'Bram'];
  const STEPS = [
    'Meet Elder Brannoch at the Village Hall',
    'Own a business so the village takes you seriously',
    'End the grain shortage: bring 20 grain to the granary',
    'Give work to Hilda and Bram, who sit idle in the square',
    'Rebuild the old watchtower on the east road (80c and 20 wood)',
    'Answer the elder’s summons to the Village Hall',
    'Serve on the council: fund a village project and settle a dispute',
    'Answer Lord Varrow’s letter at the manor gate',
    'Earn the village’s full trust (standing 80) so the elder names you his successor'
  ];
  const MANOR_HOME = { x: 2, z: -54 };
  const BIZ_BASE = { bakery: 26, smithy: 30, tavern: 26, joinery: 23, mill: 24 };
  const OFFICES = {
    lord: { title: 'Lord of Hearthmoor', salary: 0, home: 'manor' },
    steward: { title: 'Steward', salary: 10, home: 'manor' },
    elder: { title: 'Village Elder', salary: 5, home: null },
    taxman: { title: 'Tax collector', salary: 6, home: 'manor' },
    guard: { title: 'Manor guard', salary: 6, home: 'manor' }
  };
  const FOOD = 3, ODD_JOBS = 3, COMMONS_PAY = 7, EVICT_AFTER = 3, LEAVE_AFTER = 4;
  const INTEREST = 0.02, SEIZE_AT = -150, SEIZE_DAYS = 3, CHEST_FLOOR = -150, LORD_FALL = -300, COUNCIL_SEATS = 3;
  const VILLAGERS = [
    { name: 'Aldric', job: 'field' }, { name: 'Maren', job: 'field' }, { name: 'Tobin', job: 'forest' },
    { name: 'Edda', job: 'pit' }, { name: 'Wynn', job: 'market' }, { name: 'Old Sela', job: 'well' }
  ];
  const TRAVELERS = ['A pilgrim', 'A tinker', 'A drover', 'A peddler', 'A soldier', 'A minstrel', 'A shepherd', 'A friar'];
  const APPLICANTS = ['Hilda', 'Bram', 'Osric', 'Linnet', 'Cade', 'Freya', 'Rolf', 'Agnes', 'Piers', 'Wenna', 'Garth', 'Isolde'];

  const BUY = { grain: 2, wood: 2, ore: 3 };
  const SELL = { grain: 1, wood: 1, ore: 1 };
  const GATHER = { grain: { min: 20, n: 2, loc: 'field' }, wood: { min: 26, n: 2, loc: 'forest' }, ore: { min: 32, n: 2, loc: 'pit' } };

  const CHAPTERS = [
    { n: 1, name: 'The Hired Hand', lead: 'From nothing to a business of your own.' },
    { n: 2, name: 'A Place in the Village', lead: 'From shopkeeper to someone the village relies on.' }
  ];
  const GOALS = [
    { id: 'job', ch: 1, text: 'Ask for work at one of the four shops across the square', done: s => s.rec.jobsHeld > 0 },
    { id: 'learn', ch: 1, text: 'Work ' + LEARN_SHIFTS + ' full shifts to learn the basics of that trade', done: s => TRADE_KEYS.some(t => learned(s, t)) },
    { id: 'open', ch: 1, text: 'Save up and open your own shop on an empty lot', done: s => s.rec.shopsOpened > 0 },
    { id: 'sell', ch: 1, text: 'Sell 10 goods from your own shop', done: s => s.rec.goodsSold >= 10 },
    { id: 'hire', ch: 1, text: 'Hire a worker for your shop', done: s => s.rec.workersHired > 0 },
    { id: 'two', ch: 1, text: 'Own two businesses', done: s => s.rec.shopsOpened >= 2 }
  ].concat(STEPS.map((text, i) => ({ id: 'v' + i, ch: 2, text, done: s => s.village.step > i })));

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
  // people walk at about 1.4 m a second on the 18-minute day; WALKX converts the old speeds
  const WALKX = 1.8;
  function moveTo(a, tx, tz, step, s) {
    step *= WALKX;
    if (a.tx == null || Math.abs(a.tx - tx) + Math.abs(a.tz - tz) > 0.5) { a.tx = tx; a.tz = tz; a.settle = false; }
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    // close enough: someone may be standing right on the spot, so stop here instead of shoving into them
    if ((d < 0.45 && a.moving === false) || (a.settle === 2 && d < 6) || (a.settle && d < 1.2)) { a.moving = false; return true; }
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
  // lookups stay fast as towns grow: an index per array, rebuilt only when the array changes
  const IDX = new WeakMap();
  function indexOf(arr, key) {
    let e = IDX.get(arr);
    if (!e || e.n !== arr.length || e.first !== arr[0] || e.last !== arr[arr.length - 1]) { const m = new Map(); for (const x of arr) m.set(x[key], x); e = { n: arr.length, first: arr[0], last: arr[arr.length - 1], m }; IDX.set(arr, e); }
    return e.m;
  }
  const agentById = (s, id) => { const a = indexOf(s.agents, 'id').get(id); return a && a.id === id ? a : s.agents.find(x => x.id === id); };
  const shopById = (s, id) => s.shops.find(x => x.id === id);
  const shopOnPlot = (s, i) => s.shops.find(x => x.plot === i);
  const tierOf = shop => TRADES[shop.trade].tiers[shop.tier];
  const plotPt = (shop, k) => { const L0 = PLOTS[shop.plot], d = L0.dir || 1; return { x: L0.x + REL[k].x * d, z: L0.z + REL[k].z * d }; };
  const queueSlot = (shop, i) => { const q = plotPt(shop, 'queue0'); return { x: q.x, z: q.z + i * 1.0 * (PLOTS[shop.plot].dir || 1) }; };
  const empById = id => BIZ_SITES.find(e => e.id === id);
  function learned(s, trade) { return s.trades[trade] >= LEARN_SHIFTS; }
  function tradeSpeed(s, trade) { return 1 + Math.min(0.3, s.trades[trade] * 0.03); }
  function skillPct(s, trade) { return Math.round(Math.min(0.3, s.trades[trade] * 0.03) * 100); }
  function addStanding(s, n, why) {
    if (n && s.gov) approveHolder(s, 'player', n * 0.5);
    const v = s.village; v.standing = clamp(v.standing + n, 0, 100); if (n > 0) s.rec.standingEarned += n;
    if (why) event(s, (n >= 0 ? 'Standing +' : 'Standing ') + n + ': ' + why, n >= 0 ? 'good' : 'bad');
  }
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
    const st = { day: s.day, shops: {}, jobPay: 0, rawSales: 0, marketBuys: 0, rent: 0, tax: 0, contract: 0, given: 0, property: 0, owned: 0, salaries: 0, interest: 0, seized: 0, notes: [] };
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
      peakCoins: 0, days: 0,
      standingEarned: 0, elderTasks: 0, councilSince: null, projectsFunded: 0, disputesSettled: 0, grainDonated: 0, chestGiven: 0,
      taxesPaid: 0, contractsDone: 0, contractsMissed: 0, housesOwned: 0, rentCollected: 0, shopsSold: 0,
      evictions: 0, peopleLeft: 0, bizBought: 0, staffFired: 0, offices: 0, rentRaises: 0,
      maxDebt: 0, interestPaid: 0, seizures: 0, votesWon: 0, votesLost: 0, timesElected: 0
    };
  }
  function freshVillage() {
    return {
      step: 0, standing: 0, shortage: false, granary: 0, granaryNeed: 20, jobless: [], towerCoin: 0, towerWood: 0, towerBuilt: false,
      council: false, chest: 0, chestDaily: 0, projects: {}, toll: 'none', dispute: null, disputeDay: 0, usedDisputes: [], favor: {},
      landGranted: false, letter: false, metSteward: false, cottage: 'forsale', contract: null, taxDue: null
    };
  }

  /* ---------- new game ---------- */
  function newGame(seed, name) {
    const s = {
      v: VERSION, t: 6 * 60, day: 1, rng: (seed | 0) || 12345, coins: 5, name: name || 'Wren',
      player: { x: P.home.x, z: P.home.z, face: 0, dest: null, action: null, inv: { grain: 0, wood: 0, ore: 0 } },
      shops: [], nextShop: 1, job: null, trades: { bakery: 0, smithy: 0, tavern: 0, joinery: 0 },
      agents: [], nextId: 1, schedule: [], applicants: [], ledger: [], events: [], rec: freshRecords(), stats: null, village: freshVillage()
    };
    setupPeople(s);
    initGov(s);
    setupOakbridge(s);
    setupGreenhaven(s);
    openDay(s);
    event(s, 'Day 1. You arrive in Hearthmoor, a village of ' + lordTitle(s) + ', with 5 coins. The four shops across the square are hiring.', 'story');
    return s;
  }

  function jobSpot(s, job) {
    const j = () => (rand(s) - 0.5);
    if (job === 'field') return { x: LOCS.field.x + j() * 8, z: LOCS.field.z + j() * 6 };
    if (job === 'forest') return { x: LOCS.forest.x + 3 + j() * 5, z: LOCS.forest.z + 2 + j() * 5 };
    if (job === 'pit') return { x: LOCS.pit.x + j() * 4, z: LOCS.pit.z + j() * 3 };
    if (job === 'market') return { x: LOCS.market.x + 1.6, z: LOCS.market.z - 0.6 };
    const sp = OAK.spots[job] || GH.spots[job]; if (sp) return { x: sp.x + j() * 2 * sp.rx, z: sp.z + j() * 2 * sp.rz };
    return { x: P.well.x + 1.2, z: P.well.z + 0.4 };
  }

  /* ---------- day cycle ---------- */
  function openDay(s) {
    s.day = Math.floor((s.t - 360) / DAY) + 1;
    s.stats = freshStats(s);
    if (s.people) peopleMorning(s);
    for (const shop of s.shops) if (shop.worker && shop.worker.pid) { const wp = person(s, shop.worker.pid); shop.worker.home = (wp && homePoint(s, wp)) || { x: P.well.x - 1.5, z: P.well.z + 2.2 }; }
    const base = s.t - minuteOfDay(s.t);
    const sched = [];
    const v = s.village;
    if (v.council && v.step >= 6 && !v.projects.granary && !v.shortage && rand(s) < 0.12) {
      v.shortage = true; v.granary = 0; v.granaryNeed = 12;
      event(s, 'A lean week: the granary is running low again. Villagers will buy less until it is refilled (12 grain), or enlarged by the council.', 'bad');
    }
    for (const shop of s.shops) {
      const T = TRADES[shop.trade], Ti = tierOf(shop);
      const [o, c] = T.hours;
      const when = () => base + (o + rand(s) * (c - o - 0.6)) * 60;
      const vr = T.villagerRate * (v.shortage ? 0.5 : 1) + (v.projects.lanterns ? 0.08 : 0);
      villagers(s).filter(p => p.purse >= shop.price && !p.kid && !(p.job && ['guard', 'lord', 'steward', 'taxman'].includes(p.job.office))).forEach(p => { if (rand(s) < vr) sched.push({ at: when(), pid: p.id, shop: shop.id }); });
      const n = Math.max(0, Math.round((Ti.travelers + (v.projects.pave ? 1 : 0) + (v.projects.road ? 1 : 0) + Math.floor(rand(s) * 3) - 1) * TOLLS[v.toll].travelers));
      for (let i = 0; i < n; i++) sched.push({ at: when(), id: null, shop: shop.id });
    }
    if (s.day % 7 === 0) sched.push({ at: base + 10 * 60, id: null, shop: null, taxman: true });
    sched.sort((a, b) => a.at - b.at);
    s.schedule = sched;
    makeApplicants(s);
    // merchant orders
    if (v.contract && s.day > v.contract.until) { event(s, 'The order for ' + v.contract.who + ' lapsed unfilled.', 'bad'); v.contract = null; s.rec.contractsMissed++; }
    if (!v.contract && s.shops.length && rand(s) < 0.5) {
      const shop = s.shops[Math.floor(rand(s) * s.shops.length)], T = TRADES[shop.trade], Ti = tierOf(shop);
      const qty = Math.max(2, Ti.out * 2 + Math.floor(rand(s) * 3));
      v.contract = { trade: shop.trade, qty, reward: Math.round(qty * T.price * 1.6), until: s.day + 3, who: ['A drover bound for Ashford', 'A Kellmere mining crew', 'A wagon train to Highcrown', 'The innkeeper at Ashford'][Math.floor(rand(s) * 4)] };
      event(s, v.contract.who + ' wants ' + goodsName(shop.trade, qty) + ' delivered to the Trading Post by day ' + v.contract.until + ' for ' + v.contract.reward + 'c.', 'story');
    }
    // the council hears a dispute every few days
    if (v.council && !v.dispute && s.day >= v.disputeDay) {
      const pool = DISPUTES.map((d, i) => i).filter(i => !v.usedDisputes.includes(i));
      const pick = (pool.length ? pool : DISPUTES.map((d, i) => i))[Math.floor(rand(s) * (pool.length || DISPUTES.length))];
      v.dispute = pick; v.usedDisputes.push(pick);
      if (v.usedDisputes.length >= DISPUTES.length) v.usedDisputes = [];
      event(s, DISPUTES[pick].a + ' and ' + DISPUTES[pick].b + ' bring a quarrel to the council. Settle it at the Village Hall.', 'story');
    }
    v.chest += v.chestDaily;
    if (v.cottage === 'repaired') { v.cottage = 'let'; event(s, 'A family from Ashford rents your cottage for 5c a day, paid at closing.', 'good'); }
    if (s.day > 1) event(s, 'Day ' + s.day + ' begins.', 'story');
    if (s.gov) govMorning(s);
    if (s.towns) townMorning(s);
  }

  function makeApplicants(s) {
    s.applicants = [];
    const taken = s.shops.filter(x => x.worker).map(x => x.worker.name).concat(Object.values(s.people || {}).map(p => p.name));
    const seekers = s.people ? villagers(s).filter(idleAdult) : [];
    seekers.sort((a, b) => (s.village.jobless.includes(b.name) ? 1 : 0) - (s.village.jobless.includes(a.name) ? 1 : 0));
    for (const p of seekers.slice(0, 4)) s.applicants.push({ name: p.name, pid: p.id, skill: Math.round((0.7 + p.skill * 0.5) * 100) / 100, ask: Math.round(4 + p.skill * 5), local: true });
    for (let i = 0; i < (s.applicants.length >= 2 ? 1 : 2); i++) {
      const skill = Math.round((0.7 + rand(s) * 0.6) * 100) / 100;
      const ask = Math.round(3 + skill * 6);
      let name, guard = 0;
      do { name = APPLICANTS[Math.floor(rand(s) * APPLICANTS.length)]; guard++; } while ((s.applicants.some(a => a.name === name) || taken.includes(name) || JOBLESS.includes(name)) && guard < 50);
      s.applicants.push({ name, skill, ask, newcomer: true });
    }
  }
  function skillLabel(skill) { return skill < 0.85 ? 'Slow but cheap' : skill < 1.1 ? 'Steady' : 'Quick hands'; }

  function closeDay(s) {
    const st = s.stats;
    if (s.player.horse) { spend(s, STABLING); st.stabling = (st.stabling || 0) + STABLING; }
    if (s.village.cottage === 'let') { earn(s, 5); st.rent += 5; s.rec.rentCollected += 5; }
    if (s.people) { bizDay(s); peopleEvening(s); }
    if (s.gov) govEvening(s);
    if (s.towns) townEvening(s);
    const entry = { day: st.day, shops: [], jobPay: st.jobPay, rawSales: st.rawSales, marketBuys: st.marketBuys, rent: st.rent, tax: st.tax, contract: st.contract, given: st.given, property: st.property, owned: st.owned || 0, salaries: st.salaries || 0, interest: st.interest || 0, seized: st.seized || 0, notes: st.notes.slice() };
    entry.ownedBiz = s.people ? Object.values(s.biz).filter(b => b.owner === 'player').map(b => ({ name: empById(b.id).name, revenue: b.lastRevenue, wages: b.lastWages, profit: b.lastProfit })) : [];
    for (const shop of s.shops) {
      const ss = shopStats(s, shop), Ti = tierOf(shop), w = shop.worker;
      if (w) {
        const paid = w.wage; // wages are owed in full, even if it puts you in debt
        spend(s, paid); ss.wages += paid; s.rec.wagesPaid += paid;
        if (w.pid && s.people[w.pid]) s.people[w.pid].purse += paid;
        const full = paid >= w.wage;
        if (!full) { w.mood -= 25; w.unpaid = (w.unpaid || 0) + 1; }
        else { w.unpaid = 0; w.mood += w.wage >= w.ask ? 6 + Math.min(6, (w.wage - w.ask) * 2) : -(w.ask - w.wage) * 7; }
        w.mood = clamp(w.mood, 0, 100);
        ss.workerPaid = full; ss.workerName = w.name; ss.workerMood = Math.round(w.mood);
      }
      const up = Ti.upkeep;
      spend(s, up); ss.upkeep = up; ss.upkeepUnpaid = 0;
      const e = Object.assign({}, ss, { label: shopLabel(shop), tierName: Ti.name });
      e.costs = e.supplies + e.wages + e.upkeep; e.profit = e.revenue - e.costs;
      e.notes = explainShop(s, shop, e);
      entry.shops.push(e);
    }
    entry.income = entry.shops.reduce((a, e) => a + e.revenue, 0) + entry.jobPay + entry.rawSales + entry.rent + entry.contract + Math.max(0, entry.owned) + entry.seized;
    entry.costs = entry.shops.reduce((a, e) => a + e.costs, 0) + entry.marketBuys + entry.tax + entry.given + Math.max(0, -entry.owned) + entry.salaries + entry.interest;
    if (s.coins < 0) entry.notes.push({ text: 'You are ' + (-s.coins) + 'c in debt to the Ashford moneylender. Interest of 2% a day is added every evening' + (s.coins <= SEIZE_AT ? ', and creditors will seize your property if you stay below ' + SEIZE_AT + 'c.' : '.') });
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

    if (s.people) managersDay(s, entry);
    for (const shop of s.shops) {
      const w = shop.worker;
      if (!w) continue;
      if (w.mood < 15) {
        if (w.warned) {
          event(s, w.name + ' has quit the ' + TRADES[shop.trade].name.toLowerCase() + '. Pay was too low or late.', 'bad');
          if (w.pid && s.people[w.pid]) { const wp = s.people[w.pid]; wp.job = null; wp.opinion = clamp(wp.opinion - 20, -100, 100); plog(s, wp, 'Quit your ' + TRADES[shop.trade].name.toLowerCase() + ': badly paid.'); addBody(s, wp, { x: w.x, z: w.z }); }
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

  /* ---------- managers: someone you trust runs a business day to day, inside the budget you set ----------
     They keep a worker on, pay fair wages, order supplies, nudge prices to what sells, hire staff, and pay for
     small repairs. Anything bigger comes back to you as a decision. A more skilled manager costs more and slips less. */
  const managerOf = (s, kind, ref) => { const o = kind === 'shop' ? shopById(s, ref) : s.biz && s.biz[ref]; return o && o.manager ? o.manager : null; };
  function managedName(s, kind, ref) { if (kind === 'shop') { const sh = shopById(s, ref); return sh ? 'your ' + TRADES[sh.trade].name.toLowerCase() : 'a shop'; } const e = empById(ref); return e ? e.name : 'a business'; }
  function managedSpot(s, kind, ref) {
    if (kind === 'shop') { const sh = shopById(s, ref); return sh ? plotPt(sh, 'bench') : null; }
    const e = empById(ref); if (!e) return null; return e.front || (e.dir ? { x: e.x, z: e.z + 3.4 * e.dir } : { x: e.x, z: e.z + 3 });
  }
  const townOfBiz = (s, kind, ref) => kind === 'shop' ? 'hearthmoor' : ((s.biz[ref] && s.biz[ref].town) || 'hearthmoor');
  const managerAsk = p => Math.round(6 + Math.min(1.4, p.skill || 0.8) * 6);
  function managerCandidates(s, kind, ref) {
    const town = townOfBiz(s, kind, ref);
    return living(s).filter(p => townOf(p) === town && !p.kid && !p.retired && p.age >= 22 && p.age <= 62 && (!p.job || p.job.type === 'commons' || (p.job.type === 'biz' && p.job.role === 'hand' && s.biz[p.job.biz] && s.biz[p.job.biz].owner === 'player')) && !isHousehold(p))
      .sort((a, b) => ((b.skill || 0.8) * 40 + (b.rep || 0) * 0.5 + (b.opinion || 0) * 0.2) - ((a.skill || 0.8) * 40 + (a.rep || 0) * 0.5 + (a.opinion || 0) * 0.2)).slice(0, 4)
      .map(p => ({ pid: p.id, name: p.name, skill: p.skill || 0.8, ask: managerAsk(p), now: occupation(s, p) }));
  }
  function report(s, text) { s.reports = s.reports || []; s.reports.unshift({ day: s.day, text }); if (s.reports.length > 40) s.reports.length = 40; }
  function releaseManager(s, m, why) { const p = m && s.people[m.pid]; if (p && p.job && p.job.type === 'manage') { p.job = null; plog(s, p, why || 'No longer a manager.'); } }
  function managersDay(s, entry) {
    // anyone whose business has gone (sold, seized) goes back to looking for work
    for (const p of living(s)) if (p.job && p.job.type === 'manage' && !managerOf(s, p.job.kind, p.job.ref)) { p.job = null; plog(s, p, 'The business they managed changed hands.'); }
    for (const shop of s.shops) {
      const m = shop.manager; if (!m) continue;
      const mp = s.people[m.pid]; if (!mp || mp.status !== 'here') { shop.manager = null; report(s, 'Your ' + TRADES[shop.trade].name.toLowerCase() + ' has lost its manager.'); continue; }
      spend(s, m.wage); mp.purse += m.wage; s.rec.wagesPaid += m.wage;
      let budget = m.budget, did = [];
      const ss = shopStats(s, shop), T = TRADES[shop.trade], floor = Math.ceil(Object.keys(T.recipe).reduce((a, g) => a + T.recipe[g] * BUY[g], 0) / Math.max(1, tierOf(shop).out) * 1.1);
      if (!shop.policy.supplyRuns) { shop.policy.supplyRuns = true; did.push('set the worker to buy supplies'); }
      if (!shop.worker && s.applicants && s.applicants.length) {
        const pick = s.applicants.map((a, i) => ({ a, i })).filter(x => x.a.ask <= budget + 9).sort((x, y) => y.a.skill / y.a.ask - x.a.skill / x.a.ask)[0];
        if (pick) { const r = cmd(s, 'hire', shop.id, pick.i, pick.a.ask); if (r.ok) did.push('hired ' + pick.a.name + ' at ' + pick.a.ask + 'c'); }
      }
      if (shop.worker && shop.worker.wage < shop.worker.ask && shop.worker.ask - shop.worker.wage <= budget) { budget -= shop.worker.ask - shop.worker.wage; shop.worker.wage = shop.worker.ask; did.push('raised ' + shop.worker.name + '\u2019s pay to ' + shop.worker.ask + 'c'); }
      if (ss.tooExpensive > Math.max(2, ss.sold * 0.25) && shop.price > floor) { shop.price--; did.push('lowered the price to ' + shop.price + 'c (' + ss.tooExpensive + ' turned away)'); }
      else if (ss.soldOut > 0 && ss.tooExpensive <= 1 && shop.price < Math.round(T.wtp * 1.4)) { shop.price++; did.push('raised the price to ' + shop.price + 'c (sold out)'); }
      if (rand(s) < (1.15 - m.skill) * 0.22) { const loss = 2 + Math.floor(rand(s) * 5); spend(s, loss); did.push('lost ' + loss + 'c through a careless mistake'); }
      const e = entry.shops.find(x => x.id === shop.id);
      report(s, managedName(s, 'shop', shop.id).replace(/^your/, 'Your') + ' (' + m.name + '): ' + (e ? e.revenue + 'c in, ' + e.profit + 'c profit' : 'quiet day') + (did.length ? '. ' + did.join('; ') + '.' : '.'));
    }
    for (const b of Object.values(s.biz)) {
      const m = b.manager; if (!m) continue;
      if (b.owner !== 'player') { releaseManager(s, m, 'The business they managed was sold.'); b.manager = null; continue; }
      const mp = s.people[m.pid]; if (!mp || mp.status !== 'here') { b.manager = null; report(s, empById(b.id).name + ' has lost its manager.'); continue; }
      spend(s, m.wage); mp.purse += m.wage; s.rec.wagesPaid += m.wage;
      let budget = m.budget; const did = [], town = b.town || 'hearthmoor', name = empById(b.id).name;
      const target = m.staffTarget || 2;
      if (b.staff.length < target) {
        const seek = living(s).find(p => idleAdult(p) && p.status === 'here' && townOf(p) === town && p.age >= 16 && p.age <= 60);
        if (seek && 7 <= budget + 7) { seek.job = { type: 'biz', biz: b.id, role: 'hand' }; b.staff.push({ pid: seek.id, wage: 7 }); plog(s, seek, 'Taken on at ' + name + ' by its manager, ' + m.name + '.'); did.push('took on ' + seek.name + ' at 7c'); }
      } else if (b.staff.length > target && avg(b.profits.slice(-3)) < 0) {
        const st = b.staff.pop(), w = s.people[st.pid]; if (w) { w.job = null; plog(s, w, 'Let go from ' + name + ' to save money.'); did.push('let ' + w.name + ' go to save money'); }
      }
      for (const st of b.staff) { const w = s.people[st.pid]; if (w && w.mood < 35 && st.wage < 9 && budget >= 1) { st.wage++; budget--; did.push('gave ' + w.name + ' a raise to ' + st.wage + 'c'); } }
      // wear and tear: small repairs are paid within the budget, big ones come to you
      if (!b.disrepair && !(s.decisions || []).some(d => d.biz === b.id) && rand(s) < 0.06) {
        const cost = 12 + Math.floor(rand(s) * 50), what = ['the roof leaks', 'a beam has split', 'the oven has cracked', 'the cart axle broke', 'the shutters need replacing'][Math.floor(rand(s) * 5)];
        if (cost <= budget * 3) { spend(s, cost); did.push(what + ', and ' + m.name + ' paid ' + cost + 'c to mend it'); }
        else { b.disrepair = true; b.repairCost = cost; s.decisions = s.decisions || []; s.decisions.push({ id: (s.nextDecision = (s.nextDecision || 0) + 1), day: s.day, biz: b.id, cost, text: m.name + ' writes from ' + name + ': ' + what + '. Mending it costs ' + cost + 'c, more than the budget you gave. Until it is fixed, takings are down by a third.' }); did.push(what + ' (too costly to mend without you: see the ledger)'); event(s, 'A decision from ' + name + ': ' + what + '. Mending it costs ' + cost + 'c.', 'bad'); }
      }
      if (rand(s) < (1.15 - m.skill) * 0.18) { const loss = 2 + Math.floor(rand(s) * 6); spend(s, loss); did.push('lost ' + loss + 'c through a careless mistake'); }
      report(s, name + ' (' + m.name + '): ' + (b.lastRevenue || 0) + 'c in, ' + (b.lastProfit || 0) + 'c profit' + (did.length ? '. ' + did.join('; ') + '.' : '.'));
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
      if (e.taxman) {
        s.agents.push({ id: s.nextId++, kind: 'taxman', name: 'The lord\u2019s tax collector', x: P.manorRoad.x, z: P.manorRoad.z, face: 0, mode: 'tax', phase: 'in', doing: 'Coming down from the manor', icon: null, iconUntil: 0, palette: 0, wait: 0 });
        continue;
      }
      const shop = shopById(s, e.shop);
      if (!shop) continue;
      const T = TRADES[shop.trade];
      let a;
      if (e.id == null) {
        a = {
          id: s.nextId++, kind: 'traveler', name: TRAVELERS[Math.floor(rand(s) * TRAVELERS.length)],
          x: P.road.x, z: P.road.z + (rand(s) - 0.5) * 3, face: -Math.PI / 2, mode: 'shop', phase: 'toShop',
          doing: 'Looking for ' + T.product, icon: null, iconUntil: 0, palette: 6 + Math.floor(rand(s) * 4), rumor: Math.floor(rand(s) * RUMORS.length)
        };
        a.wtp = clamp(normal(s, wtpMean(shop, true), T.sd), 1, T.wtp * 3);
        s.agents.push(a);
      } else {
        a = e.pid ? bodyOf(s, s.people[e.pid] || { id: e.pid }) : agentById(s, e.id);
        if (!a && e.pid) {
          // you are away from the village, so this villager simply walks over and buys if someone is at the counter
          const buyer = s.people[e.pid], st = shopStats(s, shop);
          if (!buyer || buyer.status !== 'here') continue;
          const wtp = clamp(normal(s, wtpMean(shop, false), T.sd), 1, T.wtp * 3);
          if (shop.goods > 0 && workerAttending(shop) && wtp >= shop.price && buyer.purse >= shop.price) {
            const r0 = rand(s), q0 = r0 < T.qty3 ? 3 : r0 < T.qty3 + T.qty2 ? 2 : 1, qty = Math.max(0, Math.min(q0, shop.goods, Math.floor(buyer.purse / shop.price))), coin = qty * shop.price;
            shop.goods -= qty; earn(s, coin); buyer.purse -= coin; if (shop.trade === 'bakery' || shop.trade === 'tavern') buyer.ate += Math.min(coin, FOOD);
            st.sold += qty; st.revenue += coin; st.served++; st.servedBy.worker++;
            s.rec.sold[T.product] += qty; s.rec.goodsSold += qty; s.rec.salesRevenue += coin; s.rec.served++;
          } else st.noService++;
          continue;
        }
        if (!a) continue;
        if (a.mode === 'shop') { e.at = s.t + 60; insertSched(s, e); continue; }
        a.mode = 'shop'; a.phase = 'toShop';
        a.wtp = clamp(normal(s, wtpMean(shop, false), T.sd) * (1 + 0.06 * (s.village.favor[a.name] || 0)), 1, T.wtp * 3);
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
        const buyer = a.pid && s.people[a.pid];
        if (buyer && buyer.purse < shop.price) {
          leaveShop(s, a, shop, 'broke'); shopStats(s, shop).broke = (shopStats(s, shop).broke || 0) + 1;
        } else if (shop.price > a.wtp) {
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

  function taxTake(s) {
    const due = s.shops.reduce((a, x) => a + 2 * (x.tier + 1), 0) + (s.village.cottage === 'let' ? 2 : 0) + (s.people ? Object.values(s.biz).filter(b => b.owner === 'player' && !b.closed).length * 4 : 0);
    const lord = s.offices && s.offices.lord, lordP = lord && lord !== 'player' && s.people[lord];
    const mul = s.gov ? s.gov.taxMul : 1;
    if (s.people) for (const b of Object.values(s.biz)) if (!b.closed && b.owner !== 'player') { const o = s.people[b.owner], t = Math.max(0, Math.min(Math.round(4 * mul), o.purse)); o.purse -= t; if (lordP) lordP.purse += t; else if (lord === 'player') earn(s, t); }
    if (lord === 'player') { event(s, 'Your tax collector brings in the week\u2019s taxes from the village businesses.', 'coin'); return; }
    const paid = Math.round(due * mul); // taxes are owed in full
    spend(s, paid); s.stats.tax += paid; s.rec.taxesPaid += paid; if (lordP) lordP.purse += paid;
    let msg = 'The tax collector takes ' + paid + 'c for the lord' + (due ? ' (2c for each level of every shop you own' + (s.village.cottage === 'let' ? ', 2c for the cottage' : '') + (mul > 1 ? ', times ' + mul + ' since the lord raised taxes' : '') + ').' : '. You own nothing taxable yet.');
    if (paid > 0 && s.coins < 0) msg += ' You are now ' + (-s.coins) + 'c in debt.';
    event(s, msg, due ? 'bad' : 'info');
  }
  function taxmanRoutine(s, a, dt) {
    if (a.phase === 'in') { a.doing = 'Collecting ' + lordTitle(s, true) + '\u2019s taxes'; if (moveTo(a, P.hall.x + 1.5, P.hall.z + 1, 1.0 * dt)) { a.phase = 'wait'; a.wait = 40; taxTake(s); } }
    else if (a.phase === 'wait') { a.doing = 'Writing in his tax roll'; a.working = true; a.wait -= dt; if (a.wait <= 0) { a.phase = 'out'; a.working = false; } }
    else { a.doing = 'Returning to the manor'; if (moveTo(a, P.manorRoad.x, P.manorRoad.z - 4, 1.0 * dt)) a.gone = true; }
  }
  function joblessRoutine(s, a, dt) {
    const h = hourOf(s);
    const sit = { x: P.square.x + (a.name === 'Hilda' ? -1 : 1), z: P.square.z };
    const night = h < 6 || h >= 21;
    const arrived = moveTo(a, night ? a.home.x : sit.x, night ? a.home.z : sit.z, 0.8 * dt);
    a.indoors = night && arrived; a.working = false;
    a.doing = night ? 'Asleep' : 'Sitting in the square, hoping for work';
    if (!night && arrived) a.face = 0;
  }
  function villagerRoutine(s, a, dt) {
    const h = hourOf(s);
    let tgt, doing, working = false;
    if (h < 6 || h >= 21) { tgt = a.home; doing = 'Asleep'; }
    else if (h < 7) { tgt = a.spot; doing = 'Walking to work'; }
    else if (h < 12 || (h >= 13 && h < 17)) { tgt = a.spot; doing = jobDoing(a.job); working = true; }
    else if (h < 13) { tgt = wellSpot(s, a.id); doing = s.village.shortage ? 'Hungry: the granary is nearly empty' : 'Lunch by the well'; }
    else { tgt = chatSpot(s, a.id); doing = 'Chatting in the square'; }
    const arrived = moveTo(a, tgt.x, tgt.z, 0.9 * dt);
    a.doing = arrived ? doing : (doing === 'Asleep' ? 'Heading home' : doing.startsWith('Walking') ? doing : 'On the way: ' + doing.toLowerCase());
    a.working = arrived && working;
    a.indoors = arrived && doing === 'Asleep';
  }
  function jobDoing(job) {
    const cj = OAK_JOBS[job] || GH_JOBS[job]; return cj ? cj[1] : { field: 'Reaping wheat', forest: 'Felling pines', pit: 'Digging iron ore', market: 'Trading at the post', well: 'Drawing water' }[job] || 'Working';
  }

  function updateAgents(s, dt) {
    for (const a of s.agents) {
      if (a.icon && s.t > a.iconUntil && a.icon !== 'wait') a.icon = null;
      a.indoors = false;
      if (a.mode === 'shop') updateShopper(s, a, dt);
      else if (a.kind === 'taxman') taxmanRoutine(s, a, dt);
      else if (a.kind === 'person') personRoutine(s, a, dt);
      else if (a.kind === 'jobless') joblessRoutine(s, a, dt);
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
      if (who === 'player') s.trades[shop.trade] = Math.round((s.trades[shop.trade] + 0.25) * 100) / 100;
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
      const buyer = front.pid && s.people[front.pid];
      const qty = Math.max(0, Math.min(front.qty, shop.goods, buyer ? Math.floor(buyer.purse / shop.price) : 99)), coin = qty * shop.price;
      if (qty <= 0) { shop.serveProgress = 0; leaveShop(s, front, shop, 'broke'); return; }
      shop.goods -= qty; earn(s, coin);
      if (buyer) { buyer.purse -= coin; if (shop.trade === 'bakery' || shop.trade === 'tavern') buyer.ate += Math.min(coin, FOOD); }
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
      if (moveTo(p, p.dest.x, p.dest.z, 4.3 * dt, s)) { const then = p.dest.then; p.dest = null; if (then) beginAction(s, then); }
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
    else if (then.type === 'talk') doTalk(s);
    else if (then.type === 'donate') donateGrain(s);
    else if (then.type === 'fundTower') fundTower(s);
    else if (then.type === 'gate') gateTalk(s);
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
      j.workedMin = 0; j.midShift = false; j.tips = 0;
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

  /* ---------- the village and its elder ---------- */
  function startShortage(s) {
    const v = s.village; v.step = 2; v.shortage = true; v.granary = 0; v.granaryNeed = 20;
    event(s, elderTitle(s) + ': "The harvest was thin and the granary is near empty. Folk are skipping meals and spending less. Bring 20 grain to the granary and they will remember it."', 'story');
  }
  function startJobs(s) {
    const v = s.village; v.step = 3;
    const idle = villagers(s).filter(idleAdult).sort((a, b) => (JOBLESS.includes(b.name) ? 1 : 0) - (JOBLESS.includes(a.name) ? 1 : 0)).slice(0, 2);
    v.jobless = idle.map(p => p.name);
    event(s, elderTitle(s) + ': "' + (v.jobless.length ? v.jobless.join(' and ') + ' sit in the square every day with no work. Give them work, and their families eat.' : 'Everyone has work, thanks to you.') + '"', 'story');
    makeApplicants(s);
  }
  function checkVillage(s) {
    const v = s.village;
    if (v.step === 1 && s.shops.length) startShortage(s);
    if (v.step === 3 && s.people) v.jobless = v.jobless.filter(n => { const p = Object.values(s.people).find(q => q.name === n); return p && p.status === 'here' && !p.job; });
    if (v.step === 3 && !v.jobless.length) {
      v.step = 4; s.rec.elderTasks++;
      const given = v.jobsGiven || 0;
      addStanding(s, given >= 2 ? 20 : given ? 12 : 4, given ? 'the idle have work, and the square knows who gave it.' : 'the idle found work on their own; the elder is glad, though it was not your doing.');
      event(s, elderTitle(s) + ': "One more thing. The old watchtower on the east road fell in last winter. Bandits are on the Ashford road. Rebuild it: 80c and 20 wood."', 'story');
    }
    if (v.step === 6 && s.rec.projectsFunded >= 1 && s.rec.disputesSettled >= 1) {
      v.step = 7; v.letter = true;
      event(s, 'A rider brings a letter sealed in blue wax: "Steward ' + holderName(s, 'steward') + ' would speak with the new councillor of Hearthmoor. Present yourself at the manor gate." — ' + REALM.lord, 'story');
    }
  }
  function elderSuccession(s) {
    const v = s.village;
    if (v.step === 8 && v.standing >= 80 && s.offices.elder !== 'player') {
      const old = s.offices.elder && s.people[s.offices.elder];
      appoint(s, 'elder', 'player'); v.step = 9; if (s.gov) { s.gov.approval.elder = Math.max(60, s.gov.approval.you); s.rec.timesElected++; }
      if (old) { old.retired = true; plog(s, old, 'Stepped down as Elder in favour of ' + s.name + '.'); }
      event(s, (old ? old.name : 'The old elder') + ' stands before the moot: "I am old, and the village needs younger hands." The moot names you Elder of Hearthmoor. You draw the elder\u2019s 5c a day, and ' + (old ? old.name + ' is just a villager now.' : 'the hall is yours.'), 'story');
    }
  }
  function doTalk(s) {
    const v = s.village;
    if (v.step === 0) {
      v.step = 1;
      event(s, elderTitle(s) + ': "Hearthmoor belongs to ' + REALM.lord + ', who holds it for ' + REALM.king + ' in ' + REALM.capital + '. His steward taxes us; the council of elders runs the rest. A hired hand has no say here. A shopkeeper might."', 'story');
      if (s.shops.length) startShortage(s);
      return;
    }
    if (v.step === 5) {
      v.step = 6; v.council = true; v.chest += 30; v.landGranted = true; v.disputeDay = s.day + 1; s.rec.elderTasks++; s.rec.councilSince = s.day;
      addStanding(s, 10, 'the moot votes you onto the village council.');
      event(s, 'The moot votes you onto the council. You now hold a key to the village chest (30c), a say over the travelers\u2019 toll, and the right to grant land: the Hall lot is yours to build on.', 'story');
      return;
    }
    const lines = {
      1: 'Open a business of your own and come back. Then we can talk about what the village needs.',
      2: 'The granary still needs ' + Math.max(0, v.granaryNeed - v.granary) + ' grain.',
      3: (v.jobless.length === 2 ? 'Hilda and Bram' : v.jobless[0]) + ' still need' + (v.jobless.length === 1 ? 's' : '') + ' work.',
      4: 'The watchtower needs ' + Math.max(0, 80 - v.towerCoin) + 'c and ' + Math.max(0, 20 - v.towerWood) + ' wood more.',
      6: 'Councillor. The chest holds ' + v.chest + 'c. Spend it where the village can see it.',
      7: 'The steward is waiting. Do not keep a lord\u2019s man waiting.',
      8: 'You have done well by us. Keep earning the village\u2019s trust, and one day this hall will need a new elder.',
      9: 'The hall is yours now, Elder.'
    };
    event(s, elderTitle(s) + ': "' + (lines[v.step] || 'Good day to you.') + '"', 'info');
  }
  function donateGrain(s) {
    const v = s.village, p = s.player;
    if (!v.shortage) { event(s, 'The granary is full enough for now.', 'info'); return; }
    const n = Math.min(p.inv.grain, v.granaryNeed - v.granary);
    if (n <= 0) { event(s, 'You have no grain to give. The Wheat Field is free to gather from.', 'bad'); return; }
    p.inv.grain -= n; v.granary += n; s.rec.grainDonated += n;
    event(s, 'You give ' + n + ' grain to the granary (' + v.granary + '/' + v.granaryNeed + ').', 'good');
    if (v.granary >= v.granaryNeed) {
      v.shortage = false;
      if (v.step === 2) { s.rec.elderTasks++; addStanding(s, 20, 'the granary is full and the village eats again.'); startJobs(s); }
      else addStanding(s, 8, 'you refilled the granary in a lean week.');
    }
  }
  function fundTower(s) {
    const v = s.village, p = s.player;
    if (v.towerBuilt) return;
    const coin = Math.max(0, Math.min(s.coins, 80 - v.towerCoin)), wood = Math.min(p.inv.wood, 20 - v.towerWood);
    if (coin <= 0 && wood <= 0) { event(s, 'The masons need coin and wood. You have neither on you.', 'bad'); return; }
    spend(s, coin); s.stats.given += coin; s.rec.chestGiven += coin; p.inv.wood -= wood;
    v.towerCoin += coin; v.towerWood += wood;
    event(s, 'You give ' + [coin ? coin + 'c' : null, wood ? wood + ' wood' : null].filter(Boolean).join(' and ') + ' to the watchtower (' + v.towerCoin + '/80c, ' + v.towerWood + '/20 wood).', 'good');
    if (v.towerCoin >= 80 && v.towerWood >= 20) {
      v.towerBuilt = true;
      if (v.step === 4) { v.step = 5; s.rec.elderTasks++; addStanding(s, 20, 'the watchtower stands again over the Ashford road.'); event(s, elderTitle(s) + ' sends word: the village will hold a moot. Come to the Village Hall.', 'story'); }
    }
  }
  function gateTalk(s) {
    const v = s.village;
    if (v.step === 7) {
      v.step = 8; v.metSteward = true;
      event(s, 'Steward ' + holderName(s, 'steward') + ' meets you at the gate: "His lordship hears Hearthmoor has a councillor worth knowing. Lords have need of such people. We will send for you." (Chapter Three, The Lord\u2019s Favor, comes in a later update.)', 'story');
    } else if (v.step >= 8) event(s, 'The guard nods you through to the gatehouse, but the steward is away on the lord\u2019s business.', 'info');
    else event(s, 'The gate is barred. A guard in blue and gold: "His lordship receives no one without the steward\u2019s leave."', 'info');
  }
  function atLoc(s, key) { return dist(s.player, LOCS[key]) < LOCS[key].r; }

  /* ---------- people: everyone has a purse, a job and a home ---------- */
  const person = (s, id) => s.people[id];
  const idleAdult = p => !p.job && !p.retired && !p.kid;
  const villagers = s => living(s).filter(p => !p.town || p.town === 'hearthmoor');
  const adults = s => living(s).filter(p => !p.kid);
  const living = s => Object.values(s.people).filter(p => p.status === 'here');
  function plog(s, p, text) { p.log.unshift({ day: s.day, text }); if (p.log.length > 14) p.log.length = 14; }
  function houseById(s, id) { const h = indexOf(s.houses, 'id').get(id); return h && h.id === id ? h : s.houses.find(x => x.id === id); }
  function landlordName(s, owner) {
    if (owner === 'player') return s.name;
    if (owner === 'office:lord') return 'the lord of the manor';
    if (owner && owner.startsWith('town:')) return 'the town of ' + (TOWNS[owner.slice(5)] || { name: owner.slice(5) }).name;
    if (owner && s.people[owner]) return s.people[owner].name;
    return 'the village';
  }
  function officeHolder(s, office) { return s.offices[office]; }
  function holderName(s, office) { const h = s.offices[office]; return h === 'player' ? s.name : h && s.people[h] ? s.people[h].name : 'nobody'; }
  // women and men: known from their names (and their titles), so old saves need nothing new
  const FEMALE = new Set(['Alda', 'Alys', 'Avice', 'Beatrix', 'Cecily', 'Constance', 'Dulcie', 'Eda', 'Edda', 'Edith', 'Elsie', 'Faye', 'Freya', 'Gerd', 'Gisela', 'Hawise', 'Helewise', 'Hilda', 'Ida', 'Imogen', 'Isabel', 'Isolde', 'Joan', 'Jocelyn', 'Katrin', 'Lettice', 'Linnet', 'Mabyn', 'Maren', 'Maud', 'Meriel', 'Merrin', 'Muriel', 'Nell', 'Nesta', 'Orabel', 'Ottilie', 'Petra', 'Philippa', 'Quenby', 'Rohese', 'Rosamund', 'Sabine', 'Sela', 'Sibyl', 'Tamsin', 'Tibby', 'Tiffany', 'Tilly', 'Una', 'Wynn', 'Yseult', 'Alys', 'Mother', 'Goodwife', 'Widow', 'Lady']);
  const firstName = n => { const w = String(n || '').split(' '); return ['Old', 'Young', 'Elder', 'Steward', 'Lord', 'Mayor', 'Reeve'].includes(w[0]) && w[1] ? w[1] : w[0]; };
  function sexOf(p) { if (!p) return 'm'; if (p.sex) return p.sex; const w = String(p.name || '').split(' ')[0]; return FEMALE.has(w) || FEMALE.has(firstName(p.name)) ? 'f' : 'm'; }
  function newPerson(s, o) {
    const id = 'p' + (s.nextPid++);
    const p = Object.assign({ id, name: 'Someone', age: 30, purse: 20, skill: 0.6 + rand(s) * 0.6, job: null, home: null, mood: 60, opinion: 0, arrears: 0, homeless: 0, status: 'here', log: [], palette: Math.floor(rand(s) * 10), ate: 0, retired: false }, o);
    p.id = id; s.people[id] = p; return p;
  }
  function addBody(s, p, at) {
    if (s.agents.some(a => a.pid === p.id)) return;
    const pt = at || homePoint(s, p) || P.square;
    s.agents.push({ id: s.nextId++, kind: 'person', pid: p.id, name: p.name, x: pt.x, z: pt.z, face: 0, mode: 'routine', doing: '', icon: null, iconUntil: 0, palette: p.palette, kid: !!p.kid, job: p.job && p.job.type === 'commons' ? p.job.what : null });
  }
  function bodyOf(s, p) { const a = indexOf(s.agents, 'pid').get(p.id); return a && a.pid === p.id ? a : null; }
  function homePoint(s, p) {
    if (!p.home) return null;
    if (p.home === 'manor') return MANOR_HOME;
    if (p.home.startsWith('biz:')) { const e = empById(p.home.slice(4)); return { x: e.x, z: e.z }; }
    const h = houseById(s, p.home); return h ? { x: h.x, z: h.z } : null;
  }
  function occupation(s, p) {
    const j = p.job;
    if (!j) return p.kid ? (p.age >= 10 ? 'Child, helps at home' : 'Child') : p.retired ? 'Retired' : p.status === 'left' ? 'Gone from Hearthmoor' : 'Out of work';
    if (j.type === 'commons') return (OAK_JOBS[j.what] || GH_JOBS[j.what]) ? (OAK_JOBS[j.what] || GH_JOBS[j.what])[0] : { field: 'Farmer', forest: 'Woodcutter', pit: 'Miner', market: 'Trader at the post', well: 'Water-carrier' }[j.what];
    if (j.type === 'biz') { const e = empById(j.biz), b = s.biz[j.biz]; return (j.role === 'owner' ? 'Owner of ' : (b.owner === 'player' ? 'Works for you at ' : 'Works at ')) + e.name; }
    if (j.type === 'office' && j.office === 'mayor') return 'Mayor of Oakbridge';
    if (j.type === 'shop') { const sh = shopById(s, j.shop); return 'Works for you at your ' + (sh ? TRADES[sh.trade].name.toLowerCase() : 'shop'); }
    if (j.type === 'manage') return 'Manages ' + managedName(s, j.kind, j.ref) + ' for you';
    if (j.type === 'office') return OFFICES[j.office].title;
    return 'Working';
  }
  function homeText(s, p) {
    if (!p.home) return p.status === 'left' ? 'Left the village' : 'Homeless, sleeping in the square';
    if (p.home === 'manor') return 'Lives at Varrow Manor';
    if (p.home.startsWith('biz:')) return 'Lives above ' + empById(p.home.slice(4)).name;
    const h = houseById(s, p.home);
    if (h.owner === p.id) return 'Owns ' + h.name;
    return 'Rents ' + h.name + ' from ' + landlordName(s, h.owner) + ' at ' + h.rent + 'c a day' + (p.arrears ? ' (' + p.arrears + ' days behind)' : '');
  }
  function income(s, p) {
    const j = p.job;
    if (!j) return p.retired || p.kid ? 0 : ODD_JOBS;
    if (j.type === 'commons') return townOf(p) === 'oakbridge' ? COMMONS_PAY + 1 : townOf(p) === 'greenhaven' ? COMMONS_PAY : COMMONS_PAY - (s.village.shortage ? 2 : 0);
    if (j.type === 'biz') { const b = s.biz[j.biz]; if (j.role === 'owner') return Math.max(0, Math.round(avg(b.profits))); const st = b.staff.find(x => x.pid === p.id); return st ? st.wage : 0; }
    if (j.type === 'shop') { const sh = shopById(s, j.shop); return sh && sh.worker ? sh.worker.wage : 0; }
    if (j.type === 'manage') { const m = managerOf(s, j.kind, j.ref); return m ? m.wage : 0; }
    if (j.type === 'office') return OFFICES[j.office].salary;
    return 0;
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  function vacancy(s, maxRent, town) {
    // empty homes first; failing that, a room as a lodger in someone else's house
    town = town || 'hearthmoor';
    return s.houses.filter(h => (h.town || 'hearthmoor') === town && h.cap > h.tenants.length && !h.tenants.includes(h.owner) && h.owner !== 'player-home' && (maxRent == null || h.rent <= maxRent)).sort((a, b) => (a.tenants.length ? 1 : 0) - (b.tenants.length ? 1 : 0) || a.rent - b.rent)[0] || null;
  }
  function moveIn(s, p, h) {
    p.home = h.id; h.tenants.push(p.id); p.arrears = 0; p.owed = 0; p.homeless = 0;
    plog(s, p, 'Moved into ' + h.name + (h.owner === p.id ? '' : ' (' + h.rent + 'c a day)') + '.');
  }
  function moveOut(s, p, why) {
    if (!p.home) return;
    const h = houseById(s, p.home);
    if (h) h.tenants = h.tenants.filter(x => x !== p.id);
    p.home = null; p.arrears = 0;
    plog(s, p, why || 'Lost their home.');
  }
  function loseJob(s, p, why) {
    const j = p.job; if (!j) return;
    if (j.type === 'biz') { const b = s.biz[j.biz]; b.staff = b.staff.filter(x => x.pid !== p.id); }
    if (j.type === 'shop') { const sh = shopById(s, j.shop); if (sh && sh.worker && sh.worker.pid === p.id) sh.worker = null; }
    if (j.type === 'office' && s.offices[j.office] === p.id) s.offices[j.office] = null;
    p.job = null; p.tenure = 0; p.mood = clamp(p.mood - 20, 0, 100);
    plog(s, p, why || 'Lost their job.');
  }

  // a household lives together under one roof and pays one rent
  const hhOf = p => p.hh || p.id;
  function rentPayer(s, h, p) {
    if (p.kid) return false;
    const first = h.tenants.map(id => s.people[id]).find(q => q && !q.kid && q.status === 'here' && hhOf(q) === hhOf(p));
    return first === p;
  }
  function parentsOf(s, p) { return (p.parents || []).map(id => s.people[id]).filter(q => q && q.status === 'here'); }
  function makeHouses(s) {
    s.houses = HOUSES.map((h, i) => ({ id: 'h' + i, name: h.name, x: h.x, z: h.z, owner: 'office:lord', rent: h.cap >= 4 ? 3 : 2, cap: h.cap, tenants: [] }));
  }
  function setupPeople(s) {
    s.people = {}; s.nextPid = 1; s.biz = {}; s.offices = {};
    makeHouses(s);
    const H = i => s.houses[i];
    const P0 = (o, h, log) => { const p = newPerson(s, o); if (h) moveIn(s, p, h); p.log = log ? [{ day: 1, text: log }] : []; return p; };
    const C = what => ({ type: 'commons', what });
    const wed = (a, b) => { a.spouse = b.id; b.spouse = a.id; b.hh = hhOf(a); };
    const child = (kid, ...ps) => { kid.kid = true; kid.parents = ps.map(q => q.id); kid.hh = hhOf(ps[0]); kid.purse = 0; };
    // the commons and their families
    const aldric = P0({ name: 'Aldric', age: 34, purse: 22 + Math.floor(rand(s) * 10), job: C('field'), palette: 0 }, H(0));
    const rosa = P0({ name: 'Rosamund', age: 31, purse: 14, job: C('field'), palette: 5 }, H(0)); wed(aldric, rosa);
    const pip = P0({ name: 'Pip', age: 9, palette: 1 }, H(0)); child(pip, aldric, rosa);
    const maren = P0({ name: 'Maren', age: 29, purse: 24 + Math.floor(rand(s) * 10), job: C('field'), palette: 1 }, H(1));
    const tobin = P0({ name: 'Tobin', age: 41, purse: 26 + Math.floor(rand(s) * 10), job: C('forest'), palette: 2 }, H(2));
    const ida = P0({ name: 'Ida', age: 38, purse: 12, job: C('well'), palette: 8 }, H(2)); wed(tobin, ida);
    const wat = P0({ name: 'Wat', age: 12, palette: 3 }, H(2)); child(wat, tobin, ida);
    const tilly = P0({ name: 'Tilly', age: 6, palette: 9 }, H(2)); child(tilly, tobin, ida);
    const edda = P0({ name: 'Edda', age: 26, purse: 20 + Math.floor(rand(s) * 10), job: C('pit'), palette: 3 }, H(8));
    const wynn = P0({ name: 'Wynn', age: 37, purse: 24 + Math.floor(rand(s) * 10), job: C('market'), palette: 4 }, H(5));
    const corin = P0({ name: 'Corin', age: 35, purse: 12, job: C('forest'), palette: 6 }, H(5)); wed(wynn, corin);
    // the elder owns his house and lives there with his wife, Old Sela
    const elder = P0({ name: 'Brannoch', age: 71, purse: 60, job: { type: 'office', office: 'elder' }, palette: 4 }, H(6));
    H(6).owner = elder.id; H(6).rent = 0; s.offices.elder = elder.id;
    const sela = P0({ name: 'Old Sela', age: 68, purse: 26, job: C('well'), palette: 5 }, H(6)); wed(elder, sela);
    // the shops and their owners, who live above them
    const owners = [['gerd', 'Gerd', 52], ['forge', 'Hollin', 44], ['tankard', 'Mother Ysolde', 58], ['ash', 'Ash', 47], ['mill', 'Tamsin', 45]];
    owners.forEach(([id, name, age], i) => {
      const p = newPerson(s, { name, age, purse: 90 + Math.floor(rand(s) * 40), job: { type: 'biz', biz: id, role: 'owner' }, home: 'biz:' + id, palette: 3 + i });
      s.biz[id] = { id, trade: empById(id).trade, owner: p.id, staff: [], profits: [8, 8, 8], closed: false, opened: 0, lastProfit: 0, lastRevenue: 0 };
    });
    const hand = (biz, name, age, pal, h) => { const p = P0({ name, age, purse: 14 + Math.floor(rand(s) * 10), job: { type: 'biz', biz, role: 'hand' }, palette: pal }, h); s.biz[biz].staff.push({ pid: p.id, wage: 7 }); return p; };
    const osric = hand('gerd', 'Osric', 23, 6, H(3)), linnet = hand('forge', 'Linnet', 27, 7, H(3)); wed(osric, linnet);
    const cade = hand('tankard', 'Cade', 31, 8, H(7)), freya = hand('ash', 'Freya', 25, 9, H(7)); wed(cade, freya);
    const rook = hand('mill', 'Rook', 24, 2, H(8)); wed(edda, rook);
    // out of work since the old mill on the stream closed
    const hilda = P0({ name: 'Hilda', age: 33, purse: 16, palette: 7 }, H(1), 'Lost her place when the old mill on the stream closed.'); hilda.hh = hhOf(maren); hilda.sister = maren.id;
    const bram = P0({ name: 'Bram', age: 38, purse: 30, palette: 8 }, H(4), 'Lost his place when the old mill on the stream closed.');
    const elsie = P0({ name: 'Elsie', age: 10, palette: 0 }, H(4)); child(elsie, bram);
    // the lord's household lives at the manor
    [['lord', 'Edric Varrow', 49, 420], ['steward', 'Merrin', 45, 120], ['taxman', 'Pell', 39, 40], ['guard', 'Hobb', 33, 30]].forEach(([office, name, age, purse]) => {
      const p = newPerson(s, { name, age, purse, job: { type: 'office', office }, home: 'manor', palette: 2 });
      s.offices[office] = p.id;
    });
    for (const p of living(s)) if (!['lord', 'steward', 'taxman'].includes(p.job && p.job.office)) addBody(s, p);
    s.agents.forEach(a => { if (a.job) a.spot = jobSpot(s, a.job); });
  }

  /* the village's businesses keep their own books */
  function bizDay(s) {
    const pop = adults(s), employed = pop.filter(p => p.job).length / Math.max(1, pop.length);
    for (const id in s.biz) {
      const b = s.biz[id];
      if (b.closed) { b.lastProfit = 0; continue; }
      const own = b.owner === 'player' ? null : person(s, b.owner);
      const workers = b.staff.length + (own ? 1 : 0);
      const rivals = Object.values(s.biz).filter(x => x !== b && !x.closed && x.trade === b.trade && (x.town || 'hearthmoor') === (b.town || 'hearthmoor')).length;
      const competition = Math.max(0.35, 1 - 0.28 * ((b.town || 'hearthmoor') === 'hearthmoor' ? s.shops.filter(x => x.trade === b.trade).length : 0)) / (1 + 0.3 * rivals) * (b.town === 'oakbridge' ? 1.35 : 1);
      const revenue = Math.round((b.disrepair ? 0.7 : 1) * BIZ_BASE[b.trade] * (0.55 + 0.55 * employed) * Math.min(1.5, 0.5 + 0.5 * workers) * competition * (s.village.shortage && (b.trade === 'bakery' || b.trade === 'tavern') ? 0.7 : 1));
      let wages = 0;
      for (const st of b.staff) {
        const w = person(s, st.pid);
        const paid = b.owner === 'player' ? st.wage : Math.min(st.wage, Math.max(0, own.purse));
        if (b.owner === 'player') spend(s, paid); else own.purse -= paid;
        w.purse += paid; wages += paid;
        if (paid < st.wage) { w.mood = clamp(w.mood - 15, 0, 100); plog(s, w, 'Was not paid in full.'); }
      }
      const supplies = Math.round(revenue * 0.35), profit = revenue - supplies - wages - 3;
      b.lastRevenue = revenue; b.lastProfit = profit; b.lastWages = wages;
      b.profits.push(profit); if (b.profits.length > 5) b.profits.shift();
      if (b.owner === 'player') {
        const net = revenue - supplies - 3;
        if (net >= 0) earn(s, net); else spend(s, -net);
        s.stats.owned = (s.stats.owned || 0) + profit;
        continue;
      }
      own.purse += revenue - supplies - 3;
      // owners hire when doing well and let people go when not
      const recent = avg(b.profits.slice(-3));
      if (recent < -1 && b.staff.length) {
        const st = b.staff[b.staff.length - 1], w = person(s, st.pid);
        loseJob(s, w, 'Let go from ' + empById(id).name + ': trade was too slow.');
        b.laidOff = s.day;
        event(s, own.name + ' has let ' + w.name + ' go from ' + empById(id).name + '. Business is slow.', 'bad');
      } else if (recent > 12 && b.staff.length < 2) {
        const seek = pop.find(p => idleAdult(p) && p.status === 'here' && townOf(p) === (b.town || 'hearthmoor'));
        if (seek) { seek.job = { type: 'biz', biz: id, role: 'hand' }; b.staff.push({ pid: seek.id, wage: 7 }); plog(s, seek, 'Hired by ' + own.name + ' at ' + empById(id).name + '.'); event(s, own.name + ' hired ' + seek.name + ' at ' + empById(id).name + '.', 'info'); }
      }
      if (own.purse <= 0 && b.profits.every(x => x < 0)) {
        b.closed = true;
        b.staff.slice().forEach(st => loseJob(s, person(s, st.pid), empById(id).name + ' closed its doors.'));
        loseJob(s, own, 'Their business, ' + empById(id).name + ', failed.');
        own.purse = Math.max(own.purse, 0);
        if (own.home === 'biz:' + id) { own.home = null; plog(s, own, 'Had to leave the rooms above the shop.'); }
        event(s, empById(id).name + ' has closed. ' + own.name + ' is out of work and out of a home.', 'bad');
      }
    }
  }

  /* wages, food and rent at the end of each day */
  function peopleEvening(s) {
    const lordHolder = s.offices.lord;
    if (lordHolder && lordHolder !== 'player' && s.people[lordHolder]) s.people[lordHolder].purse += 24; // the lord's farms and woods beyond the village
    if (s.offices.elder === 'player') { const L = lordHolder && lordHolder !== 'player' && s.people[lordHolder]; const sal = OFFICES.elder.salary; if (L) { L.purse -= sal; earn(s, sal); s.stats.jobPay += sal; } }
    for (const p of living(s)) {
      const j = p.job;
      // incomes that are not paid by a business or by you
      if (!j) { if (!p.retired && !p.kid) p.purse += ODD_JOBS; }
      else if (j.type === 'commons') p.purse += income(s, p);
      else if (j.type === 'office' && OFFICES[j.office].salary) {
        const sal = OFFICES[j.office].salary;
        if (lordHolder === 'player') { spend(s, sal); s.stats.salaries = (s.stats.salaries || 0) + sal; p.purse += sal; }
        else if (lordHolder && s.people[lordHolder] && lordHolder !== p.id) { const L = s.people[lordHolder]; L.purse -= sal; p.purse += sal; } // the lord pays his household even on borrowed coin
      }
      // food: what they bought at your shops today counts toward it
      // children eat from their parents' purse
      const payer = p.kid ? (parentsOf(s, p).find(q => q.purse > 0) || p) : p;
      const food = Math.max(0, (p.kid ? FOOD - 1 : FOOD) - p.ate); const paidFood = Math.min(Math.max(0, payer.purse), food); payer.purse -= paidFood;
      if (paidFood < food) { p.mood = clamp(p.mood - 10, 0, 100); if (!p.hungry) plog(s, p, 'Went to bed hungry.'); p.hungry = true; } else p.hungry = false;
      p.ate = 0;
      // rent
      const h = p.home && houseById(s, p.home);
      if (h && h.owner !== p.id && h.rent > 0 && rentPayer(s, h, p)) {
        // rent owed piles up: paying today does not clear what was missed before
        p.owed = (p.owed || 0) + h.rent;
        const pay = Math.min(Math.max(0, p.purse), p.owed);
        if (pay > 0) {
          p.purse -= pay; p.owed -= pay;
          if (h.owner === 'player') { earn(s, pay); s.stats.rent += pay; s.rec.rentCollected += pay; }
          else if (h.owner === 'office:lord') { if (lordHolder === 'player') { earn(s, pay); s.stats.rent += pay; s.rec.rentCollected += pay; } else if (lordHolder && s.people[lordHolder]) s.people[lordHolder].purse += pay; }
          else if (h.owner && h.owner.startsWith('town:') && s.towns && s.towns[h.owner.slice(5)]) s.towns[h.owner.slice(5)].chest += pay;
          else if (s.people[h.owner]) s.people[h.owner].purse += pay;
        }
        p.arrears = Math.ceil(p.owed / h.rent);
        if (p.owed > 0) {
          p.mood = clamp(p.mood - 8, 0, 100);
          plog(s, p, 'Owes ' + p.owed + 'c in rent (' + p.arrears + ' days behind).');
          if (p.arrears >= EVICT_AFTER) {
            p.owed = 0;
            moveOut(s, p, 'Evicted from ' + h.name + ' after ' + EVICT_AFTER + ' days of unpaid rent.');
            s.rec.evictions++;
            if (h.owner === 'office:lord' && s.gov) approve(s, 'lord', -2);
            if (h.owner === 'player') approveHolder(s, 'player', -2);
            event(s, p.name + ' has been evicted from ' + h.name + (h.owner === 'player' ? ' (your house)' : '') + '.', 'bad');
          }
        }
      }
      // mood drifts with circumstances
      const target = (p.job || p.kid ? 60 : 30) + (p.home ? 15 : -20) + (p.kid ? 0 : p.purse > 30 ? 10 : p.purse < 5 ? -10 : 0) + (s.village.projects.well ? 5 : 0);
      p.mood = clamp(p.mood + (target - p.mood) * 0.3, 0, 100);
      // debts grow: the Ashford moneylender takes 2% a day
      if (p.purse < 0) p.purse -= Math.max(1, Math.ceil(-p.purse * INTEREST));
      p.purse = Math.round(p.purse);
      if (j && j.type === 'biz' && j.role === 'hand') p.tenure = (p.tenure || 0) + 1;
    }
  }

  /* each morning: the jobless look for work, the homeless for a roof, and some give up */
  function peopleMorning(s) {
    for (const k of living(s).filter(q => q.kid)) {
      const pars = parentsOf(s, k), par = pars.find(q => q.home) || pars[0];
      if (!pars.length) { if ((k.parents || []).length && !(k.parents || []).some(id => s.people[id] && s.people[id].status === 'here')) { k.status = 'left'; plog(s, k, 'Left Hearthmoor with family.'); const b = bodyOf(s, k); if (b) b.gone = true; } continue; }
      if (par.home !== k.home) {
        if (k.home && houseById(s, k.home)) moveOut(s, k, par.home ? 'Moved with ' + par.name + '.' : 'Lost the family home along with ' + par.name + '.');
        if (par.home && houseById(s, par.home)) { const hh = houseById(s, par.home); hh.tenants.push(k.id); k.home = hh.id; } else k.home = par.home;
      }
    }
    for (const p of living(s)) {
      if (p.kid) continue;
      if (!p.home) {
        p.homeless++;
        const affordable = Math.max(1, Math.floor(income(s, p) - FOOD));
        const h = vacancy(s, p.purse >= 20 ? 99 : affordable, townOf(p));
        if (h) moveIn(s, p, h);
      } else if (p.job && rentPayer(s, houseById(s, p.home) || { tenants: [] }, p) && p.home !== 'manor' && !String(p.home).startsWith('biz:')) {
        // tenants whose rent has outgrown their pay look for somewhere cheaper
        const h = houseById(s, p.home);
        if (h && h.owner !== p.id && h.rent > income(s, p) - 1 && p.purse < h.rent * 4) {
          const cheaper = vacancy(s, Math.max(1, income(s, p) - FOOD), townOf(p));
          if (cheaper && cheaper.rent < h.rent) { moveOut(s, p, 'Moved out of ' + h.name + ': the rent of ' + h.rent + 'c was more than they could pay.'); moveIn(s, p, cheaper); }
        }
      }
      if (p.job && p.job.type === 'biz' && p.job.role === 'hand' && (p.tenure || 0) >= 12 && p.purse >= 70 && (p.rep || 0) >= 25) {
        const shut = Object.values(s.biz).find(b => b.closed && b.trade === s.biz[p.job.biz].trade) || Object.values(s.biz).find(b => b.closed);
        if (shut) {
          loseJob(s, p, 'Left to run a shop of their own.');
          p.purse -= 60; shut.owner = p.id; shut.closed = false; shut.profits = [4, 4, 4]; shut.staff = []; p.job = { type: 'biz', biz: shut.id, role: 'owner' };
          plog(s, p, 'Reopened ' + empById(shut.id).name + ' with 60c of savings, after ' + 'years as a hired hand.');
          event(s, p.name + ' has saved enough to reopen ' + empById(shut.id).name + ' as its owner.', 'story');
        }
      }
      if (idleAdult(p)) {
        const open = Object.values(s.biz).find(b => (b.town || 'hearthmoor') === townOf(p) && !b.closed && b.owner !== 'player' && b.staff.length < 1 && avg(b.profits.slice(-3)) > 3 && !(s.day - (b.laidOff || -99) < 6));
        if (open) { open.staff.push({ pid: p.id, wage: 7 }); p.job = { type: 'biz', biz: open.id, role: 'hand' }; plog(s, p, 'Found work at ' + empById(open.id).name + '.'); }
      }
      if (!p.home && !p.job && p.homeless >= LEAVE_AFTER && p.purse < 5 && !p.retired && !p.kid) {
        p.status = 'left'; plog(s, p, 'Left Hearthmoor for Ashford with nothing.');
        const b = bodyOf(s, p); if (b) b.gone = true;
        s.rec.peopleLeft++;
        event(s, p.name + ' has left Hearthmoor, homeless and out of work.', 'bad');
      }
    }
    // newcomers arrive when there is a roof and work to be had
    const jobless = villagers(s).filter(idleAdult).length;
    if (jobless === 0 && vacancy(s, 3) && rand(s) < 0.3) {
      const names = ['Rowan', 'Elsbeth', 'Tam', 'Hesper', 'Wat', 'Mabel', 'Odo', 'Gwen', 'Alard', 'Juliana'];
      const used = new Set(Object.values(s.people).map(p => p.name));
      const name = names.find(n => !used.has(n));
      if (name) { const p = newPerson(s, { name, age: 20 + Math.floor(rand(s) * 25), purse: 15 }); moveIn(s, p, vacancy(s, 3)); p.log.push({ day: s.day, text: 'Arrived from Ashford looking for work.' }); addBody(s, p, P.road); event(s, name + ' has arrived from Ashford looking for work.', 'info'); }
    }
  }

  /* where people stand when they gather: spread out, a little different every day, facing each other */
  function h01(a, b, c) { let x = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
  function ringSpot(cx, cz, r0, r1, id, day, salt) {
    const a = h01(id, day, salt) * Math.PI * 2, r = r0 + h01(id, day, salt + 7) * (r1 - r0);
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, look: { x: cx, z: cz } };
  }
  // chatting: small groups of two to four, each in its own circle
  function chatSpot(s, id, town) {
    if (townSpots(town)) {
      const q = pickPlaza(LAYOUT[town], id, s.day, 3), groups = Math.max(3, Math.floor((q.line ? q.r1 * 4 : q.r1 * q.r1) / 5)), g = Math.floor(h01(id, s.day, 4) * groups);
      const gc = plazaSpot(q, g, s.day * 7 + 1, 19);
      return ringSpot(gc.x, gc.z, 0.75, 1.0, id, s.day, 11);
    }
    const pz = (townSpots(town) || { plaza: P.plaza }).plaza, g = Math.floor(h01(id, s.day, 3) * 4), ga = g * 1.57 + (s.day % 7) * 0.6, gc = { x: pz.x + Math.cos(ga) * 3.4, z: pz.z + 0.5 + Math.sin(ga) * 2.6 };
    return ringSpot(gc.x, gc.z, 0.75, 1.0, id, s.day, 11);
  }
  const wellSpot = (s, id, salt, town) => { const ts = townSpots(town); return ts ? plazaSpot(pickPlaza(LAYOUT[town], id, s.day, salt || 5), id, s.day, (salt || 5) + 3) : ringSpot(LOCS.well.x, LOCS.well.z, 2, 4.6, id, s.day, salt || 5); };
  // Oakbridge has several places to gather, so a crowd never piles into one square
  function pickPlaza(L, id, day, salt) {
    const P0 = L.plazas, tot = P0.reduce((t, q) => t + q.w, 0); let x = h01(id, day, salt + 101) * tot;
    for (const q of P0) { x -= q.w; if (x < 0) return q; } return P0[0];
  }
  function plazaSpot(q, id, day, salt) {
    if (q.line) { const z = q.z + (h01(id, day, salt) - 0.5) * q.r1 * 4; return { x: OAK.quayX(z) + 0.4 + (h01(id, day, salt + 9) - 0.5) * 2.4, z, look: { x: OAK.riverX(z), z } }; }
    return ringSpot(q.x, q.z, q.r0, q.r1, id, day, salt);
  }
  // the way through town: over the bridge to cross the river, and through the gate to leave the walls
  function townWay(OAK, a, tgt) {
    const inA = OAK.inside(a.x, a.z), inT = OAK.inside(tgt.x, tgt.z), G = OAK.gate, gx = G ? Math.sin(G.face) : 0, gz = G ? Math.cos(G.face) : 0;
    const side = (x, z) => x < OAK.riverX(z) ? -1 : 1;
    if (G && inA && !inT && side(a.x, a.z) > 0) return townWay(OAK, a, { x: G.x - gx * 6, z: G.z - gz * 6 });
    if (G && inA !== inT) {
      const mine = inA ? { x: G.x - gx * 6, z: G.z - gz * 6 } : { x: G.x + gx * 6, z: G.z + gz * 6 }, other = inA ? { x: G.x + gx * 7, z: G.z + gz * 7 } : { x: G.x - gx * 7, z: G.z - gz * 7 };
      return Math.hypot(a.x - G.x, a.z - G.z) < 6.5 ? other : mine;
    }
    if (!inA) return tgt;
    const B = OAK.bridge, W = { x: B.ax, z: B.az }, E = { x: B.bx, z: B.bz }, st = side(tgt.x, tgt.z);
    // on the bridge: carry on to the far end before turning off
    const bl = B.half * 2, t = ((a.x - B.ax) * (B.bx - B.ax) + (a.z - B.az) * (B.bz - B.az)) / (bl * bl), cross = Math.abs((a.x - B.ax) * (B.bz - B.az) - (a.z - B.az) * (B.bx - B.ax)) / bl;
    if (t > 0.05 && t < 0.95 && cross < 3.5) return st < 0 ? W : E;
    const sa = side(a.x, a.z);
    if (sa !== st) { const mine = sa < 0 ? W : E, other = sa < 0 ? E : W; return Math.hypot(a.x - mine.x, a.z - mine.z) < 2 ? other : mine; }
    // along the bank: keep out of the water where the river bends toward the path
    // (a spot at the water's edge, such as the wharf or the washing steps, is walked straight to once close)
    const dT = Math.hypot(tgt.x - a.x, tgt.z - a.z);
    if (dT < 9) return tgt;
    for (const f of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      const px = a.x + (tgt.x - a.x) * f, pz = a.z + (tgt.z - a.z) * f;
      if (dT * (1 - f) < 6) break;
      if (OAK.riverDist(px, pz) < OAK.avoid) { const w = { x: OAK.riverX(pz) + sa * OAK.push, z: pz }; return Math.hypot(a.x - w.x, a.z - w.z) < 1 ? tgt : w; }
    }
    return tgt;
  }
  // standing at home in the daytime: by the front door, each in their own place, not all on one spot
  function homeYard(s, p, id) {
    const h = p.home && /^o\d/.test(p.home) ? OAK.houses[+p.home.slice(1)] : p.home && /^g\d/.test(p.home) ? GH.houses[+p.home.slice(1)] : null, home = homePoint(s, p);
    if (!home) return null;
    if (h) { const k = h01(id, 1, 83) - 0.5, d = 4 + h01(id, 1, 84) * 1.6; return { x: h.x + Math.sin(h.face) * d + Math.cos(h.face) * k * 4, z: h.z + Math.cos(h.face) * d - Math.sin(h.face) * k * 4, look: { x: h.x, z: h.z } }; }
    return ringSpot(home.x, home.z, 0.3, 1.8, id, 1, 85);
  }
  /* people walk through their own day */
  function personRoutine(s, a, dt) {
    const p = s.people[a.pid];
    if (!p || p.status !== 'here') { a.gone = true; return; }
    const h = hourOf(s), night = h < 6 || h >= 20.2 + h01(a.id, s.day, 31) * 0.7, j = p.job, town = townOf(p), ts = townSpots(town);
    const home = homePoint(s, p);
    let tgt = null, doing = '', working = false;
    if (night) { tgt = home || wellSpot(s, a.id, 9, town); doing = home ? 'Asleep' : 'Sleeping rough by the well'; }
    else if (j && j.type === 'commons') {
      if (h < 7) { tgt = a.spot; doing = 'Walking to work'; }
      else if (h < 12 || (h >= 13 && h < 17)) { tgt = a.spot; doing = jobDoing(j.what); working = true; }
      else if (h < 13) { tgt = wellSpot(s, a.id, 5, town); doing = ts ? 'Lunch in town' : s.village.shortage ? 'Hungry: the granary is nearly empty' : 'Lunch by the well'; }
    } else if (j && j.type === 'biz') {
      const e = empById(j.biz), hrs = j.role === 'owner' ? [7, 18] : e.shift;
      if (h >= hrs[0] && h < hrs[1] && !s.biz[j.biz].closed) { tgt = e.oak ? (j.role === 'owner' ? e.front : ringSpot(e.spot.x, e.spot.z, 0.4, 1.6, a.id, 1, 41)) : j.role === 'owner' ? (e.id === 'mill' ? { x: -27.6, z: -38.4 } : { x: e.x, z: e.z + 0.4 * e.dir }) : e.id === 'mill' ? e.spot : { x: e.x + 0.9 * e.dir, z: e.z - 1.2 * e.dir }; doing = e.oak ? (j.role === 'owner' ? 'Minding ' + e.name : 'At work in ' + e.name) : e.id === 'mill' ? (j.role === 'owner' ? 'Grinding grain at the mill' : 'Hauling sacks of flour') : j.role === 'owner' ? 'Minding the counter' : 'Working the ' + TRADES[e.trade].station; working = true; a.faceTo = e.oak ? e.face + Math.PI : e.dir > 0 ? 0 : Math.PI; }
    } else if (j && j.type === 'manage') {
      const at = managedSpot(s, j.kind, j.ref);
      if (at && h >= 7 && h < 18) { tgt = ringSpot(at.x, at.z, 0.4, 1.4, a.id, s.day, 47); doing = 'Managing ' + managedName(s, j.kind, j.ref); working = true; }
    } else if (j && j.type === 'office') {
      if (j.office === 'elder' && h >= 8 && h < 18) { tgt = P.elderDesk; doing = 'Keeping the Village Hall'; }
      else if (j.office === 'guard') { tgt = P.guardPost; doing = 'Guarding the manor gate'; }
      else { tgt = MANOR_HOME; doing = 'At the manor'; }
    }
    if (!tgt && p.kid) {
      if (h < 8 || h >= 19) { tgt = night ? home : homeYard(s, p, a.id) || P.plaza; doing = 'At home with the family'; }
      else if (p.age >= 10 && h < 12) { tgt = home ? { x: home.x + 2.2, z: home.z + 2.4 } : P.plaza; doing = 'Helping with chores at home'; working = true; }
      else if (ts) { const q = pickPlaza(LAYOUT[town], a.id, s.day, 61); tgt = plazaSpot(q, a.id, s.day * 24 + Math.floor(h * 2), 13); tgt.look = null; doing = 'Playing in ' + q.name; }
      else { const pz = P.plaza; tgt = ringSpot(pz.x, pz.z + 1, 0.5, 4.5, a.id, s.day * 24 + Math.floor(h * 2), 13); tgt.look = null; doing = 'Playing in the square'; }
    }
    if (!tgt) {
      if (h >= 17 && ts && home && h01(a.id, s.day, 51) < 0.4) { tgt = homeYard(s, p, a.id); doing = 'Home for the evening'; }
      else if (h >= 17) { tgt = chatSpot(s, a.id, town); doing = ts ? 'Chatting with neighbours' : 'Chatting in the square'; }
      else if (!j && !p.retired && !p.kid && (!ts || h01(a.id, s.day * 24 + Math.floor(h), 71) < 0.3)) { const bd = ts ? ts.board : { x: -4.5, z: -2.5 }; tgt = ts ? ringSpot(bd.x, bd.z, 2, 6.5, a.id, s.day, 17) : ringSpot(bd.x, bd.z + 1.5, 1.2, 3, a.id, s.day, 17); tgt.look = bd; doing = 'At the notice board, looking for work'; }
      else { tgt = wellSpot(s, a.id, 21, town); doing = ts ? 'Passing the time in town' : 'Passing the time by the well'; }
    }
    const way = LAYOUT[town] ? townWay(LAYOUT[town], a, tgt) : tgt;
    if (way !== tgt) a.settle = false;
    const arrived = moveTo(a, way.x, way.z, 0.9 * dt) && way === tgt;
    a.doing = arrived ? doing : doing === 'Asleep' ? 'Walking home for the night' : 'On the way: ' + doing.toLowerCase();
    a.working = arrived && working;
    a.indoors = arrived && night && !!home;
    if (arrived && a.faceTo != null && working) a.face = a.faceTo;
    else if (arrived && tgt.look) a.face = Math.atan2(tgt.look.x - a.x, tgt.look.z - a.z);
  }

  /* ---------- who rules, and how they fall: debt, respect, approval and the moot ----------
     Everyone climbs the same ladder: hired hand, shop owner, council seat, Elder, Steward, Lord.
     Seats go to the most respected, respect comes from position, conduct and staying out of debt,
     and the moot can vote any leader out, you included. */
  const HOUSEHOLD = ['lord', 'steward', 'taxman', 'guard'];
  function isHousehold(p) { return !!(p && p.job && p.job.type === 'office' && HOUSEHOLD.includes(p.job.office)); }
  function thriftOf(p) { if (p.thrift != null) return p.thrift; const n = parseInt(String(p.id).slice(1), 10) || 1; return ((n * 2654435761) % 997) / 997; }
  function purseOf(s, who) { return who === 'player' ? s.coins : who && s.people[who] ? s.people[who].purse : 0; }
  function nameOf(s, who) { return who === 'player' ? s.name : who && s.people[who] ? s.people[who].name : 'nobody'; }
  function elderTitle(s) { const e = s.offices && s.offices.elder; if (!s.people) return REALM.elder; return e === 'player' ? 'Elder ' + s.name : e && s.people[e] ? 'Elder ' + s.people[e].name : 'The council'; }
  function lordTitle(s, short) {
    const l = s.offices && s.offices.lord; if (!s.people) return short ? REALM.lordShort : REALM.lord;
    const n = l === 'player' ? s.name : l && s.people[l] ? s.people[l].name : null;
    if (!n) return 'the lord';
    return 'Lord ' + (short ? n.split(' ').slice(-1)[0] : n);
  }
  function govLog(s, text, kind) { const g = s.gov; g.log.unshift({ day: s.day, text }); if (g.log.length > 24) g.log.length = 24; event(s, text, kind || 'info'); }
  function approve(s, key, n) { const g = s.gov; if (!g || !n) return; g.approval[key] = Math.round(clamp((g.approval[key] == null ? 50 : g.approval[key]) + n, 0, 100) * 10) / 10; }
  function approveHolder(s, who, n) {
    if (!s.gov || !n) return;
    if (who === 'player' && s.village.council && s.offices.elder !== 'player') approve(s, 'you', n);
    if (s.offices.elder === who) approve(s, 'elder', n);
    if (s.offices.lord === who) approve(s, 'lord', n);
  }
  function councilNames(s) { return s.gov.council.map(id => s.people[id] && s.people[id].name).filter(Boolean); }
  // respect: what the village thinks someone has earned
  function repTarget(s, p) {
    const j = p.job; let r;
    if (p.kid) return 10;
    if (!j) r = p.retired ? 25 : 5;
    else if (j.type === 'commons') r = 20;
    else if (j.type === 'shop') r = 24;
    else if (j.type === 'biz') { const b = s.biz[j.biz]; r = j.role === 'owner' ? 42 + clamp(avg(b.profits), -12, 16) : 22 + Math.min(10, (p.tenure || 0) / 3); }
    else r = { elder: 70, steward: 72, lord: 85, taxman: 35, guard: 30 }[j.office] || 30;
    if (s.gov && s.gov.council.includes(p.id)) r += 8;
    r += p.purse >= 0 ? Math.min(10, p.purse / 20) : Math.max(-30, p.purse / 6);
    if (!p.home) r -= 10;
    return clamp(r, 0, 100);
  }
  function initGov(s) {
    const v = s.village;
    if (!v.chest) v.chest = 40;
    s.gov = { approval: { elder: 62, lord: 55, you: 55 }, council: [], nextMoot: s.day + 5, relief: 'some', taxMul: 1, debtDays: 0, lordDebtDays: 0, petitions: 0,
      tollSetDay: -99, warned: false, log: [], lastMoot: null, lostSeatDay: null, reliefToday: 0, chestIn: 0, chestUp: 0 };
    for (const p of Object.values(s.people)) if (p.thrift == null) p.thrift = Math.round(thriftOf(p) * 100) / 100;
    const elder = s.offices.elder && s.people[s.offices.elder]; if (elder && elder.name === 'Brannoch') elder.thrift = 0.75;
    const lord = s.offices.lord && s.people[s.offices.lord]; if (lord && lord.name === 'Edric Varrow') lord.thrift = 0.55;
    for (const p of Object.values(s.people)) p.rep = Math.round(repTarget(s, p));
    fillCouncil(s, true);
    for (const p of Object.values(s.people)) p.rep = Math.round(repTarget(s, p));
  }
  function fillCouncil(s, quiet) {
    const g = s.gov, added = [];
    while (g.council.length < COUNCIL_SEATS) {
      const pick = villagers(s).filter(p => !g.council.includes(p.id) && s.offices.elder !== p.id && !isHousehold(p) && !p.retired && p.job && (p.job.role === 'owner' || p.job.type === 'office') && (p.rep || 0) >= 40)
        .sort((a, b) => (b.rep || 0) - (a.rep || 0))[0];
      if (!pick) break;
      g.council.push(pick.id); added.push(pick); plog(s, pick, 'Given a seat on the village council by the moot.');
      if (!quiet) govLog(s, 'The moot gives ' + pick.name + ' a seat on the council: ' + occupation(s, pick).toLowerCase() + ', and respected for it.', 'info');
    }
    return added;
  }

  /* each morning the chest takes in tolls and pays upkeep, and the leaders make their choices */
  function govMorning(s) {
    const g = s.gov, v = s.village;
    const toll = TOLLS[v.toll].coin * 3; v.chest += toll;
    const up = 1 + (v.towerBuilt ? 1 : 0) + Math.floor(Object.keys(v.projects).length / 2); v.chest -= up;
    g.chestIn = toll + v.chestDaily; g.chestUp = up;
    if (v.chest < 0) { const i = Math.max(1, Math.ceil(-v.chest * INTEREST)); v.chest -= i; g.chestUp += i; }
    let eid = s.offices.elder;
    if (eid && eid !== 'player' && (!s.people[eid] || s.people[eid].status !== 'here' || !s.people[eid].job || s.people[eid].job.office !== 'elder')) { s.offices.elder = null; eid = null; }
    if (!eid) electElder(s, null, 'The Elder’s chair stands empty, so the moot meets to fill it. ');
    eid = s.offices.elder;
    if (eid && eid !== 'player') elderDecides(s, s.people[eid]);
    relief(s);
    if (s.day % 7 === 1) lordDecides(s);
    if (s.day === g.nextMoot - 1) mootWarning(s);
    if (s.day >= g.nextMoot) { holdMoot(s); g.nextMoot = s.day + 7; }
  }
  function elderDecides(s, e) {
    const g = s.gov, v = s.village, t = thriftOf(e);
    // projects: a careful elder waits for the coin, a free-spending one borrows
    const open = Object.keys(PROJECTS).filter(k => !v.projects[k] && !(k === 'granary' && v.step < 4)); // the granary is the village's own task for a newcomer first
    const keep = v.step <= 6 ? 1 : 0; // leave something for a new councillor to do
    if (open.length > keep && rand(s) < 0.25) {
      const k = open.sort((a, b) => PROJECTS[a].cost - PROJECTS[b].cost)[0], pr = PROJECTS[k];
      const floor = t >= 0.5 ? 10 : -30 - Math.round((0.5 - t) * 200);
      if (v.chest - pr.cost >= Math.max(CHEST_FLOOR, floor)) {
        v.chest -= pr.cost; v.projects[k] = s.day; if (k === 'granary') v.shortage = false;
        approve(s, 'elder', 8); plog(s, e, 'As Elder, paid for ' + pr.name.toLowerCase() + '.');
        govLog(s, 'Elder ' + e.name + ' pays for ' + pr.name.toLowerCase() + (v.chest < 0 ? ', borrowing to do it. The village chest is now ' + (-v.chest) + 'c in debt.' : ' from the village chest.'), v.chest < 0 ? 'bad' : 'good');
      }
    }
    // the toll: raised when the chest is in trouble, dropped when it is full
    if (s.day - g.tollSetDay >= 7) {
      const want = v.chest < -20 ? 'high' : v.chest < 25 ? 'low' : v.chest > 90 ? 'none' : v.toll;
      if (want !== v.toll) {
        v.toll = want; g.tollSetDay = s.day; approve(s, 'elder', want === 'high' ? -3 : want === 'none' ? 2 : 0);
        govLog(s, 'Elder ' + e.name + ' sets the travelers’ toll: ' + TOLLS[want].name + (want === 'high' ? ', to pay down what the chest owes.' : want === 'low' ? ', to keep the chest from running dry.' : ', now the chest is full.'), 'info');
      }
    }
    // quarrels the elder hears alone, when you are not on the council
    if (!v.council && s.day % 5 === 2) {
      const d = DISPUTES[Math.floor(rand(s) * DISPUTES.length)];
      const opts = d.opts.filter(o => !o.chest || v.chest + o.chest >= (t < 0.45 ? CHEST_FLOOR : 0)).filter(o => !o.chestDaily || v.chestDaily < 2);
      const o = (t < 0.45 ? opts.find(x => x.chest) : opts.filter(x => !x.chest).sort((a, b) => b.standing - a.standing)[0]) || opts[0];
      if (o) {
        v.chest += o.chest || 0; v.chestDaily += o.chestDaily || 0;
        approve(s, 'elder', o.standing - 3);
        govLog(s, 'Elder ' + e.name + ' hears ' + d.a + ' and ' + d.b + '’s quarrel and rules: ' + (/^(The|Let|Draw) /.test(o.label) ? o.label.charAt(0).toLowerCase() + o.label.slice(1) : o.label) + '.', 'info');
      }
    }
  }
  function relief(s) {
    const g = s.gov, v = s.village, eid = s.offices.elder;
    const e = eid && eid !== 'player' ? s.people[eid] : null;
    const level = eid === 'player' ? g.relief : e ? (thriftOf(e) < 0.4 ? 'all' : thriftOf(e) < 0.8 ? 'some' : 'none') : 'none';
    g.reliefToday = 0; g.reliefLevel = level;
    if (level === 'none') return;
    const needy = villagers(s).filter(p => (p.hungry || !p.home) && !isHousehold(p) && p.purse < 6);
    const list = level === 'all' ? needy : needy.slice(0, 3), each = level === 'all' ? 3 : 2;
    for (const p of list) {
      if (level === 'some' ? v.chest < each : v.chest - each < CHEST_FLOOR) break;
      v.chest -= each; p.purse += each; g.reliefToday += each;
      if (eid === 'player') p.opinion = clamp(p.opinion + 2, -100, 100);
    }
    if (g.reliefToday) approve(s, 'elder', Math.min(3, g.reliefToday / 3));
  }
  function lordDecides(s) {
    const g = s.gov, v = s.village, lid = s.offices.lord;
    if (!lid) return;
    if (lid === 'player') { spend(s, 20); v.chest += 20; s.stats.given += 20; return; }
    const L = s.people[lid]; if (!L) return;
    const grant = L.purse < 0 ? 10 : 20; L.purse -= grant; v.chest += grant;
    if (grant < 20) { approve(s, 'lord', -3); govLog(s, lordTitle(s) + ', short of coin, sends only ' + grant + 'c to the village chest this week.', 'bad'); }
    if (L.purse < 40 && g.taxMul < 2) {
      g.taxMul = Math.round((g.taxMul + 0.5) * 10) / 10;
      let raised = 0;
      s.houses.filter(h => h.owner === 'office:lord' && h.rent < 4).forEach(h => { h.rent++; raised++; h.tenants.forEach(id => { const t = s.people[id]; if (t) { t.mood = clamp(t.mood - 5, 0, 100); plog(s, t, 'The lord raised the rent on ' + h.name + ' to ' + h.rent + 'c a day.'); } }); });
      approve(s, 'lord', -8);
      govLog(s, lordTitle(s) + ' is ' + (L.purse < 0 ? (-L.purse) + 'c in debt' : 'short of coin') + '. He raises taxes to ' + g.taxMul + ' times the old rate' + (raised ? ' and the rent on ' + raised + ' of his houses by 1c' : '') + '.', 'bad');
    } else if (L.purse > 350 && g.taxMul > 1) {
      g.taxMul = Math.round((g.taxMul - 0.5) * 10) / 10; approve(s, 'lord', 5);
      govLog(s, lordTitle(s) + '’s coffers are full again. He lowers taxes to ' + (g.taxMul === 1 ? 'the old rate' : g.taxMul + ' times the old rate') + '.', 'good');
    }
  }

  /* the moot: once a week the village meets in the hall */
  function mootAgenda(s) {
    const g = s.gov, e = s.offices.elder, items = [];
    if (e && g.approval.elder < 45) items.push('a vote of confidence in ' + (e === 'player' ? 'you as Elder' : 'Elder ' + nameOf(s, e)));
    if (s.village.council && e !== 'player' && g.approval.you < 40) items.push('whether you keep your council seat');
    if (s.offices.lord && s.offices.lord !== 'player' && g.approval.lord < 25) items.push('a petition to the King against ' + lordTitle(s));
    return items;
  }
  function mootWarning(s) {
    const items = mootAgenda(s);
    s.gov.warned = true;
    govLog(s, 'The moot meets tomorrow morning at the hall. ' + (items.length ? 'On the table: ' + items.join(', and ') + '.' : 'No one has called for a vote.'), items.length ? 'bad' : 'info');
  }
  function vote(s, who, a) {
    let yes = 0, no = 0;
    for (const p of villagers(s)) {
      if (isHousehold(p) || p.id === who || p.age < 16) continue;
      const personal = who === 'player' ? p.opinion * 0.4 : 0;
      const score = a + (p.mood - 50) * 0.25 + personal + (rand(s) - 0.5) * 24;
      if (score >= 45) yes++; else no++;
    }
    if (who === 'player') yes++;
    return { yes, no, keep: yes >= no };
  }
  function holdMoot(s) {
    const g = s.gov, v = s.village, notes = [], after = [];
    g.warned = false;
    // seats are kept by those who still have the village's respect
    g.council = g.council.filter(id => {
      const p = s.people[id];
      const keep = p && p.status === 'here' && (p.rep || 0) >= 30 && s.offices.elder !== id && !isHousehold(p);
      if (!keep && p) { plog(s, p, 'Lost their council seat.'); notes.push(p.name + ' loses their council seat' + (p.status !== 'here' ? ', having left the village.' : (p.rep || 0) < 30 ? ': the village no longer trusts their judgement.' : '.')); }
      return keep;
    });
    fillCouncil(s, true).forEach(p => notes.push(p.name + ' (' + occupation(s, p).toLowerCase() + ') is given a council seat.'));
    // your own seat
    if (v.council && s.offices.elder !== 'player' && g.approval.you < 40) {
      const r = vote(s, 'player', g.approval.you);
      if (r.keep) { s.rec.votesWon++; approve(s, 'you', 5); notes.push('You keep your council seat, ' + r.yes + ' votes to ' + r.no + '.'); }
      else { s.rec.votesLost++; v.council = false; g.lostSeatDay = s.day; addStanding(s, -10, null); notes.push('The moot votes you off the council, ' + r.no + ' to ' + r.yes + '. You no longer hold a key to the chest or a say over the toll. Win back the village and they may ask you back.'); }
    } else if (!v.council && g.lostSeatDay != null && g.approval.you >= 60) { v.council = true; g.lostSeatDay = null; notes.push('The moot asks you back onto the council.'); }
    // confidence in the Elder
    const eid = s.offices.elder;
    if (eid && g.approval.elder < 45) {
      const r = vote(s, eid, g.approval.elder), nm = eid === 'player' ? 'you' : 'Elder ' + nameOf(s, eid);
      if (r.keep) { notes.push('By ' + r.yes + ' votes to ' + r.no + ', the moot keeps ' + nm + ' in the chair.'); if (eid === 'player') s.rec.votesWon++; approve(s, 'elder', 6); }
      else {
        notes.push('By ' + r.no + ' votes to ' + r.yes + ', the moot votes ' + nm + ' out of the Elder’s chair.');
        if (eid === 'player') s.rec.votesLost++;
        after.push(() => { removeElder(s, eid); electElder(s, eid, ''); });
      }
    }
    // the lord answers to the King, but the moot may petition him
    const lid = s.offices.lord;
    if (lid && lid !== 'player' && g.approval.lord < 25) {
      g.petitions++;
      if (g.petitions >= 2) { notes.push('A second petition against ' + lordTitle(s) + ' goes to King Aldwin in Highcrown.'); after.push(() => replaceLord(s, 'the village petitioned the King against him twice')); }
      else notes.push('The moot sends a petition to King Aldwin against ' + lordTitle(s) + '. If nothing changes, a second will follow.');
    } else if (g.approval.lord >= 35) g.petitions = 0;
    g.lastMoot = { day: s.day, notes: notes.slice() };
    govLog(s, 'The moot meets. ' + (notes.length ? notes.join(' ') : 'No one calls for a vote, and the business is soon done.'), notes.length ? 'story' : 'info');
    after.forEach(f => f());
  }
  function removeElder(s, eid) {
    const g = s.gov;
    if (eid === 'player') { s.offices.elder = null; addStanding(s, -15, null); g.approval.you = Math.min(g.approval.you, 45); return; }
    const p = s.people[eid]; if (!p) { s.offices.elder = null; return; }
    appoint(s, 'elder', null);
    p.rep = Math.max(0, (p.rep || 0) - 25);
    const own = Object.values(s.biz).find(b => b.owner === p.id && !b.closed);
    if (own && !p.retired) { p.job = { type: 'biz', biz: own.id, role: 'owner' }; plog(s, p, 'Went back to running ' + empById(own.id).name + '.'); }
  }
  function electElder(s, exclude, prefix) {
    const g = s.gov, v = s.village;
    const cands = g.council.map(id => s.people[id]).filter(p => p && p.status === 'here' && p.id !== exclude && !isHousehold(p));
    const youRun = v.council && v.step >= 8 && exclude !== 'player' && s.offices.elder !== 'player' && g.approval.you >= 55;
    if (!cands.length) {
      // no one on the council: the most respected owner stands
      const alt = villagers(s).filter(p => p.id !== exclude && !isHousehold(p) && !p.retired && p.job && p.job.role === 'owner' && (p.rep || 0) >= 30).sort((a, b) => (b.rep || 0) - (a.rep || 0))[0];
      if (alt) cands.push(alt);
    }
    if (!cands.length && !youRun) { govLog(s, prefix + 'No one with the standing to lead puts their name forward. The Elder’s chair stays empty until someone earns it.', 'bad'); return null; }
    const tally = new Map(); cands.forEach(c => tally.set(c.id, 0)); if (youRun) tally.set('player', 1);
    let total = youRun ? 1 : 0;
    for (const p of villagers(s)) {
      if (isHousehold(p) || p.age < 16) continue;
      let best = null, bs = -1e9;
      if (tally.has(p.id)) best = p.id; // candidates vote for themselves
      else {
        for (const c of cands) { const sc = (c.rep || 0) + (p.job && c.job && p.job.biz && c.job.biz === p.job.biz ? 8 : 0) + (rand(s) - 0.5) * 16; if (sc > bs) { bs = sc; best = c.id; } }
        if (youRun) { const sc = g.approval.you * 0.9 + p.opinion * 0.3 + (rand(s) - 0.5) * 16; if (sc > bs) best = 'player'; }
      }
      tally.set(best, tally.get(best) + 1); total++;
    }
    const win = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const was = win === 'player' ? null : occupation(s, s.people[win]).toLowerCase();
    g.council = g.council.filter(id => id !== win);
    appoint(s, 'elder', win);
    g.approval.elder = 60;
    if (win === 'player') {
      s.rec.timesElected++; if (v.step === 8) v.step = 9;
      govLog(s, prefix + 'The moot elects you Elder of Hearthmoor, with ' + tally.get('player') + ' of ' + total + ' votes. You draw the elder’s 5c a day and run the village chest.', 'story');
    } else {
      const w = s.people[win]; plog(s, w, 'Elected Elder of Hearthmoor by the moot.');
      govLog(s, prefix + 'The moot elects ' + w.name + ', ' + was + ' and a councillor, as Elder of Hearthmoor (' + tally.get(win) + ' of ' + total + ' votes).', 'story');
    }
    fillCouncil(s, false);
    return win;
  }
  function replaceLord(s, why) {
    const g = s.gov, oldId = s.offices.lord, old = oldId && oldId !== 'player' ? s.people[oldId] : null;
    const stw = s.offices.steward && s.offices.steward !== 'player' ? s.people[s.offices.steward] : null;
    let heir;
    if (stw && stw.status === 'here' && (stw.rep || 0) >= 40) heir = stw;
    else { heir = newPerson(s, { name: ['Aldous Penrith', 'Hamon Grey', 'Bertram Ashe'][Math.floor(rand(s) * 3)], age: 40 + Math.floor(rand(s) * 12), purse: 300, palette: 2 }); heir.log.push({ day: s.day, text: 'Sent from Highcrown by King Aldwin to hold Hearthmoor.' }); }
    const oldName = old ? old.name : 'the lord';
    appoint(s, 'lord', heir.id);
    if (old) { old.rep = Math.max(0, (old.rep || 0) - 40); plog(s, old, 'Stripped of Hearthmoor by the King: ' + why + '.'); if (!old.home && old.status === 'here') { const h = vacancy(s, 99); if (h) moveIn(s, old, h); } }
    g.approval.lord = 55; g.petitions = 0; g.lordDebtDays = 0;
    let msg = 'King Aldwin strips ' + oldName + ' of Hearthmoor: ' + why + '. ' + heir.name + (heir === stw ? ', the steward who ran his estate,' : ', a knight from Highcrown,') + ' is the new Lord.';
    if (heir === stw) {
      // the new lord names a steward on merit: the Elder or a councillor
      const pick = [s.offices.elder].concat(g.council).map(id => id && id !== 'player' ? s.people[id] : null).filter(p => p && p.status === 'here').sort((a, b) => (b.rep || 0) - (a.rep || 0))[0];
      if (pick) {
        const wasElder = s.offices.elder === pick.id;
        g.council = g.council.filter(id => id !== pick.id);
        appoint(s, 'steward', pick.id); plog(s, pick, 'Named Steward of Hearthmoor by ' + lordTitle(s) + '.');
        govLog(s, msg + ' He names ' + pick.name + (wasElder ? ', the Elder,' : ', of the council,') + ' as his steward.', 'story');
        if (wasElder) electElder(s, pick.id, 'With the Elder gone to the manor, the moot must choose again. ');
        fillCouncil(s, false);
        return;
      }
    }
    govLog(s, msg, 'story');
  }

  /* each evening: interest, the leaders' own spending, respect and approval */
  function govEvening(s) {
    const g = s.gov, v = s.village, st = s.stats;
    if (s.coins < 0) {
      const i = Math.max(1, Math.ceil(-s.coins * INTEREST)); spend(s, i); st.interest = (st.interest || 0) + i; s.rec.interestPaid += i;
      g.debtDays = s.coins <= SEIZE_AT ? g.debtDays + 1 : 0;
      if (g.debtDays >= SEIZE_DAYS) seize(s);
      else if (g.debtDays) event(s, 'You owe the Ashford moneylender ' + (-s.coins) + 'c. ' + (SEIZE_DAYS - g.debtDays) + ' more day' + (SEIZE_DAYS - g.debtDays === 1 ? '' : 's') + ' this deep in debt and your creditors will seize what you own.', 'bad');
    } else g.debtDays = 0;
    if (s.coins < 0 && -s.coins > s.rec.maxDebt) s.rec.maxDebt = -s.coins;
    // leaders live as they choose to
    const eid = s.offices.elder, E = eid && eid !== 'player' ? s.people[eid] : null;
    if (E) E.purse -= Math.round((1 - thriftOf(E)) * 5);
    const lid = s.offices.lord, L = lid && lid !== 'player' ? s.people[lid] : null;
    if (L) { L.purse -= Math.round(6 + (1 - thriftOf(L)) * 14); g.lordDebtDays = L.purse <= LORD_FALL ? g.lordDebtDays + 1 : 0; }
    // respect follows position, money and conduct, slowly
    for (const p of living(s)) { const t = repTarget(s, p), r = p.rep == null ? t : p.rep; p.rep = Math.round((r + (t - r) * 0.12) * 10) / 10; }
    // approval of those who lead
    const pen = d => d < 0 ? Math.min(4, 1 + -d / 60) : 0;
    const pop = villagers(s).filter(p => !isHousehold(p));
    const hungry = pop.filter(p => p.hungry).length, homeless = pop.filter(p => !p.home).length;
    const A = g.approval;
    if (eid) A.elder += (55 - A.elder) * 0.08 - pen(v.chest) - pen(purseOf(s, eid)) - Math.min(3, hungry * 0.4 + homeless * 0.5) - (v.shortage ? 1 : 0);
    A.lord += (50 - A.lord) * 0.08 - (L ? pen(L.purse) : 0) - (g.taxMul - 1) * 2;
    if (v.council || g.lostSeatDay != null) A.you += (45 + Math.min(25, v.standing / 4) - A.you) * 0.08 - pen(s.coins);
    for (const k in A) A[k] = Math.round(clamp(A[k], 0, 100) * 10) / 10;
    if (L && g.lordDebtDays >= 3) replaceLord(s, 'he is ' + (-L.purse) + 'c in debt and cannot pay his own household');
  }
  // creditors take property until the debt is covered
  function seize(s) {
    const g = s.gov, v = s.village, taken = [];
    const before = s.coins;
    for (const h of s.houses.filter(x => x.owner === 'player')) {
      if (s.coins >= 0) break;
      const n = Math.round(housePrice(s, h) * 0.6); h.owner = 'office:lord'; earn(s, n); taken.push(h.name + ' (' + n + 'c)');
      h.tenants.forEach(id => plog(s, s.people[id], 'Now rents from the lord: ' + s.name + '’s creditors seized ' + h.name + '.'));
    }
    if (s.coins < 0 && ['owned', 'repaired', 'let'].includes(v.cottage)) { v.cottage = 'forsale'; earn(s, 50); taken.push('Old Ama’s cottage (50c)'); }
    for (const b of Object.values(s.biz).filter(x => x.owner === 'player')) {
      if (s.coins >= 0) break;
      const n = Math.round(bizPrice(s, b.id) * 0.5);
      const mgr = b.staff.map(x => s.people[x.pid]).find(Boolean);
      if (mgr) { b.staff = b.staff.filter(x => x.pid !== mgr.id); b.owner = mgr.id; mgr.job = { type: 'biz', biz: b.id, role: 'owner' }; plog(s, mgr, 'Took over ' + empById(b.id).name + ' when ' + s.name + '’s creditors seized it.'); }
      else if (s.offices.lord && s.offices.lord !== 'player') { b.owner = s.offices.lord; b.closed = true; }
      else continue;
      earn(s, n); taken.push(empById(b.id).name + ' (' + n + 'c)');
    }
    for (const sh of s.shops.slice()) {
      if (s.coins >= 0) break;
      const c0 = s.coins; cmd(s, 'sellShop', sh.id); taken.push('your ' + TRADES[sh.trade].name.toLowerCase() + ' (' + (s.coins - c0) + 'c)');
    }
    s.stats.seized = (s.stats.seized || 0) + (s.coins - before);
    s.rec.coinsEarned -= 0;
    s.rec.seizures++; g.debtDays = 0;
    approveHolder(s, 'player', -8);
    event(s, taken.length ? 'Your creditors from Ashford seize ' + taken.join(', ') + ' to cover your debts.' + (s.coins < 0 ? ' You still owe ' + (-s.coins) + 'c.' : '') : 'Your creditors find nothing left to seize. You still owe ' + (-s.coins) + 'c, and the interest keeps growing.', 'bad');
  }

  /* ---------- Oakbridge: the market city on the river Alder (Stage II) ---------- */
  /* Oakbridge, laid out at the scale of a real market town: an irregular wall that follows the lie of the land,
     a broad market square inside the south-west gate, the Guild Quarter to the north-west, the Riverside quay,
     and the East Bank with the town hall, the keep and the poorer lanes. Every building stands clear of the
     streets and of its neighbours. */
  const OAK = (function () {
    const C = { x: 432, z: -432 };
    let sd = 4711; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const segD = (x, z, pts) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return best; };
    const riverDist = (x, z) => segD(x, z, RIVER);
    const riverX = z => { for (let i = 0; i < RIVER.length - 1; i++) { const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1]; if ((z - az) * (z - bz) <= 0) return ax + (bx - ax) * (z - az) / (bz - az); } return C.x; };
    // the gate faces the road from Hearthmoor
    const ga = Math.atan2(-286 - C.z, 356 - C.x);
    const Rn = a => 118 + 9 * Math.sin(2 * a + 0.7) + 6 * Math.sin(3 * a + 2.1) + 4 * Math.sin(5 * a + 0.3);
    const gate0 = { x: C.x + Math.cos(ga) * Rn(ga), z: C.z + Math.sin(ga) * Rn(ga) };
    const u = { x: (C.x - gate0.x) / Rn(ga), z: (C.z - gate0.z) / Rn(ga) };
    const square = { x: gate0.x + u.x * 50, z: gate0.z + u.z * 50, r: 22 };
    // the bridge crosses square to the river
    const bz0 = -418, bx0 = riverX(bz0), rdx = riverX(bz0 - 10) - riverX(bz0 + 10), rlen = Math.hypot(rdx, -20), rv = { x: rdx / rlen, z: -20 / rlen }, pv = { x: -rv.z, z: rv.x };
    const sgn = pv.x > 0 ? 1 : -1;
    const bridge = { x: bx0, z: bz0, w: 6, half: 14, ax: bx0 - pv.x * 14 * sgn, az: bz0 - pv.z * 14 * sgn, bx: bx0 + pv.x * 14 * sgn, bz: bz0 + pv.z * 14 * sgn };
    const hallSq = { x: bridge.bx + 36, z: bridge.bz - 8, r: 15 };
    const hall = { x: hallSq.x + 24, z: hallSq.z, face: -Math.PI / 2 };
    const guildSq = { x: square.x - 34, z: square.z - 76, r: 11 };
    const guildhall = { x: guildSq.x - 19, z: guildSq.z, face: Math.PI / 2 };
    const keep = { x: hallSq.x + 8, z: hallSq.z - 74 };
    const quayX = z => riverX(z) - 11.5;
    const green = { x: hallSq.x + 26, z: hallSq.z + 50, r: 8 };
    const S = square, H = hallSq;
    const streets = [
      { name: 'Gate Street', w: 5, pts: [[gate0.x + u.x * 2, gate0.z + u.z * 2], [S.x - u.x * 20, S.z - u.z * 20]] },
      { name: 'Bridge Street', w: 4.6, pts: [[S.x + 15, S.z - 16], [(S.x + bridge.ax) / 2 + 3, (S.z + bridge.az) / 2 - 1], [bridge.ax, bridge.az]] },
      { name: 'Bridge Street', w: 4.6, pts: [[bridge.bx, bridge.bz], [H.x - 14, H.z - 3]] },
      { name: 'Guild Row', w: 4, pts: [[S.x - 2, S.z - 21], [S.x - 8, S.z - 52], [guildSq.x + 11, guildSq.z], [S.x - 10, S.z - 116], [S.x - 2, S.z - 150]] },
      { name: 'West Lane', w: 3.4, pts: [[S.x - 21, S.z - 6], [S.x - 46, S.z - 18], [S.x - 62, S.z - 40]] },
      { name: 'Mill Lane', w: 3.2, pts: [[S.x + 20, S.z + 9], [S.x + 40, S.z + 22], [quayX(S.z + 38), S.z + 38]] },
      { name: 'The Quay', w: 4, pts: [[quayX(-422), -422], [quayX(-470), -470], [quayX(-520), -520], [quayX(-548), -548]] },
      { name: 'Ropewalk', w: 3.2, pts: [[S.x - 2, S.z - 150], [quayX(-548) - 18, -540], [quayX(-548), -548]] },
      { name: 'Keep Street', w: 4, pts: [[H.x + 2, H.z - 15], [H.x + 4, H.z - 40], [keep.x, keep.z + 17]] },
      { name: 'Riverbank', w: 3.4, pts: [[bridge.bx + 2, bridge.bz - 4], [riverX(-470) + 16, -470], [riverX(-520) + 18, -520]] },
      { name: 'Tanners’ Lane', w: 3.2, pts: [[H.x + 3, H.z + 15], [H.x + 10, H.z + 45], [H.x + 2, H.z + 80]] },
      { name: 'Back Lane', w: 3, pts: [[H.x + 10, H.z + 45], [riverX(H.z + 60) + 16, H.z + 60]] }
    ];
    const streetDist = (x, z) => Math.min(...streets.map(st => segD(x, z, st.pts) - st.w / 2));
    // businesses front the squares and streets
    const onRing = (q, a, extra) => { const d = q.r + (extra || 5.4); return { x: q.x + Math.cos(a) * d, z: q.z + Math.sin(a) * d, face: Math.atan2(-Math.cos(a), -Math.sin(a)) }; };
    const onStreet = (si, t, side) => {
      const st = streets[si], pts = st.pts; let L = 0; const ls = []; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); L += l; }
      let d = t * L, i = 0; while (i < ls.length - 1 && d > ls[i]) { d -= ls[i]; i++; }
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], f = d / ls[i], nx = -(bz - az) / ls[i], nz = (bx - ax) / ls[i], off = st.w / 2 + 5;
      return { x: ax + (bx - ax) * f + nx * off * side, z: az + (bz - az) * f + nz * off * side, face: Math.atan2(-nx * side, -nz * side) };
    };
    const T = (id, trade, name, boss, at, district) => ({ id, trade, name, boss, x: at.x, z: at.z, face: at.face, district, town: 'oakbridge', noJob: true, oak: true, shift: [7, 17], wage: 7 });
    const biz = [
      T('o_corbin', 'bakery', "Corbin's Bakery", 'Corbin', onRing(S, 1.0), 'market'),
      T('o_sheaf', 'bakery', 'The Wheat Sheaf', 'Alys Thorne', onRing(S, -0.45), 'market'),
      T('o_bell', 'tavern', 'The Bell', 'Goodwife Rennet', onRing(S, -2.26), 'market'),
      T('o_haldane', 'butcher', "Haldane's Butchery", 'Haldane', onRing(S, 2.75), 'market'),
      T('o_wicks', 'chandler', 'Wicks & Tallow', 'Ottilie Wick', onRing(S, 0.05), 'market'),
      T('o_meriel', 'tailor', "Meriel's Tailoring", 'Meriel', onRing(S, 1.6), 'market'),
      T('o_brannigan', 'smithy', "Brannigan's Forge", 'Brannigan', onStreet(3, 0.2, -1), 'guild'),
      T('o_ironside', 'smithy', 'Ironside Smithy', 'Maud Ironside', onStreet(3, 0.24, 1), 'guild'),
      T('o_joinery', 'joinery', 'Oakbridge Joinery', 'Piran', onStreet(3, 0.6, 1), 'guild'),
      T('o_wheel', 'wheelwright', 'Hobbes the Wheelwright', 'Hobbes', onStreet(3, 0.68, -1), 'guild'),
      T('o_cooper', 'cooper', "Cooper's Yard", 'Edwin Cooper', onStreet(3, 0.8, 1), 'guild'),
      T('o_weavers', 'weaver', "Weavers' Hall", 'Isolde Weaver', onRing(guildSq, -1.57), 'guild'),
      T('o_potter', 'potter', 'The Pottery', 'Ansel', onRing(guildSq, 1.57), 'guild'),
      T('o_anchor', 'tavern', 'The Oak and Anchor', 'Mother Brisk', onStreet(6, 0.12, -1), 'riverside'),
      T('o_warehouse', 'carter', 'Riverside Carters', 'Garrick', onStreet(6, 0.45, -1), 'riverside'),
      T('o_boats', 'boatwright', 'Alder Boatwrights', 'Tamsin Reed', onStreet(6, 0.8, -1), 'riverside'),
      T('o_gilded', 'tavern', 'The Gilded Cup', 'Lucan', onRing(H, -1.0), 'east'),
      T('o_goldsmith', 'goldsmith', 'Fennick the Goldsmith', 'Fennick', onRing(H, 1.0), 'east'),
      T('o_apothecary', 'apothecary', 'The Apothecary', 'Sabine', onStreet(8, 0.45, 1), 'east'),
      T('o_mason', 'mason', 'Stonemasons of the Alder', 'Rook Mason', onStreet(8, 0.5, -1), 'east'),
      T('o_tannery', 'tanner', 'The Tannery', 'Wulf', onStreet(10, 0.85, -1), 'east'),
      T('o_mill', 'bakery', 'Riverside Bakehouse', 'Dunstan', onStreet(9, 0.55, 1), 'east')
    ];
    // the wall follows the ground, swinging out to take in everything that must be inside it
    const keepOut = biz.map(b => ({ x: b.x, z: b.z, m: 14 })).concat([{ x: keep.x, z: keep.z, m: 24 }, { x: hall.x, z: hall.z, m: 16 }, { x: guildhall.x, z: guildhall.z, m: 16 }]);
    streets.forEach(st => st.pts.forEach(([x, z]) => keepOut.push({ x, z, m: 12 })));
    const NV = 34, wall = [];
    for (let k = 0; k < NV; k++) {
      const a = ga + k / NV * Math.PI * 2;
      let R = Rn(a) + (k ? (r() - 0.5) * 6 : 0);
      for (const o of keepOut) { const ao = Math.atan2(o.z - C.z, o.x - C.x), da = Math.abs(Math.atan2(Math.sin(ao - a), Math.cos(ao - a))); if (da < 0.22) R = Math.max(R, Math.hypot(o.x - C.x, o.z - C.z) + o.m * (1 - da / 0.3)); }
      wall.push([C.x + Math.cos(a) * R, C.z + Math.sin(a) * R]);
    }
    wall.push(wall[0].slice());
    const gate = { x: wall[0][0], z: wall[0][1], face: Math.atan2(wall[0][0] - C.x, wall[0][1] - C.z) };
    streets[0].pts[0] = [gate.x + u.x * 1, gate.z + u.z * 1];
    const inside = (x, z) => { let c = false; for (let i = 0, j = wall.length - 2; i < wall.length - 1; j = i++) { const [xi, zi] = wall[i], [xj, zj] = wall[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const wallDist = (x, z) => segD(x, z, wall);
    const fits = (x, z, rad) => inside(x, z) && wallDist(x, z) > rad + 3 && riverDist(x, z) > rad + 8.5 && streetDist(x, z) > rad - 1.2 &&
      [S, H, guildSq, green].every(q => Math.hypot(x - q.x, z - q.z) > q.r + rad + 1) &&
      Math.hypot(x - hall.x, z - hall.z) > 11 + rad && Math.hypot(x - keep.x, z - keep.z) > 15 + rad && Math.hypot(x - guildhall.x, z - guildhall.z) > 9 + rad &&
      Math.hypot(x - gate.x, z - gate.z) > 12 + rad;
    // homes: a row along every street, and more in the yards behind
    const houses = [], taken = biz.map(b => ({ x: b.x, z: b.z, r: 5.2 }));
    const free = (x, z, rad) => taken.every(t => Math.hypot(x - t.x, z - t.z) > t.r + rad + 0.8);
    for (const row of [0, 1]) for (const st of streets) {
      for (let i = 0; i < st.pts.length - 1; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 4; d < len - 2; d += 2) for (const side of [-1, 1]) {
          const off = st.w / 2 + 4 + row * 11.5, x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side;
          const rad = 4.4;
          if (!fits(x, z, rad) || !free(x, z, rad)) continue;
          const tall = Math.hypot(x - S.x, z - S.z) < 75 || Math.hypot(x - H.x, z - H.z) < 45 ? r() < 0.75 : r() < 0.3;
          houses.push({ x, z, face: Math.atan2(-nx * side, -nz * side), tall }); taken.push({ x, z, r: rad });
        }
      }
    }
    // and more in the yards behind, each facing its nearest street
    const nearest = (x, z) => { let best = null, bd = 1e9; for (const st of streets) for (let i = 0; i < st.pts.length - 1; i++) { const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; best = { x: px, z: pz, d }; } } return best; };
    for (let k = 0; k < 3000 && houses.length < 125; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 135, x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d, rad = 4.4;
      const n = nearest(x, z); if (!n || n.d > 30 || !fits(x, z, rad) || !free(x, z, rad + 0.6)) continue;
      houses.push({ x, z, face: Math.atan2(n.x - x, n.z - z), tall: r() < 0.3 }); taken.push({ x, z, r: rad + 0.6 });
    }
    const spots = {
      docks: { x: quayX(-470) + 3, z: -470, rx: 1, rz: 22 }, carting: { x: biz[14].x - 9, z: biz[14].z, rx: 3, rz: 4 }, watch: { x: gate.x + u.x * 9, z: gate.z + u.z * 9, rx: 3, rz: 2 },
      washing: { x: quayX(S.z + 38) + 3, z: S.z + 38, rx: 1.5, rz: 4 }, oakfields: { x: 330, z: -300, rx: 12, rz: 8 }, labour: { x: keep.x - 16, z: keep.z + 6, rx: 5, rz: 4 }
    };
    // where townsfolk gather: never all in one place
    const plazas = [
      { id: 'square', name: 'the market square', x: S.x, z: S.z, r0: 4.5, r1: S.r - 2.5, w: 4 },
      { id: 'hallsq', name: 'the hall square', x: H.x, z: H.z, r0: 2, r1: H.r - 2, w: 2 },
      { id: 'guildsq', name: 'the guild yard', x: guildSq.x, z: guildSq.z, r0: 1.5, r1: guildSq.r - 2, w: 1 },
      { id: 'quay', name: 'the quay', x: quayX(-480) + 1, z: -480, r0: 0, r1: 9, w: 1.5, line: true },
      { id: 'green', name: 'Tanners’ Green', x: green.x, z: green.z, r0: 0, r1: green.r - 1, w: 0.8 }
    ];
    return { C, green, wall, board: { x: square.x - 9, z: square.z - 4 }, avoid: 7.6, push: 10.5, gate, inside, square, hallSq, guildSq, streets, biz, hall, keep, guildhall, bridge, houses, spots, plazas, riverDist, riverX, quayX };
  })();
  // the road from Hearthmoor runs to the gate, and the gate is where the wall meets it
  TOWNS.oakbridge.r = 135;
  OAKGATE.x = OAK.gate.x; OAKGATE.z = OAK.gate.z;
  ROADS.east.length = ROADS.east.findIndex(p => p[0] === 356) + 1;
  ROADS.east.push([OAK.gate.x - 6, OAK.gate.z + 14], [OAK.gate.x + Math.sin(OAK.gate.face) * 6, OAK.gate.z + Math.cos(OAK.gate.face) * 6], [OAK.gate.x, OAK.gate.z]);
  LOCS.oakgate = { x: OAK.gate.x + Math.sin(OAK.gate.face) * 4, z: OAK.gate.z + Math.cos(OAK.gate.face) * 4, r: 12, name: 'Oakbridge Gate' };
  LOCS.oaksq = { x: OAK.square.x, z: OAK.square.z, r: OAK.square.r, name: 'Oakbridge Market Square', town: 'oakbridge' };
  LOCS.oakhall = { x: OAK.hall.x - 9, z: OAK.hall.z, r: 6, name: 'Oakbridge Town Hall', town: 'oakbridge' };
  LOCS.oakguild = { x: OAK.guildhall.x + 8, z: OAK.guildhall.z, r: 5, name: 'The Guildhall', town: 'oakbridge' };
  LOCS.oakkeep = { x: OAK.keep.x, z: OAK.keep.z + 9, r: 6, name: 'Oakbridge Keep', town: 'oakbridge' };
  LOCS.oakbridge = { x: OAK.bridge.x, z: OAK.bridge.z, r: 6, name: 'The Oak Bridge', town: 'oakbridge' };
  OAK.biz.forEach(b0 => { LOCS['ob:' + b0.id] = { x: b0.x + Math.sin(b0.face) * 3.6, z: b0.z + Math.cos(b0.face) * 3.6, r: 3.2, name: b0.name, biz: b0.id, town: 'oakbridge' }; });
  const OAK_JOBS = { docks: ['Porter on the quay', 'Hauling cargo on the quay'], carting: ['Carter', 'Loading carts'], watch: ['Town watchman', 'Keeping watch at the gate'], washing: ['Washer', 'Washing linen at the river steps'], oakfields: ['Field hand', 'Working the fields outside the walls'], labour: ['Labourer', 'Hauling stone on the east bank'] };
  OAK.biz.forEach(b => { b.spot = { x: b.x + Math.sin(b.face) * 1.2, z: b.z + Math.cos(b.face) * 1.2 }; b.front = { x: b.x + Math.sin(b.face) * 4, z: b.z + Math.cos(b.face) * 4 }; BIZ_SITES.push(b); });
  /* ---------- Greenhaven: a farming town on the river Green (Stage II) ----------
     Cottages around a broad village green with its maypole and well; the Great Mill on the river;
     the Plough inn; the moot hall where the reeve and council sit; Ashcombe Hall on its rise across
     the river; and all around, open fields, pasture and orchards. No walls: it has never needed them. */
  const GREEN = [[-330, -1400], [-292, -1100], [-270, -930], [-262, -830], [-272, -742], [-326, -610], [-440, -430], [-640, -230], [-900, -70]];
  const GH = (function () {
    const C = { x: -238, z: -826 };
    let sd = 5113; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const segD = (x, z, pts) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return best; };
    const riverDist = (x, z) => segD(x, z, GREEN);
    const riverX = z => { for (let i = 0; i < GREEN.length - 1; i++) { const [ax, az] = GREEN[i], [bx, bz] = GREEN[i + 1]; if ((z - az) * (z - bz) <= 0) return ax + (bx - ax) * (z - az) / (bz - az); } return C.x; };
    const green = { x: -222, z: -826, r: 17 };
    const bz0 = -838, bx0 = riverX(bz0);
    const bridge = { x: bx0, z: bz0, w: 4.2, half: 9, ax: bx0 - 9, az: bz0, bx: bx0 + 9, bz: bz0 };   // ax/az on the west bank
    const entry = { x: -168, z: -808 };
    const streets = [
      { name: 'High Street', w: 4.4, pts: [[entry.x, entry.z], [-186, -812], [green.x + 17, green.z - 2]] },
      { name: 'Bridge Lane', w: 3.6, pts: [[green.x - 17, green.z - 3], [bridge.bx, bridge.bz]] },
      { name: 'Mill Lane', w: 3.4, pts: [[green.x - 6, green.z - 16], [-236, -856], [riverX(-872) + 14, -872]] },
      { name: 'South Lane', w: 3.2, pts: [[green.x + 2, green.z + 17], [-218, -790], [-222, -760]] },
      { name: 'Back Lane', w: 2.8, pts: [[green.x + 12, green.z - 12], [-196, -852], [-194, -876]] },
      { name: 'Hall Drive', w: 3.2, pts: [[bridge.ax, bridge.az], [-290, -842], [-304, -850]] },
      { name: 'Orchard Lane', w: 2.6, pts: [[green.x + 12, green.z + 12], [-190, -800], [-178, -786]] }
    ];
    const streetDist = (x, z) => Math.min(...streets.map(st => segD(x, z, st.pts) - st.w / 2));
    const onRing = (q, a, extra) => { const d = q.r + (extra || 5.4); return { x: q.x + Math.cos(a) * d, z: q.z + Math.sin(a) * d, face: Math.atan2(-Math.cos(a), -Math.sin(a)) }; };
    const onStreet = (si, t, side) => {
      const st = streets[si], pts = st.pts; let L = 0; const ls = []; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); L += l; }
      let d = t * L, i = 0; while (i < ls.length - 1 && d > ls[i]) { d -= ls[i]; i++; }
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], f = d / ls[i], nx = -(bz - az) / ls[i], nz = (bx - ax) / ls[i], off = st.w / 2 + 5;
      return { x: ax + (bx - ax) * f + nx * off * side, z: az + (bz - az) * f + nz * off * side, face: Math.atan2(-nx * side, -nz * side) };
    };
    const millAt = { x: riverX(-874) + 10, z: -874, face: Math.PI / 2 };
    const T = (id, trade, name, boss, at, district) => ({ id, trade, name, boss, x: at.x, z: at.z, face: at.face, district, town: 'greenhaven', noJob: true, oak: true, shift: [6, 16], wage: 6 });
    const biz = [
      T('g_mill', 'mill', 'The Great Mill', 'Hamon Miller', millAt, 'river'),
      T('g_plough', 'tavern', 'The Plough', 'Goodwife Elsbeth', onRing(green, -2.55), 'green'),
      T('g_bake', 'bakery', 'Greenhaven Bakehouse', 'Osric Baxter', onRing(green, -1.35), 'green'),
      T('g_forge', 'smithy', 'Brook Forge', 'Wat Smith', onStreet(0, 0.35, 1), 'green'),
      T('g_dairy', 'dairy', 'Meadow Dairy', 'Mabel Cowley', onRing(green, 1.12), 'green'),
      T('g_fleece', 'weaver', 'Fleece & Loom', 'Agnes Webb', onRing(green, 2.1), 'green'),
      T('g_butcher', 'butcher', 'Coker the Butcher', 'Ralf Coker', onStreet(3, 0.55, -1), 'south'),
      T('g_wheel', 'wheelwright', 'Cartwright\u2019s Yard', 'Jack Cartwright', onStreet(0, 0.6, -1), 'green'),
      T('g_estate', 'estate', 'Ashcombe Hall', 'Maud Ashcombe', { x: -318, z: -850, face: Math.PI / 2 }, 'estate')
    ];
    const hall = onRing(green, 2.72, 7);                                               // the moot hall, facing the green from the south-west
    const estate = { x: -318, z: -850, face: Math.PI / 2, r: 16 };             // Ashcombe Hall, on its rise
    const fields = [
      { x: -150, z: -860, w: 44, d: 34, crop: 0 }, { x: -150, z: -760, w: 40, d: 30, crop: 3 }, { x: -205, z: -740, w: 34, d: 26, crop: 2 },
      { x: -205, z: -905, w: 44, d: 26, crop: 0 }, { x: -320, z: -790, w: 38, d: 28, crop: 1 }
    ];
    const pastures = [{ x: -330, z: -905, w: 50, d: 36, kind: 'sheep' }, { x: -308, z: -742, w: 30, d: 24, kind: 'cows' }];
    const orchard = { x: -172, z: -788, w: 20, d: 16 };
    const inField = (x, z, m) => fields.concat(pastures, [orchard]).some(f => Math.abs(x - f.x) < f.w / 2 + m && Math.abs(z - f.z) < f.d / 2 + m);
    const fits = (x, z, rad) => riverDist(x, z) > rad + 9 && streetDist(x, z) > rad - 1.2 && Math.hypot(x - green.x, z - green.z) > green.r + rad + 1 &&
      Math.hypot(x - hall.x, z - hall.z) > 9 + rad && Math.hypot(x - estate.x, z - estate.z) > estate.r + rad && !inField(x, z, rad) && Math.hypot(x - C.x, z - C.z) < 70;
    const houses = [], taken = biz.map(b => ({ x: b.x, z: b.z, r: b.id === 'g_mill' ? 8 : b.id === 'g_estate' ? 12 : 5.2 }));
    const free = (x, z, rad) => taken.every(t => Math.hypot(x - t.x, z - t.z) > t.r + rad + 1.2);
    for (const row of [0, 1]) for (const st of streets) {
      if (st.name === 'Hall Drive') continue;
      for (let i = 0; i < st.pts.length - 1; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 3; d < len - 2; d += 2) for (const side of [-1, 1]) {
          const off = st.w / 2 + 4 + row * 11, x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side, rad = 3.8;
          if (!fits(x, z, rad) || !free(x, z, rad)) continue;
          houses.push({ x, z, face: Math.atan2(-nx * side, -nz * side), tall: r() < 0.15 }); taken.push({ x, z, r: rad });
        }
      }
    }
    // cottages facing the green, between the shops
    for (let k = 0; k < 24; k++) { const at = onRing(green, k / 24 * Math.PI * 2, 5); if (fits(at.x, at.z, 3.8) && free(at.x, at.z, 3.8)) { houses.push({ x: at.x, z: at.z, face: at.face, tall: false }); taken.push({ x: at.x, z: at.z, r: 3.8 }); } }
    const spots = {
      ghfields: { x: fields[0].x, z: fields[0].z, rx: 18, rz: 13 }, ghfields2: { x: fields[1].x, z: fields[1].z, rx: 16, rz: 11 },
      shepherd: { x: pastures[0].x, z: pastures[0].z, rx: 20, rz: 14 }, cowherd: { x: pastures[1].x, z: pastures[1].z, rx: 11, rz: 9 },
      orchard: { x: orchard.x, z: orchard.z, rx: 8, rz: 6 }, hedging: { x: -195, z: -880, rx: 14, rz: 3 }
    };
    const plazas = [
      { id: 'green', name: 'the village green', x: green.x, z: green.z, r0: 4, r1: green.r - 2, w: 4 },
      { id: 'innyard', name: 'the Plough\u2019s yard', x: biz[1].x + Math.sin(biz[1].face) * 8, z: biz[1].z + Math.cos(biz[1].face) * 8, r0: 0, r1: 3.5, w: 1 },
      { id: 'millyard', name: 'the mill yard', x: millAt.x + 9, z: millAt.z + 2, r0: 0, r1: 4, w: 1 }
    ];
    const inside = () => true;
    return { C, green, bridge, streets, biz, hall, estate, fields, pastures, orchard, houses, spots, plazas, riverDist, riverX, inside, entry, waterHalf: 5, avoid: 5.4, push: 7.5, board: { x: green.x + 6, z: green.z + 15 } };
  })();
  TOWNS.greenhaven.x = GH.C.x; TOWNS.greenhaven.z = GH.C.z;
  // the north road leaves the east road at the waystation fork and climbs to Greenhaven
  ROADS.north = [[240, -58], [238, -120], [216, -200], [172, -300], [122, -400], [62, -500], [-8, -600], [-78, -690], [-128, -760], [-150, -792], [GH.entry.x, GH.entry.z]];
  LOCS.ghgreen = { x: GH.green.x, z: GH.green.z, r: GH.green.r, name: 'Greenhaven Village Green', town: 'greenhaven' };
  LOCS.ghhall = { x: GH.hall.x + Math.sin(GH.hall.face) * 6, z: GH.hall.z + Math.cos(GH.hall.face) * 6, r: 4.5, name: 'Greenhaven Moot Hall', town: 'greenhaven' };
  LOCS.ghbridge = { x: GH.bridge.x, z: GH.bridge.z, r: 5, name: 'The Green Bridge', town: 'greenhaven' };
  LOCS.ghentry = { x: GH.entry.x + 4, z: GH.entry.z + 1, r: 8, name: 'The road into Greenhaven', town: 'greenhaven' };
  GH.biz.forEach(b0 => { const d = b0.id === 'g_estate' ? 9 : b0.id === 'g_mill' ? 6 : 3.6; LOCS['gb:' + b0.id] = { x: b0.x + Math.sin(b0.face) * d, z: b0.z + Math.cos(b0.face) * d, r: 3.4, name: b0.name, biz: b0.id, town: 'greenhaven' }; });
  GH.biz.forEach(b => { const d = b.id === 'g_estate' ? 7 : b.id === 'g_mill' ? 5 : 1.2, f = d + (b.id === 'g_estate' ? 2 : 2.8); b.spot = { x: b.x + Math.sin(b.face) * d, z: b.z + Math.cos(b.face) * d }; b.front = { x: b.x + Math.sin(b.face) * f, z: b.z + Math.cos(b.face) * f }; BIZ_SITES.push(b); });
  const GH_JOBS = { ghfields: ['Field hand', 'Working the wheat fields'], ghfields2: ['Field hand', 'Hoeing the barley'], shepherd: ['Shepherd', 'Minding the sheep'], cowherd: ['Cowherd', 'Minding the cattle'], orchard: ['Orchard hand', 'Tending the orchard'], hedging: ['Hedger', 'Laying the hedges'] };
  Object.assign(BIZ_BASE, { dairy: 22, estate: 40 });
  const LAYOUT = { oakbridge: OAK, greenhaven: GH };
  /* ---------- getting about: stage posts and coaches, and a horse of your own ---------- */
  const STAGE = {
    hearthmoor: { x: 72, z: 11, face: 0, name: 'Hearthmoor Stage Post' },
    oakbridge: { x: OAK.square.x - 10, z: OAK.square.z + 24, face: 0, name: 'Oakbridge Stage Post' },
    greenhaven: { x: GH.entry.x - 6, z: GH.entry.z - 9, face: 0, name: 'Greenhaven Stage Post' }
  };
  // in the towns, the stage post takes the nearest clear ground to where the road comes in, facing the nearest street
  const segDist0 = (x, z, pts) => { let b = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
  for (const [id, L, from] of [['oakbridge', OAK, OAK.gate], ['greenhaven', GH, GH.entry]]) {
    const blds = L.houses.map(h => [h.x, h.z]).concat(L.biz.map(b => [b.x, b.z])), st = STAGE[id];
    let best = null;
    for (let r0 = 10; r0 < 70 && !best; r0 += 2) for (let k = 0; k < 36 && !best; k++) {
      const a0 = k / 36 * Math.PI * 2, x = from.x + Math.cos(a0) * r0, z = from.z + Math.sin(a0) * r0;
      if ((L.inside && !L.inside(x, z)) || (L.wall && segDist0(x, z, L.wall) < 12) || L.riverDist(x, z) < 16) continue;
      if (blds.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 11.5)) continue;
      if (L.streets.some(q => segDist0(x, z, q.pts) < q.w / 2 + 6) || L.plazas.some(q => Math.hypot(q.x - x, q.z - z) < (q.r1 || 4) + 8)) continue;
      if (L.fields && L.fields.concat(L.pastures, [L.orchard]).some(f => Math.abs(x - f.x) < f.w / 2 + 6 && Math.abs(z - f.z) < f.d / 2 + 6)) continue;
      best = { x, z };
    }
    if (best) { st.x = best.x; st.z = best.z; }
    let nb = null, nd = 1e9; for (const q of L.streets) for (let i = 0; i < q.pts.length - 1; i++) { const [ax, az] = q.pts[i], [bx, bz] = q.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((st.x - ax) * dx + (st.z - az) * dz) / L2)), px = ax + t * dx, pz = az + t * dz, d = Math.hypot(st.x - px, st.z - pz); if (d < nd) { nd = d; nb = { x: px, z: pz }; } }
    if (nb) st.face = Math.atan2(nb.x - st.x, nb.z - st.z);
  }
  for (const id in STAGE) LOCS['stage:' + id] = { x: STAGE[id].x, z: STAGE[id].z, r: 5, name: STAGE[id].name, town: id === 'hearthmoor' ? undefined : id, stage: id };
  const polyLen = pts => { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; };
  // distances by road: the east road to the fork at the waystation, then on east to Oakbridge or north to Greenhaven
  const forkAt = ROADS.east.findIndex(p => p[0] === 240);
  const LEG = { hearthmoor: polyLen(ROADS.east.slice(0, forkAt + 1)) + 75, oakbridge: polyLen(ROADS.east.slice(forkAt)) + 30, greenhaven: polyLen(ROADS.north) + 20 };
  const roadDist = (a, b) => a === b ? 0 : LEG[a] + LEG[b];
  const COACH_MPM = 15, WALK_MPM = 7.8, RIDE_MPM = 18;   // metres per game minute (walking is 6.5 m a second, and a game minute is 1.2 seconds)
  const fare = (a, b) => Math.max(4, Math.round(roadDist(a, b) / 110));
  const HORSE_PRICE = 140, HORSE_SELL = 80, STABLING = 1;
  function travelTo(s, town, how) {
    const from = townAt(s.player.x, s.player.z) || 'hearthmoor', d = roadDist(from, town), st = STAGE[town];
    const mins = Math.round(d / (how === 'coach' ? COACH_MPM : how === 'ride' ? RIDE_MPM : WALK_MPM));
    s.player.x = st.x + Math.sin(st.face) * 3; s.player.z = st.z + Math.cos(st.face) * 3; s.player.dest = null; s.player.action = null;
    s.rec.walked += d;
    return mins;
  }
  Object.assign(BIZ_BASE, { butcher: 28, chandler: 22, tailor: 24, wheelwright: 24, cooper: 22, weaver: 24, tanner: 24, potter: 20, carter: 26, boatwright: 24, goldsmith: 34, apothecary: 26, mason: 26 });
  const TRADE_NAMES = { bakery: 'Bakery', tavern: 'Tavern', smithy: 'Smithy', joinery: 'Joinery', mill: 'Milling', butcher: 'Butchery', chandler: 'Chandlery', tailor: 'Tailoring', wheelwright: 'Wheelwright', cooper: 'Cooperage', dairy: 'Dairy', estate: 'Farming estate', weaver: 'Weaving', tanner: 'Tannery', potter: 'Pottery', carter: 'Carting', boatwright: 'Boatbuilding', goldsmith: 'Goldsmithing', apothecary: 'Apothecary', mason: 'Masonry' };
  const tradeName = t => TRADE_NAMES[t] || (TRADES[t] && TRADES[t].name) || t;
  const townOf = p => (p && p.town) || 'hearthmoor';
  const townSpots = town => { const L = LAYOUT[town]; if (!L) return null; const q = L.plazas[0]; return { well: { x: q.x, z: q.z }, plaza: { x: q.x + 2, z: q.z + 6 }, board: L.board || { x: q.x - 9, z: q.z - 4 }, center: L.C }; };

  const FIRST = ['Alda', 'Bertram', 'Cecily', 'Denholm', 'Edith', 'Fulk', 'Gisela', 'Hugh', 'Imogen', 'Jory', 'Katrin', 'Leofric', 'Mabyn', 'Nell', 'Osbert', 'Petra', 'Quenby', 'Ralph', 'Sibyl', 'Thurstan', 'Una', 'Walter', 'Yseult', 'Aelred', 'Beatrix', 'Clement', 'Dulcie', 'Emery', 'Faye', 'Godwin', 'Hawise', 'Ivo', 'Joan', 'Kit', 'Lettice', 'Martin', 'Nesta', 'Odo', 'Philippa', 'Roger', 'Sabine', 'Tibby', 'Wymond', 'Avice', 'Baldric', 'Constance', 'Drogo', 'Eda', 'Fenwick', 'Gilbert', 'Helewise', 'Isabel', 'Jocelyn', 'Lambert', 'Muriel', 'Norbert', 'Orabel', 'Peregrine', 'Rohese', 'Simon', 'Tiffany', 'Warin'];
  const FAMILY = ['Ashby', 'Brewer', 'Carver', 'Dyer', 'Fletcher', 'Glover', 'Hayward', 'Kemp', 'Lister', 'Marsh', 'Nash', 'Parr', 'Quarrie', 'Rook', 'Sadler', 'Tanner', 'Underhill', 'Vane', 'Webb', 'Yates', 'Alder', 'Bridger', 'Crofter', 'Fenn', 'Holt', 'Mercer', 'Pike', 'Ridley', 'Stroud', 'Thatcher'];
  function setupOakbridge(s) {
    if (s.towns && s.towns.oakbridge) return;
    let sd = 90210; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const used = new Set(Object.values(s.people).map(p => p.name));
    const FIRST_F = FIRST.filter(n => FEMALE.has(n)), FIRST_M = FIRST.filter(n => !FEMALE.has(n));
    const nameFor = (fam, sex) => { const L = sex === 'f' ? FIRST_F : sex === 'm' ? FIRST_M : FIRST; for (let k = 0; k < 40; k++) { const n = L[Math.floor(r() * L.length)] + ' ' + fam; if (!used.has(n)) { used.add(n); return n; } } const n = 'Townsfolk ' + used.size; used.add(n); return n; };
    const oh = OAK.houses.map((h, i) => ({ id: 'o' + i, name: (h.tall ? 'Townhouse, ' : 'Cottage, ') + (h.x < OAK.riverX(h.z) ? 'west bank' : 'east bank'), x: h.x, z: h.z, owner: 'town:oakbridge', rent: h.tall ? 4 : 3, cap: h.tall ? 6 : 4, tenants: [], town: 'oakbridge' }));
    s.houses.push(...oh);
    const P0 = (o, h) => { const p = newPerson(s, Object.assign({ town: 'oakbridge', purse: 20 + Math.floor(r() * 25), palette: Math.floor(r() * 10) }, o)); if (h) moveIn(s, p, h); p.log = [{ day: s.day, text: 'Lives in Oakbridge.' }]; p.rep = 20; return p; };
    let hi = 0; const nextHouse = () => oh[hi++ % oh.length];
    const family = (head, h, fam, kids) => {
      const sp = r() < 0.75 ? P0({ name: nameFor(fam, sexOf(head) === 'f' ? 'm' : 'f'), age: Math.max(18, head.age - 4 + Math.floor(r() * 8)) }, h) : null;
      if (sp) { head.spouse = sp.id; sp.spouse = head.id; sp.hh = head.id; }
      for (let k = 0; k < kids; k++) { const c = P0({ name: nameFor(fam), age: 2 + Math.floor(r() * 12), purse: 0 }, h); c.kid = true; c.parents = [head.id].concat(sp ? [sp.id] : []); c.hh = head.id; }
      return sp;
    };
    // the businesses: their owners live above them, their hands in town
    for (const b of OAK.biz) {
      const fam = b.boss.includes(' ') ? b.boss.split(' ').slice(-1)[0] : FAMILY[Math.floor(r() * FAMILY.length)];
      const own = P0({ name: b.boss.includes(' ') ? b.boss : b.boss + ' ' + fam, age: 35 + Math.floor(r() * 25), purse: 110 + Math.floor(r() * 90), job: { type: 'biz', biz: b.id, role: 'owner' }, home: 'biz:' + b.id });
      used.add(own.name);
      s.biz[b.id] = { id: b.id, trade: b.trade, owner: own.id, staff: [], profits: [9, 9, 9], closed: false, opened: 0, lastProfit: 0, lastRevenue: 0, town: 'oakbridge' };
      const sp = r() < 0.6 ? P0({ name: nameFor(fam, sexOf(own) === 'f' ? 'm' : 'f'), age: own.age - 3, home: 'biz:' + b.id }) : null;
      if (sp) { own.spouse = sp.id; sp.spouse = own.id; sp.hh = own.id; }
      const nh = 1 + Math.floor(r() * 2);
      for (let k = 0; k < nh; k++) {
        const hf = FAMILY[Math.floor(r() * FAMILY.length)], h = nextHouse();
        const hand = P0({ name: nameFor(hf), age: 18 + Math.floor(r() * 25), job: { type: 'biz', biz: b.id, role: 'hand' } }, h);
        s.biz[b.id].staff.push({ pid: hand.id, wage: 7 + Math.floor(r() * 3) });
        if (r() < 0.5) family(hand, h, hf, Math.floor(r() * 3));
      }
    }
    // the working town: porters, carters, the watch, washerwomen, field hands, labourers, and some out of work
    const jobs = Object.keys(OAK_JOBS);
    while (Object.values(s.people).filter(p => p.town === 'oakbridge').length < 236) {
      const fam = FAMILY[Math.floor(r() * FAMILY.length)], h = nextHouse();
      const head = P0({ name: nameFor(fam), age: 20 + Math.floor(r() * 40), job: r() < 0.88 ? { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] } : null }, h);
      const sp = family(head, h, fam, Math.floor(r() * 4));
      if (sp && r() < 0.6) sp.job = { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] };
    }
    // some homes belong to the town, the rest to its wealthier merchants
    const landlords = Object.values(s.people).filter(p => p.town === 'oakbridge' && p.job && p.job.role === 'owner');
    oh.forEach(h => { if (r() < 0.6) { const l = landlords[Math.floor(r() * landlords.length)]; if (!h.tenants.includes(l.id)) h.owner = l.id; } });
    // the mayor: the most respected guild master, chosen by the town
    for (const p of Object.values(s.people)) if (p.town === 'oakbridge') p.rep = Math.round(repTarget(s, p));
    const masters = Object.values(s.people).filter(p => p.town === 'oakbridge' && p.job && p.job.role === 'owner').sort((a, b) => b.rep - a.rep || b.purse - a.purse);
    const mayor = masters[0];
    s.towns = s.towns || {};
    s.towns.oakbridge = { chest: 200, fee: 'normal', approval: 60, council: masters.slice(1, 5).map(p => p.id), mayor: mayor.id, nextVote: s.day + 6, log: [], lastVote: null };
    plog(s, mayor, 'Elected Mayor of Oakbridge by the guilds and townsfolk.');
  }
  // saves from the first, smaller Oakbridge: every home keeps its family and moves to its place in the larger town
  function rebuildOakbridge(s) {
    if (!s.towns || !s.towns.oakbridge) return;
    const have = new Map(s.houses.filter(h => h.town === 'oakbridge').map(h => [h.id, h]));
    OAK.houses.forEach((h0, i) => {
      const name = (h0.tall ? 'Townhouse, ' : 'Cottage, ') + (h0.x < OAK.riverX(h0.z) ? 'west bank' : 'east bank');
      const h = have.get('o' + i);
      if (h) { h.x = h0.x; h.z = h0.z; h.name = name; have.delete('o' + i); }
      else s.houses.push({ id: 'o' + i, name, x: h0.x, z: h0.z, owner: 'town:oakbridge', rent: h0.tall ? 4 : 3, cap: h0.tall ? 6 : 4, tenants: [], town: 'oakbridge' });
    });
    // any home beyond the new count: its people move into the empty ones
    for (const h of have.values()) {
      s.houses = s.houses.filter(x => x !== h);
      for (const id of h.tenants) { const p = s.people[id]; if (!p) continue; p.home = null; const nh = vacancy(s, 99, 'oakbridge'); if (nh) moveIn(s, p, nh); }
    }
    s.agents = s.agents.filter(a => !(a.kind === 'person' && townOf(s.people[a.pid]) === 'oakbridge'));
    if (s.bodiesIn === 'oakbridge') s.bodiesIn = null;
    if (Math.hypot(s.player.x - OAK.C.x, s.player.z - OAK.C.z) < 150) { s.player.x = OAK.square.x; s.player.z = OAK.square.z + 8; s.player.dest = null; s.player.action = null; }
    event(s, 'Oakbridge has grown: wider streets, a larger market square, a stone bridge you can cross, and new walls that follow the land.', 'story');
  }
  // Greenhaven: about eighty farming folk, the miller, the inn, the Ashcombes of the Hall, and a reeve chosen from among them
  function setupGreenhaven(s) {
    if (!s.towns || s.towns.greenhaven) return;
    let sd = 31337; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const used = new Set(Object.values(s.people).map(p => p.name));
    const FIRST_F = FIRST.filter(n => FEMALE.has(n)), FIRST_M = FIRST.filter(n => !FEMALE.has(n));
    const nameFor = (fam, sex) => { const L = sex === 'f' ? FIRST_F : sex === 'm' ? FIRST_M : FIRST; for (let k = 0; k < 40; k++) { const n = L[Math.floor(r() * L.length)] + ' ' + fam; if (!used.has(n)) { used.add(n); return n; } } const n = 'Farmer ' + used.size; used.add(n); return n; };
    const gh = GH.houses.map((h, i) => ({ id: 'g' + i, name: (h.tall ? 'Farmhouse, ' : 'Cottage, ') + (h.x < GH.riverX(h.z) ? 'by the Hall' : Math.hypot(h.x - GH.green.x, h.z - GH.green.z) < 40 ? 'on the green' : 'Greenhaven'), x: h.x, z: h.z, owner: 'town:greenhaven', rent: h.tall ? 3 : 2, cap: h.tall ? 6 : 4, tenants: [], town: 'greenhaven' }));
    s.houses.push(...gh);
    const P0 = (o, h) => { const p = newPerson(s, Object.assign({ town: 'greenhaven', purse: 14 + Math.floor(r() * 20), palette: Math.floor(r() * 10) }, o)); if (h) moveIn(s, p, h); p.log = [{ day: s.day, text: 'Lives in Greenhaven.' }]; p.rep = 20; return p; };
    let hi = 0; const nextHouse = () => gh[hi++ % gh.length];
    const family = (head, h, fam, kids) => {
      const sp = r() < 0.8 ? P0({ name: nameFor(fam, sexOf(head) === 'f' ? 'm' : 'f'), age: Math.max(18, head.age - 4 + Math.floor(r() * 8)) }, h) : null;
      if (sp) { head.spouse = sp.id; sp.spouse = head.id; sp.hh = head.id; }
      for (let k = 0; k < kids; k++) { const c = P0({ name: nameFor(fam), age: 2 + Math.floor(r() * 12), purse: 0 }, h); c.kid = true; c.parents = [head.id].concat(sp ? [sp.id] : []); c.hh = head.id; }
      return sp;
    };
    for (const b of GH.biz) {
      const fam = b.boss.split(' ').slice(-1)[0];
      const own = P0({ name: b.boss, age: 36 + Math.floor(r() * 22), purse: b.id === 'g_estate' ? 600 : 90 + Math.floor(r() * 70), job: { type: 'biz', biz: b.id, role: 'owner' }, home: 'biz:' + b.id });
      used.add(own.name);
      s.biz[b.id] = { id: b.id, trade: b.trade, owner: own.id, staff: [], profits: [8, 8, 8], closed: false, opened: 0, lastProfit: 0, lastRevenue: 0, town: 'greenhaven' };
      const sp = r() < 0.7 ? P0({ name: nameFor(fam, sexOf(own) === 'f' ? 'm' : 'f'), age: own.age - 3, home: 'biz:' + b.id }) : null;
      if (sp) { own.spouse = sp.id; sp.spouse = own.id; sp.hh = own.id; }
      const nk = Math.floor(r() * 3); for (let k = 0; k < nk; k++) { const c = P0({ name: nameFor(fam), age: 3 + Math.floor(r() * 11), purse: 0, home: 'biz:' + b.id }); c.kid = true; c.parents = [own.id].concat(sp ? [sp.id] : []); c.hh = own.id; }
      const nh = b.id === 'g_estate' ? 3 : b.id === 'g_mill' ? 2 : Math.floor(r() * 2);
      for (let k = 0; k < nh; k++) {
        const hf = FAMILY[Math.floor(r() * FAMILY.length)], h = nextHouse();
        const hand = P0({ name: nameFor(hf), age: 18 + Math.floor(r() * 25), job: { type: 'biz', biz: b.id, role: 'hand' } }, h);
        s.biz[b.id].staff.push({ pid: hand.id, wage: 6 + Math.floor(r() * 3) });
        if (r() < 0.5) family(hand, h, hf, Math.floor(r() * 3));
      }
    }
    const jobs = Object.keys(GH_JOBS);
    while (Object.values(s.people).filter(p => p.town === 'greenhaven').length < 78) {
      const fam = FAMILY[Math.floor(r() * FAMILY.length)], h = nextHouse();
      const head = P0({ name: nameFor(fam), age: 20 + Math.floor(r() * 40), job: r() < 0.9 ? { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] } : null }, h);
      const sp = family(head, h, fam, Math.floor(r() * 4));
      if (sp && r() < 0.5) sp.job = { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] };
    }
    // half the cottages belong to the Ashcombes of the Hall, the rest to the town
    const lady = s.people[s.biz.g_estate.owner];
    gh.forEach(h => { if (r() < 0.5 && !h.tenants.includes(lady.id)) h.owner = lady.id; });
    for (const p of Object.values(s.people)) if (p.town === 'greenhaven') p.rep = Math.round(repTarget(s, p));
    const masters = Object.values(s.people).filter(p => p.town === 'greenhaven' && p.job && p.job.role === 'owner').sort((a, b) => b.rep - a.rep || b.purse - a.purse);
    const reeve = masters.find(p => p.job.biz !== 'g_estate');   // the reeve is one of the townsfolk; the Hall sits on the council
    s.towns.greenhaven = { title: 'Reeve', chest: 80, fee: 'normal', approval: 62, council: masters.filter(p => p !== reeve).slice(0, 3).map(p => p.id), mayor: reeve.id, nextVote: s.day + 7, log: [], lastVote: null };
    plog(s, reeve, 'Chosen as Reeve of Greenhaven by the moot.');
  }
  const UPKEEP = { oakbridge: 135, greenhaven: 34 };
  const FEES = { low: { name: 'Low market fee (2c)', coin: 2 }, normal: { name: 'Market fee (3c)', coin: 3 }, high: { name: 'High market fee (5c)', coin: 5 } };
  function oakFolk(s) { return living(s).filter(p => p.town === 'oakbridge'); }
  function townFolk(s, id) { return living(s).filter(p => p.town === id); }
  const titleOf = T => T.title || 'Mayor';
  // each morning the mayor collects the market fee, pays for the watch and the bridge, and decides
  function townMorning(s) { for (const id in (s.towns || {})) townMorning1(s, id, s.towns[id]); }
  function townMorning1(s, id, T) {
    T.id = id;
    const fee = FEES[T.fee].coin;
    for (const b of Object.values(s.biz)) if (b.town === id && !b.closed) { const o = b.owner === 'player' ? null : s.people[b.owner]; if (o) { o.purse -= fee; T.chest += fee; } else if (b.owner === 'player') { spend(s, fee); T.chest += fee; } }
    const up = UPKEEP[id] || 40; T.chest -= up;   // the watch, the bridge, the walls, the streets
    // the mayor feeds the hungry from the town chest, more or less generously
    const m0 = s.people[T.mayor];
    if (m0 && T.chest > 60) {
      const folk0 = townFolk(s, id), hungryKids = new Set(folk0.filter(p => p.kid && p.hungry).flatMap(p => p.parents || []));
      const needy = folk0.filter(p => (p.hungry || p.purse < 3 || hungryKids.has(p.id)) && !p.kid).sort((a, b) => (hungryKids.has(b.id) ? 1 : 0) - (hungryKids.has(a.id) ? 1 : 0)).slice(0, (thriftOf(m0) < 0.5 ? 45 : 30) * (id === 'oakbridge' ? 1 : 0.4));
      const gift = hungryKids.size > 6 && T.chest > 150 ? 3 : 2; needy.forEach(p => { p.purse += gift; T.chest -= gift; });
      if (needy.length) T.approval = clamp(T.approval + Math.min(2, needy.length / 15), 0, 100);
      T.dole = needy.length * gift;
    } else T.dole = 0;
    if (T.chest < 0) T.chest -= Math.max(1, Math.ceil(-T.chest * INTEREST));
    const m = s.people[T.mayor];
    if (m && s.day % 4 === 0) {
      const k = id === 'oakbridge' ? 1 : 0.35, want = T.chest < 0 ? 'high' : T.chest > 220 * k ? 'low' : T.chest < 60 * k ? 'high' : 'normal';
      if (want !== T.fee) { T.fee = want; T.approval = clamp(T.approval + (want === 'high' ? -6 : want === 'low' ? 4 : 1), 0, 100); townLog(s, T, titleOf(T) + ' ' + m.name + ' sets ' + FEES[want].name.toLowerCase() + (T.chest < 0 ? ', to pay down the town’s debts.' : '.')); }
    }
    if (s.day >= T.nextVote) { T.nextVote = s.day + 7; townVote(s, T); }
  }
  function townLog(s, T, text) { T.log.unshift({ day: s.day, text }); if (T.log.length > 20) T.log.length = 20; event(s, (TOWNS[T.id || 'oakbridge'] || TOWNS.oakbridge).name + ': ' + text, 'info'); }
  function townEvening(s) { for (const id in (s.towns || {})) townEvening1(s, id, s.towns[id]); }
  function townEvening1(s, id, T) {
    T.id = id;
    // a hungry household sends someone out to find day work: on the quay, in the fields, wherever there is some
    const jobsHere = Object.keys(id === 'greenhaven' ? GH_JOBS : OAK_JOBS);
    const famHungry = new Set(townFolk(s, id).filter(p => p.kid && p.hungry).flatMap(p => p.parents || []));
    for (const p of townFolk(s, id)) {
      if (p.kid || p.job || p.retired || p.age < 16 || p.age > 62 || !(p.hungry || famHungry.has(p.id) || p.purse < 4) || rand(s) > 0.35) continue;
      const what = jobsHere[Math.floor(rand(s) * jobsHere.length)];
      p.job = { type: 'commons', what }; plog(s, p, 'Took work as ' + (OAK_JOBS[what] || GH_JOBS[what])[0].toLowerCase() + ' to keep the family fed.');
    }
    const m = s.people[T.mayor]; if (m && m.job && m.job.type !== 'office') { m.purse += 6; }
    const folk = townFolk(s, id), hungry = folk.filter(p => p.hungry).length, homeless = folk.filter(p => !p.home && !p.kid).length;
    const pen = d => d < 0 ? Math.min(4, 1 + -d / 80) : 0;
    T.approval += (58 - T.approval) * 0.08 - pen(T.chest * (id === 'oakbridge' ? 1 : 2.5)) - pen(m ? m.purse : 0) - Math.min(3, hungry * 0.1 + homeless * 0.2) - (T.fee === 'high' ? 0.6 : 0);
    T.approval = Math.round(clamp(T.approval, 0, 100) * 10) / 10;
  }
  function townVote(s, T) {
    const id = T.id || 'oakbridge', TN = TOWNS[id].name, TT = titleOf(T);
    const m = s.people[T.mayor];
    T.council = T.council.filter(id => s.people[id] && s.people[id].status === 'here' && (s.people[id].rep || 0) >= 30);
    if (!m || m.status !== 'here' || T.approval < 45) {
      let yes = 0, no = 0;
      if (m && m.status === 'here') for (const p of townFolk(s, id)) { if (p.kid || p.age < 16 || p.id === m.id) continue; if (T.approval + (p.mood - 50) * 0.25 + (rand(s) - 0.5) * 24 >= 45) yes++; else no++; }
      if (m && m.status === 'here' && yes >= no) { T.approval += 6; T.lastVote = { day: s.day, text: TT + ' ' + m.name + ' survives a vote, ' + yes + ' to ' + no + '.' }; townLog(s, T, T.lastVote.text); return; }
      const cands = T.council.map(id => s.people[id]).filter(p => p && p.status === 'here').concat(Object.values(s.people).filter(p => p.town === id && p.status === 'here' && p.job && p.job.role === 'owner' && !T.council.includes(p.id) && p !== m)).sort((a, b) => (b.rep || 0) - (a.rep || 0)).slice(0, 4);
      if (!cands.length) return;
      const tally = new Map(cands.map(c => [c.id, 0]));
      for (const p of townFolk(s, id)) { if (p.kid || p.age < 16) continue; let best = null, bs = -1e9; for (const c of cands) { const sc = (c.rep || 0) + (rand(s) - 0.5) * 16; if (sc > bs) { bs = sc; best = c.id; } } tally.set(best, tally.get(best) + 1); }
      const win = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0], w = s.people[win];
      if (m) { m.rep = Math.max(0, (m.rep || 0) - 20); plog(s, m, 'Voted out as ' + TT + ' of ' + TN + '.'); }
      T.mayor = win; T.approval = 60; T.council = T.council.filter(id => id !== win);
      plog(s, w, 'Elected ' + TT + ' of ' + TN + '.');
      T.lastVote = { day: s.day, text: (m ? 'The town votes ' + TT + ' ' + m.name + ' out. ' : '') + w.name + ' (' + tradeName(s.biz[w.job.biz] ? s.biz[w.job.biz].trade : '').toLowerCase() + ') is the new ' + TT + ' of ' + TN + '.' };
      townLog(s, T, T.lastVote.text);
    } else T.lastVote = { day: s.day, text: 'No one calls for a vote against ' + TT + ' ' + m.name + '.' };
  }
  // only the town you are in has people walking about; the others keep living on paper
  function townAt(x, z) { for (const id in TOWNS) { const T = TOWNS[id]; if (Math.hypot(x - T.x, z - T.z) < T.r + 160) return id; } return null; }
  function syncBodies(s) {
    const here = townAt(s.player.x, s.player.z);
    if (!here || here === s.bodiesIn) return;
    s.bodiesIn = here;
    s.agents = s.agents.filter(a => a.kind !== 'person' || townOf(s.people[a.pid]) === here);
    for (const p of living(s)) if (townOf(p) === here && !(p.job && ['lord', 'steward', 'taxman'].includes(p.job.office))) { if (!bodyOf(s, p)) { addBody(s, p); const a = bodyOf(s, p); if (a && a.job) a.spot = jobSpot(s, a.job); } }
    s.schedule = s.schedule.filter(e => !e.id || s.agents.some(a => a.id === e.id));
  }

  /* buying, renting and firing */
  function bizPrice(s, id) { const b = s.biz[id]; return Math.round((b.closed ? 100 : 150 + 25 * Math.max(0, avg(b.profits))) * (b.trade === 'estate' ? 3 : b.trade === 'mill' && b.town === 'greenhaven' ? 1.5 : 1)); }
  function housePrice(s, h) { return 40 + h.rent * 45; }
  function sellerWilling(s, ownerPid) { const o = s.people[ownerPid]; return !o || o.opinion > -40; }

  /* offices change hands */
  function appoint(s, office, holder) {
    const prev = s.offices[office], O = OFFICES[office];
    if (prev && prev !== 'player' && s.people[prev]) {
      const p = s.people[prev];
      loseJob(s, p, 'No longer ' + O.title + '.');
      if (O.home === 'manor' && p.home === 'manor') { p.home = null; plog(s, p, 'Had to leave the manor.'); if (!bodyOf(s, p)) addBody(s, p, P.gate); }
      p.opinion = clamp(p.opinion - (holder === 'player' ? 60 : 0), -100, 100);
      if (p.age >= 65) p.retired = true;
    }
    s.offices[office] = holder;
    if (holder && holder !== 'player') { const p = s.people[holder]; if (p.job) loseJob(s, p, 'Left their work to become ' + O.title + '.'); p.job = { type: 'office', office }; if (O.home === 'manor') { moveOut(s, p, 'Moved into the manor.'); p.home = 'manor'; } }
    if (holder === 'player') s.rec.offices = (s.rec.offices || 0) + 1;
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
        if (PLOTS[plot].grant && !s.village.landGranted) return fail('This is council land. Only the council can grant it.');
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
        let wp = ap.pid && s.people ? s.people[ap.pid] : null;
        if (!wp && s.people) { wp = newPerson(s, { name: ap.name, age: 20 + Math.floor(rand(s) * 20), purse: 10, skill: (ap.skill - 0.7) / 0.6 }); wp.log.push({ day: s.day, text: 'Came to Hearthmoor for work.' }); const h = vacancy(s, 4); if (h) moveIn(s, wp, h); }
        const home = (wp && homePoint(s, wp)) || { x: P.well.x - 1.5, z: P.well.z + 2.2 };
        shop.worker = { pid: wp ? wp.id : null, name: ap.name, skill: ap.skill, ask: ap.ask, wage, mood: 60, x: P.road.x - 6, z: P.plaza.z, face: 0, home, task: null, why: 'Just hired', warned: false, carry: null, sup: null, hiredDay: s.day };
        s.applicants.splice(b, 1); s.rec.workersHired++;
        if (wp) {
          wp.job = { type: 'shop', shop: shop.id }; plog(s, wp, 'Hired by ' + s.name + ' at ' + wage + 'c a day.'); wp.opinion = clamp(wp.opinion + 15, -100, 100);
          const ag = bodyOf(s, wp); if (ag) { shop.worker.x = ag.x; shop.worker.z = ag.z; s.agents = s.agents.filter(x => x !== ag); }
          if (ap.local) shop.worker.local = true;
          if (!wp.home) event(s, wp.name + ' has no home to go to at night. Without a roof, their mood will suffer.', 'bad');
        }
        if (s.village.jobless.includes(ap.name)) s.village.jobsGiven = (s.village.jobsGiven || 0) + 1;
        s.village.jobless = s.village.jobless.filter(n => n !== ap.name);
        event(s, ap.name + ' will work at your ' + TRADES[shop.trade].name.toLowerCase() + ' for ' + wage + 'c a day, paid at closing (21:00).', 'good');
        return ok();
      }
      case 'setWage': if (shop && shop.worker) shop.worker.wage = clamp(Math.round(b), 1, 40); return ok();
      case 'fire': {
        if (!shop || !shop.worker) return fail('No worker to let go.');
        const w = shop.worker; shop.worker = null; s.rec.workersLetGo++; s.rec.staffFired++; approveHolder(s, 'player', -3);
        if (w.pid && s.people && s.people[w.pid]) { const wp = s.people[w.pid]; wp.job = null; wp.opinion = clamp(wp.opinion - 30, -100, 100); wp.mood = clamp(wp.mood - 20, 0, 100); plog(s, wp, 'Let go by ' + s.name + '.'); addBody(s, wp, { x: w.x, z: w.z }); }
        event(s, 'You let ' + w.name + ' go.' + (w.pid ? ' They will need to find other work to keep up with their rent.' : ''), 'info');
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
      case 'talk': if (atLoc(s, 'hall')) { doTalk(s); return ok(); } walkTo(s, P.hall, { type: 'talk' }); return ok();
      case 'donate': if (atLoc(s, 'granary')) { donateGrain(s); return ok(); } walkTo(s, P.granary, { type: 'donate' }); return ok();
      case 'fundTower': if (atLoc(s, 'tower')) { fundTower(s); return ok(); } walkTo(s, P.tower, { type: 'fundTower' }); return ok();
      case 'gate': if (atLoc(s, 'manor')) { gateTalk(s); return ok(); } walkTo(s, P.gate, { type: 'gate' }); return ok();
      case 'project': {
        const v = s.village, pr = PROJECTS[a];
        const elder = s.offices && s.offices.elder === 'player';
        if (!v.council && !elder) return fail('Only the council can spend the village chest.');
        if (!atLoc(s, 'hall')) return fail('Council business is done at the Village Hall.');
        if (!pr || v.projects[a]) return fail('That project is already done.');
        if (elder ? v.chest - pr.cost < CHEST_FLOOR : v.chest < pr.cost) return fail(elder ? 'Even borrowing, the chest cannot go below ' + CHEST_FLOOR + 'c.' : 'The chest holds ' + v.chest + 'c; this needs ' + pr.cost + 'c. You can add your own coin, or the Elder can borrow.');
        v.chest -= pr.cost; v.projects[a] = s.day; s.rec.projectsFunded++;
        approveHolder(s, 'player', 6);
        if (v.chest < 0) govLog(s, s.name + ' borrows to pay for ' + pr.name.toLowerCase() + '. The village chest is ' + (-v.chest) + 'c in debt.', 'bad');
        if (a === 'granary' && v.shortage) { v.shortage = false; }
        addStanding(s, 10, pr.name.toLowerCase() + ' is done.');
        return ok();
      }
      case 'giveChest': {
        const v = s.village, n = Math.min(s.coins, a | 0);
        if (!v.council && !(s.offices && s.offices.elder === 'player')) return fail('You do not hold a key to the chest.');
        if (n <= 0) return fail('You have no coin to give.');
        spend(s, n); v.chest += n; s.stats.given += n; s.rec.chestGiven += n;
        if (n >= 10) addStanding(s, Math.floor(n / 10), 'you put your own coin into the village chest.');
        return ok('You add ' + n + 'c to the chest.');
      }
      case 'toll': {
        if (!s.village.council) return fail('Only the council sets the toll.');
        if (!TOLLS[a]) return fail('Unknown toll');
        s.village.toll = a; if (s.gov) s.gov.tollSetDay = s.day;
        event(s, 'The council sets the travelers\u2019 toll: ' + TOLLS[a].name + '. It takes effect tomorrow.', 'info');
        return ok();
      }
      case 'settle': {
        const v = s.village;
        if (v.dispute == null) return fail('There is no quarrel before the council.');
        if (!atLoc(s, 'hall')) return fail('Disputes are heard at the Village Hall.');
        const d = DISPUTES[v.dispute], o = d.opts[a];
        if (!o) return fail('Pick a ruling.');
        if (o.chest && v.chest + o.chest < (s.offices && s.offices.elder === 'player' ? CHEST_FLOOR : 0)) return fail('The chest cannot cover that.');
        v.chest += o.chest || 0; v.chestDaily += o.chestDaily || 0;
        for (const n in o.favor) v.favor[n] = clamp((v.favor[n] || 0) + o.favor[n], -2, 2);
        v.dispute = null; v.disputeDay = s.day + 3; s.rec.disputesSettled++;
        addStanding(s, o.standing, 'the council rules: ' + o.label.toLowerCase() + '.');
        return ok();
      }
      case 'relief': {
        if (!s.gov || s.offices.elder !== 'player') return fail('Only the Elder decides on help for the poor.');
        if (!['none', 'some', 'all'].includes(a)) return fail('Unknown level');
        s.gov.relief = a; return ok();
      }
      case 'deliver': {
        const v = s.village, c0 = v.contract;
        if (!c0) return fail('There is no order to fill.');
        if (!atLoc(s, 'market')) return fail('Orders are handed over at the Trading Post.');
        const shops = s.shops.filter(x => x.trade === c0.trade), have = shops.reduce((t, x) => t + x.goods, 0);
        if (have < c0.qty) return fail('Your shops hold ' + have + ' of the ' + goodsName(c0.trade, c0.qty) + ' needed.');
        let need = c0.qty;
        for (const x of shops) { const n = Math.min(x.goods, need); x.goods -= n; need -= n; }
        earn(s, c0.reward); s.stats.contract += c0.reward; s.rec.contractsDone++;
        v.contract = null; addStanding(s, 2, 'Hearthmoor goods are known on the road.');
        event(s, 'Order delivered: ' + c0.reward + 'c from ' + c0.who.toLowerCase() + '.', 'coin');
        return ok();
      }
      case 'buyCottage': {
        const v = s.village;
        if (v.cottage !== 'forsale') return fail('The cottage is already yours.');
        if (s.coins < 90) return fail('The cottage costs 90c.');
        spend(s, 90); s.stats.property += 90; s.rec.invested += 90; v.cottage = 'owned'; s.rec.housesOwned++;
        event(s, 'You buy Old Ama\u2019s cottage. The roof leaks and the door hangs loose: repair it (30c and 12 wood) to find a tenant.', 'story');
        return ok();
      }
      case 'repairCottage': {
        const v = s.village;
        if (v.cottage !== 'owned') return fail('Nothing to repair.');
        if (!canPay(s, { coin: 30, wood: 12 })) return fail('Repairs need 30c and 12 wood.');
        payCost(s, { coin: 30, wood: 12 }); v.cottage = 'repaired';
        event(s, 'The cottage is mended. A tenant will move in tomorrow.', 'good');
        return ok();
      }
      case 'sellShop': {
        if (!shop) return fail('No such shop.');
        const refund = Math.floor(TRADES[shop.trade].tiers.slice(0, shop.tier + 1).reduce((t, x) => t + (x.cost.coin || 0), 0) / 2);
        if (shop.worker) { s.rec.workersLetGo++; const w = shop.worker; if (w.pid && s.people && s.people[w.pid]) { const wp = s.people[w.pid]; wp.job = null; plog(s, wp, 'Lost their job when ' + s.name + ' sold the shop.'); addBody(s, wp, { x: w.x, z: w.z }); } }
        shop.queue.slice().forEach(id => { const ag = agentById(s, id); if (ag) leaveShop(s, ag, null, null); });
        s.shops = s.shops.filter(x => x !== shop);
        s.schedule = s.schedule.filter(e => e.shop !== shop.id);
        earn(s, refund); s.rec.shopsSold++;
        if (p.action && p.action.shop === shop.id) p.action = null;
        event(s, 'You sold your ' + TRADES[shop.trade].name.toLowerCase() + ' for ' + refund + 'c. The ' + PLOTS[shop.plot].name + ' is free again.', 'info');
        return ok();
      }
      case 'buyBiz': {
        const bz = s.biz && s.biz[a];
        if (!bz) return fail('No such business.');
        if (bz.owner === 'player') return fail('You already own it.');
        const owner = s.people[bz.owner];
        if (!sellerWilling(s, bz.owner)) return fail(owner.name + ' will not sell to you.');
        const price = bizPrice(s, a);
        if (s.coins < price) return fail(empById(a).name + ' costs ' + price + 'c.');
        spend(s, price); s.rec.invested += price; owner.purse += price; s.rec.bizBought++;
        bz.owner = 'player';
        if (!owner.job || owner.job.biz === a) { owner.job = { type: 'biz', biz: a, role: 'hand' }; bz.staff.unshift({ pid: owner.id, wage: 8 }); }
        plog(s, owner, 'Sold ' + empById(a).name + ' to ' + s.name + ' for ' + price + 'c, and stayed on as manager at 8c a day.');
        if (owner.home === 'biz:' + a) { owner.home = null; const h = vacancy(s, 99, bz.town); if (h) moveIn(s, owner, h); else plog(s, owner, 'Has nowhere to live now the rooms above the shop are yours.'); }
        if (bz.closed) { bz.closed = false; bz.profits = [0, 0, 0]; }
        if (s.job && s.job.emp === a) { s.job = null; event(s, 'You own the place now, so you no longer work shifts there.', 'info'); }
        bz.staff.forEach(st => { const w = s.people[st.pid]; if (w !== owner) plog(s, w, 'Now works for ' + s.name + ', who bought ' + empById(a).name + '.'); });
        event(s, 'You bought ' + empById(a).name + ' for ' + price + 'c. Its staff now work for you, and its profits are yours.', 'story');
        return ok();
      }
      case 'fireStaff': {
        const bz = s.biz && s.biz[a]; if (!bz || bz.owner !== 'player') return fail('That is not your business.');
        const w = s.people[b]; if (!w) return fail('No such person.');
        loseJob(s, w, 'Let go by ' + s.name + ' from ' + empById(a).name + '.');
        w.opinion = clamp(w.opinion - 30, -100, 100); s.rec.staffFired++; approveHolder(s, 'player', -3);
        event(s, 'You let ' + w.name + ' go from ' + empById(a).name + '.', 'info');
        return ok();
      }
      case 'hireStaff': {
        const bz = s.biz && s.biz[a]; if (!bz || bz.owner !== 'player') return fail('That is not your business.');
        const w = s.people[b]; if (!w || w.job) return fail('They are not looking for work.');
        if (bz.staff.length >= 3) return fail('Three staff is all the shop can use.');
        bz.staff.push({ pid: w.id, wage: clamp(c || 7, 1, 40) }); w.job = { type: 'biz', biz: a, role: 'hand' };
        plog(s, w, 'Hired by ' + s.name + ' at ' + empById(a).name + '.'); w.opinion = clamp(w.opinion + 15, -100, 100); s.rec.workersHired++;
        if (s.village.jobless.includes(w.name)) s.village.jobsGiven = (s.village.jobsGiven || 0) + 1;
        s.village.jobless = s.village.jobless.filter(n => n !== w.name);
        return ok();
      }
      case 'setStaffWage': {
        const bz = s.biz && s.biz[a]; if (!bz || bz.owner !== 'player') return fail('That is not your business.');
        const st = bz.staff.find(x => x.pid === b); if (st) st.wage = clamp(Math.round(c), 1, 40);
        return ok();
      }
      case 'buyHouse': {
        const h = s.houses && houseById(s, a);
        if (!h) return fail('No such house.');
        if (h.owner === 'player') return fail('It is already yours.');
        if (h.owner && h.owner !== 'office:lord' && h.tenants.includes(h.owner)) return fail(s.people[h.owner].name + ' lives there and will not sell their home.');
        if (h.owner && h.owner !== 'office:lord' && !sellerWilling(s, h.owner)) return fail('The owner will not sell to you.');
        const price = housePrice(s, h);
        if (s.coins < price) return fail(h.name + ' costs ' + price + 'c.');
        spend(s, price); s.rec.invested += price; s.rec.housesOwned++;
        const seller = h.owner === 'office:lord' ? s.offices.lord : h.owner;
        if (seller && seller !== 'player' && s.people[seller]) s.people[seller].purse += price;
        h.owner = 'player';
        h.tenants.forEach(id => plog(s, s.people[id], 'Now rents from ' + s.name + ', who bought ' + h.name + '.'));
        event(s, 'You bought ' + h.name + ' for ' + price + 'c. ' + (h.tenants.length ? 'Its tenant now pays rent to you.' : 'It stands empty; someone may move in.'), 'story');
        return ok();
      }
      case 'setRent': {
        const h = s.houses && houseById(s, a); if (!h || h.owner !== 'player') return fail('That is not your house.');
        const n = clamp(Math.round(b), 0, 20);
        if (n > h.rent) { s.rec.rentRaises++; approveHolder(s, 'player', -2 * (n - h.rent)); h.tenants.forEach(id => { const t = s.people[id]; t.opinion = clamp(t.opinion - 10 * (n - h.rent), -100, 100); plog(s, t, 'Rent raised to ' + n + 'c a day by ' + s.name + '.'); }); }
        if (n < h.rent) h.tenants.forEach(id => { const t = s.people[id]; t.opinion = clamp(t.opinion + 5, -100, 100); plog(s, t, 'Rent lowered to ' + n + 'c a day.'); });
        h.rent = n; return ok();
      }
      case 'evict': {
        const h = s.houses && houseById(s, a); if (!h || h.owner !== 'player') return fail('That is not your house.');
        const t = s.people[b]; if (!t || !h.tenants.includes(b)) return fail('They do not live there.');
        moveOut(s, t, 'Evicted from ' + h.name + ' by ' + s.name + '.'); t.opinion = clamp(t.opinion - 50, -100, 100); s.rec.evictions++;
        addStanding(s, -5, 'the village talks about the eviction.'); approveHolder(s, 'player', -4);
        return ok();
      }
      case 'shiftTip': {
        // a job well done at work: a small tip from the boss, a better opinion, a little more skill
        if (!s.job || !inShift(s) || !playerAtWork(s)) return fail('You need to be at work during your shift.');
        const j = s.job, e = empById(j.emp), n = clamp(a | 0, 0, 3);
        const room = Math.max(0, 8 - (j.tips || 0)), pay = Math.min(room, n);
        if (pay > 0) { earn(s, pay); j.tips = (j.tips || 0) + pay; s.stats.jobPay += pay; s.rec.tipsEarned = (s.rec.tipsEarned || 0) + pay; }
        s.trades[e.trade] = Math.round((s.trades[e.trade] + 0.05) * 100) / 100;
        const boss = s.people && s.biz[j.emp] && s.people[s.biz[j.emp].owner];
        if (boss) boss.opinion = clamp(boss.opinion + 1, -100, 100);
        return ok(pay ? null : 'No more tips this shift, but ' + e.boss + ' noticed the good work.');
      }
      case 'workRest': {
        // work through to the end of the shift without standing there in real time
        if (!s.job || !inShift(s) || !playerAtWork(s)) return fail('You need to be at work during your shift.');
        const end = empById(s.job.emp).shift[1] * 60, now = minuteOfDay(s.t), mins = end - now;
        if (mins <= 0) return fail('Your shift is over.');
        advance(s, mins + 0.5);
        return ok();
      }
      case 'stop': p.action = null; p.dest = null; return ok();
      case 'coach': {
        // a seat on the coach from this stage post to another town; coaches run from six in the morning till seven at night
        const from = Object.keys(STAGE).find(id => atLoc(s, 'stage:' + id));
        if (!from) return fail('Coaches leave from the stage post.');
        if (!STAGE[a] || a === from) return fail('No coach goes there.');
        const h = hourOf(s); if (h < 6 || h >= 19) return fail('The last coach has gone. The first leaves at six in the morning.');
        const f = fare(from, a); if (s.coins < f) return fail('The fare is ' + f + 'c.');
        spend(s, f); s.rec.fares = (s.rec.fares || 0) + f;
        const mins = travelTo(s, a, 'coach'); p.riding = false;
        event(s, 'You take the coach to ' + TOWNS[a].name + ' for ' + f + 'c. The journey takes ' + mins + ' minutes.', 'info');
        return { ok: true, mins };
      }
      case 'journey': {
        // walk or ride the roads to another town
        if (!TOWNS[a] || !TOWNS[a].open) return fail('That road is not open yet.');
        const how = p.riding && p.horse ? 'ride' : 'walk', mins = travelTo(s, a, how);
        return { ok: true, mins, how };
      }
      case 'buyHorse': {
        if (!Object.keys(STAGE).some(id => atLoc(s, 'stage:' + id))) return fail('Horses are sold at the stage posts.');
        if (p.horse) return fail('You already have a horse.');
        if (s.coins < HORSE_PRICE) return fail('A good horse costs ' + HORSE_PRICE + 'c.');
        spend(s, HORSE_PRICE); s.rec.invested += HORSE_PRICE;
        p.horse = { name: a || 'Bramble', since: s.day }; p.riding = true;
        event(s, 'You buy ' + p.horse.name + ', a bay mare, for ' + HORSE_PRICE + 'c. Stabling costs ' + STABLING + 'c a night.', 'story');
        return ok();
      }
      case 'sellHorse': {
        if (!p.horse) return fail('You have no horse.');
        if (!Object.keys(STAGE).some(id => atLoc(s, 'stage:' + id))) return fail('Sell your horse at a stage post.');
        earn(s, HORSE_SELL); event(s, 'You sell ' + p.horse.name + ' to the ostler for ' + HORSE_SELL + 'c.', 'info'); p.horse = null; p.riding = false;
        return ok();
      }
      case 'ride': if (!p.horse) return fail('You have no horse.'); p.riding = !p.riding; return ok();
      case 'hireManager': {
        // a: 'shop' or 'biz', b: its id, c: the person
        const o = a === 'shop' ? shopById(s, b) : s.biz[b];
        if (!o || (a === 'biz' && o.owner !== 'player')) return fail('That is not your business.');
        if (o.manager) return fail('It already has a manager.');
        const cand = managerCandidates(s, a, b).find(x => x.pid === c); if (!cand) return fail('They cannot take the post.');
        const q = s.people[c];
        if (q.job && q.job.type === 'biz') { const ob = s.biz[q.job.biz]; if (ob) ob.staff = ob.staff.filter(x => x.pid !== q.id); }
        q.job = { type: 'manage', kind: a, ref: b }; q.opinion = clamp((q.opinion || 0) + 15, -100, 100);
        o.manager = { pid: q.id, name: q.name, skill: cand.skill, wage: cand.ask, budget: 10, staffTarget: a === 'biz' ? Math.max(1, o.staff.length) : 0, since: s.day };
        plog(s, q, 'Became manager of ' + managedName(s, a, b) + ' for ' + s.name + ' at ' + cand.ask + 'c a day.');
        event(s, q.name + ' will manage ' + managedName(s, a, b) + ' for ' + cand.ask + 'c a day, with a budget of 10c a day for wages, supplies and repairs.', 'good');
        return ok();
      }
      case 'fireManager': {
        const o = a === 'shop' ? shopById(s, b) : s.biz[b]; if (!o || !o.manager) return fail('No manager there.');
        releaseManager(s, o.manager, 'Let go as manager by ' + s.name + '.'); const q = s.people[o.manager.pid]; if (q) q.opinion = clamp((q.opinion || 0) - 15, -100, 100);
        o.manager = null; return ok();
      }
      case 'managerBudget': { const o = a === 'shop' ? shopById(s, b) : s.biz[b]; if (!o || !o.manager) return fail('No manager there.'); o.manager.budget = clamp(Math.round(c), 0, 60); return ok(); }
      case 'repairBiz': { const o = s.biz[a]; if (!o || o.owner !== 'player' || !o.disrepair) return fail('Nothing needs mending.'); const c0 = o.repairCost || 30; if (s.coins < c0) return fail('Mending it costs ' + c0 + 'c.'); spend(s, c0); o.disrepair = false; s.decisions = (s.decisions || []).filter(d => d.biz !== a); report(s, empById(a).name + ': mended for ' + c0 + 'c.'); return ok(); }
      case 'staffTarget': { const o = s.biz[a]; if (!o || !o.manager) return fail('No manager there.'); o.manager.staffTarget = clamp(Math.round(b), 0, 4); return ok(); }
      case 'decide': {
        const i = (s.decisions || []).findIndex(d => d.id === a); if (i < 0) return fail('That has been settled.');
        const d = s.decisions[i], o = s.biz[d.biz];
        if (b === 'pay') { if (s.coins < d.cost) return fail('Mending it costs ' + d.cost + 'c.'); spend(s, d.cost); if (o) o.disrepair = false; report(s, empById(d.biz).name + ': mended for ' + d.cost + 'c, on your word.'); }
        else report(s, empById(d.biz).name + ': left unmended for now. Takings stay down until it is fixed.');
        s.decisions.splice(i, 1); return ok();
      }
    }
    return fail('Unknown command');
  }

  /* ---------- stepping ---------- */
  function crossed(a, b, mark) { return Math.floor((b - mark) / DAY) > Math.floor((a - mark) / DAY); }
  // daylight (06:00-21:00) lasts about 18 real minutes at normal pace; nights pass in about 12 seconds
  const DAY_RATE = 900 / 1080;
  // the night only rushes by once everyone has walked home (or by 22:30 at the latest), so nobody races through the dark
  function settled(s) {
    for (const a of s.agents) if (a.kind === 'person' && !a.indoors && a.moving) return false;
    for (const sh of s.shops) if (sh.worker && !sh.worker.indoors && sh.worker.moving) return false;
    return true;
  }
  function rate(s) { const h = hourOf(s); if (h < 6) return 45; if (h < 21) return DAY_RATE; return h >= 22.5 || settled(s) ? 45 : DAY_RATE; }
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
    if (s.towns) syncBodies(s);
    separate(s);
    checkVillage(s);
    if (s.people && s.village.step === 8) elderSuccession(s);
    if (s.coins > s.rec.peakCoins) s.rec.peakCoins = s.coins;
    if (s.coins < 0 && -s.coins > (s.rec.maxDebt || 0)) s.rec.maxDebt = -s.coins;
  }
  // people are solid: nobody walks through anybody else, you included
  const BODY_R = 0.3;
  const SEP = { o: [], r: [], w: [], cell: new Map() };
  function separate(s) {
    const O = SEP.o, R = SEP.r, Wt = SEP.w; O.length = 0; R.length = 0; Wt.length = 0;
    for (const a of s.agents) if (!a.gone && !a.indoors) { O.push(a); R.push(a.kid ? 0.22 : BODY_R); Wt.push(1); }
    for (const sh of s.shops) if (sh.worker && !sh.worker.indoors) { O.push(sh.worker); R.push(BODY_R); Wt.push(1); }
    // you have right of way: villagers give you a little more room and step aside, and nobody shoves you back
    const pl = s.player; O.push(pl); R.push(pl.pushing ? 0.5 : BODY_R); Wt.push(pl.pushing ? 0 : 0.35);
    const cell = SEP.cell; cell.clear();
    const K = (x, z) => (Math.floor(x) + 2048) * 4096 + (Math.floor(z) + 2048);
    for (let i = 0; i < O.length; i++) { const k = K(O[i].x, O[i].z), c = cell.get(k); if (c) c.push(i); else cell.set(k, [i]); }
    for (let i = 0; i < O.length; i++) {
      const A = O[i], cx = Math.floor(A.x) + 2048, cz = Math.floor(A.z) + 2048;
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const c = cell.get(gx * 4096 + gz); if (!c) continue;
        for (let n = 0; n < c.length; n++) {
          const j = c[n]; if (j <= i) continue;
          const B = O[j], dx = B.x - A.x, dz = B.z - A.z, m = R[i] + R[j];
          if (dx > m || dx < -m || dz > m || dz < -m) continue;
          const d = Math.sqrt(dx * dx + dz * dz); if (d >= m) continue;
          const nx = d > 1e-6 ? dx / d : Math.cos(i * 2.4 + j), nz = d > 1e-6 ? dz / d : Math.sin(i * 2.4 + j), push = m - d, tw = Wt[i] + Wt[j];
          if (tw === 0) continue;
          if (pl.pushing && (A === pl || B === pl)) {
            // step out of your path to whichever side they are already on, rather than being bulldozed ahead of you
            const other = A === pl ? B : A, sgn = A === pl ? 1 : -1, fx = Math.sin(pl.face || 0), fz = Math.cos(pl.face || 0);
            const ox = nx * sgn, oz = nz * sgn, side = fx * oz - fz * ox >= 0 ? 1 : -1;
            other.x += ox * push * 0.5 - fz * side * push * 0.9; other.z += oz * push * 0.5 + fx * side * push * 0.9;
            continue;
          }
          A.x -= nx * push * Wt[i] / tw; A.z -= nz * push * Wt[i] / tw; B.x += nx * push * Wt[j] / tw; B.z += nz * push * Wt[j] / tw;
          // walkers step aside to their right when someone is in their way, so two people meeting head-on slip past each other
          if (A.moving && A !== s.player) { const fx = Math.sin(A.face || 0), fz = Math.cos(A.face || 0); if (fx * nx + fz * nz > 0.2) { A.x += fz * push * 0.9; A.z -= fx * push * 0.9; } }
          if (B.moving && B !== s.player) { const fx = Math.sin(B.face || 0), fz = Math.cos(B.face || 0); if (-(fx * nx + fz * nz) > 0.2) { B.x += fz * push * 0.9; B.z -= fx * push * 0.9; } }
          // someone already standing on the spot you were heading for: stop close by instead
          // or, if they're part of a crowd gathered at the same place you're going, join the edge of it
          if (A.moving && !B.moving && A.tx != null) { if (Math.hypot(A.x - A.tx, A.z - A.tz) < 1.2) A.settle = true; else if (B.tx != null && Math.hypot(B.tx - A.tx, B.tz - A.tz) < 0.8) A.settle = 2; }
          if (B.moving && !A.moving && B.tx != null) { if (Math.hypot(B.x - B.tx, B.z - B.tz) < 1.2) B.settle = true; else if (A.tx != null && Math.hypot(A.tx - B.tx, A.tz - B.tz) < 0.8) B.settle = 2; }
        }
      }
    }
  }
  function advance(s, minutes) { let left = minutes; while (left > 1e-9) { const d = Math.min(1, left); step(s, d); left -= d; } }

  /* ---------- records ---------- */
  function propertyValue(s) {
    return s.shops.reduce((a, x) => a + TRADES[x.trade].tiers.slice(0, x.tier + 1).reduce((b, t) => b + (t.cost.coin || 0), 0), 0);
  }
  function netWorth(s) { return s.coins + propertyValue(s); }
  function summary(s) {
    return { standing: s.village.standing, council: s.village.council, name: s.name, day: s.day, clock: clock(s.t), coins: s.coins, shops: s.shops.length, job: s.job ? empById(s.job.emp).name : null, netWorth: netWorth(s) };
  }

  /* ---------- saving ---------- */
  function serialize(s) { return JSON.stringify(s); }
  function migrateV1(o) {
    const s = newGame(o.rng, 'Wren');
    s.t = o.t; s.day = o.day; s.coins = o.coins; s.trades.bakery = LEARN_SHIFTS;
    const sh = { id: s.nextShop++, plot: 1, trade: 'bakery', tier: o.tier || 0, price: o.price || 5, stock: { grain: o.bakery.grain || 0, wood: o.bakery.wood || 0, ore: 0 }, goods: o.bakery.bread || 0, work: { loaded: !!o.bakery.oven.loaded, progress: o.bakery.oven.progress || 0, need: o.bakery.oven.need || 0 }, serveProgress: 0, queue: [], worker: null, policy: { supplyRuns: !!(o.policy && o.policy.supplyRuns) }, openedDay: 1 };
    if (o.worker) {
      const w = o.worker;
      sh.worker = { name: w.name, skill: w.skill, ask: w.ask, wage: w.wage, mood: w.mood, x: P.plaza.x, z: P.plaza.z, face: 0, home: { x: HOUSES[3].x, z: HOUSES[3].z }, task: null, why: 'Back at work', warned: !!w.warned, carry: null, sup: null, hiredDay: 1 };
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
  /* a capital-sized stress test: hundreds of extra residents with homes, households and jobs,
     living their real routines alongside the village. Used only by the phone performance test. */
  function cityLoad(s, n) {
    const sites = [];
    for (let z = 50; z <= 84; z += 8.5) for (let x = -86; x <= 86; x += 8) if (Math.abs(x) > 4) sites.push({ x, z });
    for (let x = 60; x <= 92; x += 8.5) for (let z = -62; z <= 40; z += 8.5) if (Math.abs(z - 4) > 5) sites.push({ x, z });
    for (let x = -92; x <= -70; x += 8.5) for (let z = -40; z <= 40; z += 8.5) sites.push({ x, z });
    const jobs = ['field', 'forest', 'pit', 'market', 'well'];
    let made = 0, hi = 0;
    while (made < n && hi < sites.length) {
      const site = sites[hi], h = { id: 'c' + hi, name: 'Row ' + (hi + 1), x: site.x, z: site.z, owner: 'office:lord', rent: 2, cap: 4, tenants: [] }; hi++;
      s.houses.push(h);
      const size = 2 + Math.floor(rand(s) * 4);
      let head = null;
      for (let k = 0; k < size && made < n; k++, made++) {
        const kid = head && k >= 2;
        const p = newPerson(s, { name: 'Resident ' + (made + 1), age: kid ? 4 + Math.floor(rand(s) * 10) : 20 + Math.floor(rand(s) * 40), purse: kid ? 0 : 25 + Math.floor(rand(s) * 20), palette: Math.floor(rand(s) * 10) });
        if (!kid && rand(s) < 0.9) p.job = { type: 'commons', what: jobs[Math.floor(rand(s) * jobs.length)] };
        if (kid) { p.kid = true; p.parents = [head.id]; p.hh = head.hh || head.id; }
        else if (head) p.hh = head.hh || head.id;
        else head = p;
        moveIn(s, p, h); p.log = []; p.rep = 15; p.thrift = 0.5;
        addBody(s, p);
      }
    }
    s.agents.forEach(a => { if (a.job && !a.spot) a.spot = jobSpot(s, a.job); });
    return { people: made, houses: hi };
  }
  // a save from before the rebuild: everyone and everything moves into the new Hearthmoor
  function relocate(s) {
    const old = s.houses || [];
    makeHouses(s);
    old.forEach((h, i) => {
      const nu = s.houses[i];
      if (nu) { nu.owner = h.owner; nu.rent = h.rent; }
      else if (h.owner === 'player') { const n = housePrice(s, h); earn(s, n); event(s, h.name + ' was pulled down when the village was rebuilt. The lord paid you ' + n + 'c for it.', 'coin'); }
    });
    for (const p of Object.values(s.people)) {
      if (p.home && /^h\d+$/.test(p.home)) p.home = null;
      p.owed = 0; p.arrears = 0;
    }
    const here = Object.values(s.people).filter(p => p.status === 'here' && !p.home);
    // owners into their own houses first, then everyone else
    for (const h of s.houses) { const o = s.people[h.owner]; if (o && o.status === 'here' && !o.home) { h.tenants.push(o.id); o.home = h.id; } }
    for (const p of here) if (!p.home) { const h = vacancy(s); if (h) { h.tenants.push(p.id); p.home = h.id; } }
    // the new mill and its people
    if (!s.biz.mill) {
      const t = newPerson(s, { name: 'Tamsin', age: 45, purse: 110, job: { type: 'biz', biz: 'mill', role: 'owner' }, home: 'biz:mill', palette: 7 });
      s.biz.mill = { id: 'mill', trade: 'mill', owner: t.id, staff: [], profits: [8, 8, 8], closed: false, opened: s.day, lastProfit: 0, lastRevenue: 0 };
      t.log = [{ day: s.day, text: 'Built a mill on the new millrace and moved to Hearthmoor.' }]; t.rep = 45;
      const r = newPerson(s, { name: 'Rook', age: 24, purse: 18, job: { type: 'biz', biz: 'mill', role: 'hand' }, palette: 2 });
      s.biz.mill.staff.push({ pid: r.id, wage: 7 }); const h = vacancy(s); if (h) moveIn(s, r, h); r.log = [{ day: s.day, text: 'Came to work at the new mill.' }]; r.rep = 22;
      addBody(s, t); addBody(s, r);
    }
    // nobody is caught halfway down an old road
    s.agents = s.agents.filter(a => a.kind === 'person');
    s.shops.forEach(x => { x.queue = []; });
    s.schedule = [];
    for (const a of s.agents) { const p = s.people[a.pid]; const pt = (p && homePoint(s, p)) || P.center; a.x = pt.x; a.z = pt.z; a.mode = 'routine'; a.icon = null; if (a.job) a.spot = jobSpot(s, a.job); }
    for (const shop of s.shops) if (shop.worker) { const w = shop.worker, wp = w.pid && s.people[w.pid]; w.home = (wp && homePoint(s, wp)) || { x: P.well.x - 1.5, z: P.well.z + 2.2 }; const pt = plotPt(shop, 'serve'); w.x = pt.x; w.z = pt.z; w.task = null; w.carry = null; w.sup = null; }
    const pl = s.player; pl.x = P.home.x; pl.z = P.home.z; pl.dest = null; pl.action = null;
    event(s, 'Hearthmoor has been rebuilt: a stream and a millrace, a mill, the manor on its rise, families in their homes, and room to grow. Everyone you know is still here.', 'story');
  }
  function deserialize(str) {
    let s = JSON.parse(str);
    if (!s || typeof s !== 'object' || typeof s.v !== 'number') throw new Error('Not a Hearthmoor save');
    if (s.v > VERSION) throw new Error('This save is from a newer version');
    if (s.v === 1) s = migrateV1(s);
    if (s.v === 2) {
      s.v = 3; s.village = freshVillage();
      const fr = freshRecords(); for (const k in fr) if (s.rec[k] === undefined) s.rec[k] = fr[k];
      for (const k of ['rent', 'tax', 'contract', 'given', 'property']) if (s.stats[k] === undefined) s.stats[k] = 0;
      event(s, 'Hearthmoor has a Village Hall now, and ' + elderTitle(s) + ' would like a word with you.', 'story');
    }
    if (s.v === 3) {
      s.v = 4;
      const fr = freshRecords(); for (const k in fr) if (s.rec[k] === undefined) s.rec[k] = fr[k];
      s.agents = s.agents.filter(a => a.kind === 'traveler' || a.kind === 'taxman');
      s.shops.forEach(x => x.queue = []);
      setupPeople(s);
      for (const shop of s.shops) if (shop.worker) {
        const w = shop.worker; let wp = Object.values(s.people).find(p => p.name === w.name && !p.job);
        if (wp) { const ag = bodyOf(s, wp); if (ag) s.agents = s.agents.filter(a => a !== ag); }
        else { wp = newPerson(s, { name: w.name, age: 30, purse: 15 }); const h = vacancy(s, 4); if (h) moveIn(s, wp, h); }
        wp.job = { type: 'shop', shop: shop.id }; w.pid = wp.id; w.home = homePoint(s, wp) || { x: P.well.x - 1.5, z: P.well.z + 2.2 };
      }
      if (s.village.step >= 4) s.village.jobless = [];
      if (s.village.step === 3) s.village.jobless = villagers(s).filter(idleAdult).slice(0, 2).map(p => p.name);
      event(s, 'Everyone in Hearthmoor now has a purse, a job and a home of their own. Tap anyone to see their life.', 'story');
    }
    if (s.v === 4) {
      s.v = 5;
      const fr = freshRecords(); for (const k in fr) if (s.rec[k] === undefined) s.rec[k] = fr[k];
      initGov(s);
      event(s, 'The moot now votes on its leaders, and anyone, the lord included, can sink into debt.', 'story');
    }
    if (s.v === 5) { s.v = 6; relocate(s); }
    if (s.v === 6) { s.v = 7; setupOakbridge(s); event(s, 'The gates of Oakbridge are open. The road east leads to a city of 240 people.', 'story'); }
    if (s.v === 7) { s.v = 8; rebuildOakbridge(s); }
    if (s.v === 8) { s.v = 9; setupGreenhaven(s); event(s, 'The north road is open. It leaves the east road at the waystation and climbs to Greenhaven, a farming town of eighty people with a great mill.', 'story'); }
    if (!s.player || !Array.isArray(s.shops) || !Array.isArray(s.agents) || !s.rec) throw new Error('Save is missing data');
    return s;
  }

  const api = {
    REALM, RUMORS, PROJECTS, TOLLS, DISPUTES, STEPS, CHAPTERS, skillPct, OFFICES, NEW_HUTS, MANOR_HOME,
    elderTitle, lordTitle, person, living, occupation, homeText, income, houseById, landlordName, holderName, bizPrice, housePrice, appoint, vacancy,
    VERSION, TRADES, TRADE_KEYS, PLOTS, REL, EMPLOYERS, LOCS, P, HOMES, WORKER_HOMES, BUY, SELL, GATHER, GOALS, CARRY, GOODS, LEARN_SHIFTS, WHY,
    newGame, step, advance, cmd, rate, serialize, deserialize, hourOf, clock, hm, carried, skillLabel, dist,
    tierOf, plotPt, shopLabel, shopById, shopOnPlot, empById, learned, tradeSpeed, inShift, playerAtWork, wtpMean, recipeText, costText, goodsName,
    netWorth, propertyValue, summary, workerHours, canPay,
    managerCandidates, managerOf, STAGE, fare, roadDist, HORSE_PRICE, HORSE_SELL, STABLING, COACH_MPM, WALK_MPM, RIDE_MPM, sexOf, GH, GREEN, GH_JOBS, LAYOUT, townFolk, setupGreenhaven, OAK, OAK_JOBS, FEES, tradeName, townOf, villagers, townAt, oakFolk, HOUSES, MILL, BIZ_SITES, TOWNS, ROADS, RIVER, WAYSTATION, RUIN, OAKGATE, relocate, cityLoad, _moveTo: moveTo, _separate: separate, initGov, holdMoot, electElder, replaceLord, seize, repTarget, thriftOf, councilNames, isHousehold, govLog, INTEREST, SEIZE_AT, CHEST_FLOOR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
