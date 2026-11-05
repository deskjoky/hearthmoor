/* Hearthmoor simulation core (v2).
   Pure game logic: no rendering, no DOM, no Math.random. The whole game state is plain JSON,
   so it can be saved, restored and tested headless. */
(function (root) {
  'use strict';

  const VERSION = 14;
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
    greenhaven: { name: 'Greenhaven', x: -238, z: -826, r: 95, open: true },
    crownmere: { name: 'Crownmere', x: 215, z: -1010, r: 280, open: true }
  };
  const ROADS = {
    east: [[88, 5], [120, 3], [160, -8], [200, -28], [240, -58], [272, -104], [298, -162], [326, -226], [356, -286], [384, -332], [404, -366]]
  };
  // the river Alder runs down from the mountains through Oakbridge, under its bridge, and on to the sea
  const RIVER = [[560, -1620], [470, -1390], [478, -1215], [500, -1100], [470, -800], [452, -560], [438, -432], [466, -300], [536, -180], [640, -60], [780, 60], [940, 160]];
  const WAYSTATION = { x: 226, z: -34 }, RUIN = { x: 290, z: -246 }, OAKGATE = { x: 404, z: -368 };

  /* ---------- the realm around the village ---------- */
  const REALM = {
    lord: 'Lord Edric Varrow', lordShort: 'Lord Varrow', elder: 'Elder Brannoch', steward: 'Steward Merrin', king: 'King Aldwin', capital: 'Crownmere',
    towns: ['Ashford', 'Kellmere', 'Crownmere']
  };
  const RUMORS = [
    'Ashford’s river barges are carrying twice the grain this year. Their mayor is getting rich.',
    'Kellmere’s mines found a new seam of iron. Smiths there pay well for good charcoal.',
    'They say ' + 'King Aldwin' + ' is calling his lords to Crownmere before winter.',
    'Bandits were seen on the Ashford road last week. Travel in daylight.',
    'Lord Varrow keeps to his manor. His steward does the real work.',
    'In Crownmere a shopkeeper bought a seat on the city council. Coin opens doors there.',
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
  // the story's tasks name the people who hold the offices now, not the ones who held them on day one
  function stepText(s, text) {
    if (!text || !s.offices) return text;
    const e = s.offices.elder, en = e === 'player' ? null : e && s.people && s.people[e] ? s.people[e].name.split(' ')[0] : null;
    const l = s.offices.lord, ln = l && l !== 'player' && s.people && s.people[l] ? s.people[l].name.split(' ').slice(-1)[0] : null;
    let out = text.replace('Meet Elder Brannoch', en ? 'Meet Elder ' + en : e === 'player' ? 'Take up your seat' : 'Meet the elder');
    if (ln) out = out.replace('Lord Varrow\u2019s', 'Lord ' + ln + '\u2019s');
    if (e && e !== 'player' && s.people && s.people[e] && sexOf(s.people[e]) === 'f') out = out.replace('names you his successor', 'names you her successor');
    return out;
  }
  const MANOR_HOME = { x: 2, z: -54 };
  const BIZ_BASE = { bakery: 26, smithy: 30, tavern: 26, joinery: 23, mill: 24 };
  const OFFICES = {
    lord: { title: 'Lord of Hearthmoor', salary: 0, home: 'manor' },
    steward: { title: 'Steward', salary: 10, home: 'manor' },
    elder: { title: 'Village Elder', salary: 5, home: null },
    taxman: { title: 'Tax collector', salary: 6, home: 'manor' },
    guard: { title: 'Manor guard', salary: 6, home: 'manor' },
    keeper: { title: 'Granary Keeper', salary: 0, chestPay: 3, home: null },     // appointed by the Elder, paid from the village chest
    watch: { title: 'Village Watchman', salary: 0, chestPay: 3, home: null }
  };
  // the open land south of the village: the Elder decides what it becomes
  const LAND_USES = {
    cottages: { name: 'New cottages', cost: 90, days: 4, text: 'Three cottages on the open land. New families move in: more hands, more customers, more voices at the moot.' },
    pasture: { name: 'A common pasture', cost: 30, days: 2, text: 'Grazing for everyone\u2019s animals. Field hands earn a little more, and the chest takes small grazing fees.' }
  };
  const NEW_COTTAGES = [{ x: -8, z: 53, name: 'Commons Cottage' }, { x: 8, z: 53, name: 'Stile Cottage' }, { x: 0, z: 63, name: 'Far Croft' }];
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
  /* ---------- the calendar: twelve months of five days, a year of sixty days, four seasons ----------
     The game begins on the first day of spring. People age with the calendar by default (a year every 60 days);
     Settings offers quicker lives for those who want to see generations come and go. */
  const MONTH_DAYS = 5, YEAR_DAYS = 60;
  const MONTHS = ['Thawmonth', 'Seedmonth', 'Blossom', 'Highsun', 'Haymonth', 'Goldmonth', 'Reaping', 'Applefall', 'Leaffall', 'Frostmonth', 'Deepwinter', 'Snowmelt'];
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  function calendar(s) { const d = (s.day || 1) - 1, m = Math.floor(d / MONTH_DAYS) % 12; const si = Math.floor(m / 3); return { year: Math.floor(d / YEAR_DAYS) + 1, month: m, monthName: MONTHS[m], dom: d % MONTH_DAYS + 1, season: SEASONS[si], next: SEASONS[(si + 1) % 4], daysLeft: 15 - (d % 15) }; }
  const seasonOf = s => calendar(s).season;
  // what each season does to the land and the roads
  const SEASON_FX = {
    spring: { grain: 0.7, wood: 1, ore: 1, fuel: 1, travel: 1, theft: 1, mood: 0 },
    summer: { grain: 1.1, wood: 1, ore: 1.05, fuel: 0.8, travel: 1.25, theft: 0.9, mood: 3 },
    autumn: { grain: 1.7, wood: 1.1, ore: 1, fuel: 1.1, travel: 1.05, theft: 0.9, mood: 1 },
    winter: { grain: 0.45, wood: 1.15, ore: 0.8, fuel: 1.4, travel: 0.6, theft: 1.35, mood: -6 }
  };
  const seasonFx = s => SEASON_FX[seasonOf(s)] || SEASON_FX.spring;
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
    const st = { day: s.day, shops: {}, jobPay: 0, rawSales: 0, marketBuys: 0, rent: 0, tax: 0, contract: 0, given: 0, property: 0, owned: 0, salaries: 0, interest: 0, seized: 0, notes: [], coinsStart: s.coins };
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
      v: VERSION, ageRate: 15, t: 6 * 60, day: 1, rng: (seed | 0) || 12345, coins: 5, name: name || 'Wren',
      player: { x: P.home.x, z: P.home.z, face: 0, dest: null, action: null, inv: { grain: 0, wood: 0, ore: 0 } },
      shops: [], nextShop: 1, job: null, trades: { bakery: 0, smithy: 0, tavern: 0, joinery: 0 },
      agents: [], nextId: 1, schedule: [], applicants: [], ledger: [], events: [], rec: freshRecords(), stats: null, village: freshVillage()
    };
    setupPeople(s);
    initGov(s);
    setupOakbridge(s);
    setupGreenhaven(s);
    setupCrownmere(s); setupNewTown(s, 'ironcrest'); setupNewTown(s, 'eastwatch'); setupNewTown(s, 'dawnport'); setupRealm(s); setupValdoria(s);
    generateAncestry(s);
    you(s).age = 20; s.you.bday = 3;
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
    const sp = OAK.spots[job] || GH.spots[job] || CM.spots[job] || IC.spots[job] || EW.spots[job]; if (sp) return { x: sp.x + j() * 2 * sp.rx, z: sp.z + j() * 2 * sp.rz };
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
    if (v.council && v.step >= 6 && !v.projects.granary && !v.shortage && rand(s) < (s.offices && s.offices.keeper ? 0.03 : 0.12)) {
      v.shortage = true; v.granary = 0; v.granaryNeed = 12;
      event(s, 'A lean week: the granary is running low again. Villagers will buy less until it is refilled (12 grain), or enlarged by the council.', 'bad');
    }
    for (const shop of s.shops) {
      const T = TRADES[shop.trade], Ti = tierOf(shop);
      const [o, c] = T.hours;
      const when = () => base + (o + rand(s) * (c - o - 0.6)) * 60;
      const share = shopShare(s, shop), vr = (T.villagerRate * (v.shortage ? 0.5 : 1) + (v.projects.lanterns ? 0.08 : 0)) * Math.min(1, share * 1.15) * (shop.manager ? 1.2 : 1);
      villagers(s).filter(p => p.purse >= shop.price && !p.kid && !p.held && !(p.job && ['guard', 'lord', 'steward', 'taxman'].includes(p.job.office))).forEach(p => { if (rand(s) < vr) sched.push({ at: when(), pid: p.id, shop: shop.id }); });
      const n = Math.max(0, Math.round((Ti.travelers + (v.projects.pave ? 1 : 0) + (v.projects.road ? 1 : 0) + Math.floor(rand(s) * 3) - 1) * TOLLS[v.toll].travelers * (s.offices && s.offices.watch ? 1.12 : 1) * seasonFx(s).travel));
      for (let i = 0; i < Math.round(n * Math.min(1, share * 1.15 + 0.2)); i++) sched.push({ at: when(), id: null, shop: shop.id });
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
      v.contract = { trade: shop.trade, qty, reward: Math.round(qty * T.price * 1.6), until: s.day + 3, who: ['A drover bound for Ashford', 'A Kellmere mining crew', 'A wagon train to Crownmere', 'The innkeeper at Ashford'][Math.floor(rand(s) * 4)] };
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

  // the part of today's coin that already has its own line in the books
  function trackedNet(s) { const st = s.stats, sh = st.shops || {}; let n = (st.jobPay || 0) + (st.rawSales || 0) + (st.rent || 0) + (st.contract || 0) + (st.seized || 0) + (st.owned || 0) - (st.marketBuys || 0) - (st.tax || 0) - (st.given || 0) - (st.salaries || 0) - (st.interest || 0) - (st.family || 0) - (st.stabling || 0) + (st.fines || 0) + (st.restitution || 0) + (st.bribes || 0) - (st.hush || 0) + (st.lands || 0) + (st.partner || 0); for (const k in sh) { const x = sh[k]; n += (x.revenue || 0) - (x.supplies || 0) - (x.wages || 0) - (x.upkeep || 0); } return n; }
  const FLOW_LABEL = { audit: 'Audited a manager\u2019s books', buyHouse: 'Bought a house', buyCottage: 'Bought the cottage', repairCottage: 'Repaired the cottage', improveHome: 'Improved a home', repairHouse: 'Repaired a house', upgrade: 'Shop building work', open: 'Opened a shop', sellShop: 'Sold a shop', buyBiz: 'Bought a business', acceptOffer: 'Sold property', giftCrown: 'Gift to the crown', patronage: 'Patronage', buyHorse: 'Bought a horse', sellHorse: 'Sold a horse', warChest: 'War chest', repairBiz: 'Mended a business', project: 'Village project', seekLordship: 'Lordship fee', acceptLordship: 'Lordship fee', journey: 'Travel', coach: 'Coach fare' };
  function closeDay(s) {
    const st = s.stats;
    if (s.player.horse) { spend(s, STABLING); st.stabling = (st.stabling || 0) + STABLING; }
    if (s.village.cottage === 'let') { earn(s, 5); st.rent += 5; s.rec.rentCollected += 5; }
    if (s.people) { bizDay(s); peopleEvening(s); }
    if (s.gov) govEvening(s);
    if (s.gov && s.people) justiceDay(s);
    if (s.realm && s.towns && s.people) courtsDay(s);
    if (s.towns) townEvening(s);
    if (s.people) propertyDay(s);
    goodsDay(s); logPrices(s);
    if (s.realm) realmDay(s);
    const entry = { day: st.day, shops: [], jobPay: st.jobPay, rawSales: st.rawSales, marketBuys: st.marketBuys, rent: st.rent, tax: st.tax, contract: st.contract, given: st.given, property: st.property, owned: st.owned || 0, salaries: st.salaries || 0, interest: st.interest || 0, seized: st.seized || 0, family: st.family || 0, stabling: st.stabling || 0, fines: st.fines || 0, restitution: st.restitution || 0, bribes: st.bribes || 0, hush: st.hush || 0, lands: st.lands || 0, partner: st.partner || 0, notes: st.notes.slice() };
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
      if (shop.hands && shop.hands.length) {
        handsRound(s, shop, ss);
        for (const h of shop.hands.slice()) {
          spend(s, h.wage); ss.wages += h.wage; s.rec.wagesPaid += h.wage; const hp = h.pid && s.people && s.people[h.pid]; if (hp) hp.purse += h.wage;
          h.mood = clamp(h.mood + (h.wage >= h.ask ? 5 : -(h.ask - h.wage) * 7) + (shop.manager ? 3 : 0), 0, 100);
          if (h.mood < 15) { shop.hands = shop.hands.filter(x => x !== h); if (hp) { hp.job = null; plog(s, hp, 'Quit as a hand at your ' + TRADES[shop.trade].name.toLowerCase() + ': the pay was too low.'); } event(s, h.name + ' has quit as a hand at your ' + TRADES[shop.trade].name.toLowerCase() + '. The pay was too low.', 'bad'); }
        }
      }
      const up = Ti.upkeep;
      spend(s, up); ss.upkeep = up; ss.upkeepUnpaid = 0;
      const e = Object.assign({}, ss, { label: shopLabel(shop), tierName: Ti.name });
      e.costs = e.supplies + e.wages + e.upkeep; e.profit = e.revenue - e.costs;
      e.notes = explainShop(s, shop, e);
      entry.shops.push(e);
    }
    const c0 = s.coins;
    if (s.people) managersDay(s, entry);
    entry.managers = c0 - s.coins;
    entry.income = entry.shops.reduce((a, e) => a + e.revenue, 0) + entry.jobPay + entry.rawSales + entry.rent + entry.contract + Math.max(0, entry.owned) + entry.seized + entry.fines + entry.restitution + entry.bribes + Math.max(0, entry.lands) + entry.partner;
    entry.costs = entry.shops.reduce((a, e) => a + e.costs, 0) + entry.marketBuys + entry.tax + entry.given + Math.max(0, -entry.owned) + entry.salaries + entry.interest + entry.managers + entry.family + entry.stabling + entry.hush + Math.max(0, -entry.lands);
    if (s.coins < 0) entry.notes.push({ text: 'You are ' + (-s.coins) + 'c in debt to the Ashford moneylender. Interest of 2% a day is added every evening' + (s.coins <= SEIZE_AT ? ', and creditors will seize your property if you stay below ' + SEIZE_AT + 'c.' : '.') });
    entry.profit = entry.income - entry.costs;
    if (!entry.shops.length && !entry.notes.length) {
      entry.notes.push({ text: s.job ? 'Wages from your job are your income for now. Save up for a shop of your own.' : 'Ask for work at one of the shops across the square to start earning.' });
    }
    entry.coinsEnd = s.coins;
    { const prev = s.ledger[s.ledger.length - 1], start = prev && prev.day === entry.day - 1 ? prev.coinsEnd : st.coinsStart; if (start != null) { const gap = (entry.coinsEnd - start) - entry.profit; const fl = st.flows || {}; entry.otherItems = Object.keys(fl).filter(k => fl[k]).map(k => ({ label: FLOW_LABEL[k] || k, amount: fl[k] })); const named = entry.otherItems.reduce((a, x) => a + x.amount, 0); entry.unexplained = gap - named; if (gap) { entry.other = gap; if (gap > 0) entry.income += gap; else entry.costs -= gap; entry.profit = entry.income - entry.costs; } } }
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
      .map(p => ({ pid: p.id, name: p.name, skill: p.skill || 0.8, ask: managerAsk(p), now: occupation(s, p), ref: referenceOf(s, p) }));
  }
  function report(s, text) { s.reports = s.reports || []; s.reports.unshift({ day: s.day, text }); if (s.reports.length > 40) s.reports.length = 40; }
  function releaseManager(s, m, why) { const p = m && s.people[m.pid]; if (p && p.job && p.job.type === 'manage') { p.job = null; plog(s, p, why || 'No longer a manager.'); } }
  // a dishonest manager may skim the takings; the books show it sooner or later, and sometimes an honest one is wrongly suspected
  // everyone has a character: most are honest, some are not. It is fixed for life, and others only half know it
  function charOf(p) { if (p.honest == null) { const n = parseInt(String(p.id).replace(/\D/g, ''), 10) || 7; p.honest = ((n * 2654435761) >>> 0) % 1000 / 1000; } return p.honest; }
  // what a former employer or neighbour says of them: right more often than not, never certain
  function referenceOf(s, p) {
    const n = parseInt(String(p.id).replace(/\D/g, ''), 10) || 7, noise = (((n * 40503 + 97) >>> 0) % 1000 / 1000 - 0.5) * 0.5, seen = charOf(p) + noise;
    const fraud = (p.record || 0) && allCourts(s).some(C => C.closed.some(c => c.kind === 'fraud' && c.accused === p.id && c.verdict === 'guilty'));
    return fraud ? 'Convicted of fraud before' : seen > 0.62 ? 'Trusted by those who know them' : seen > 0.38 ? 'A mixed word from past work' : 'Doubtful: people count their change';
  }
  function openFraud(s, m, town, name, guilty, how) {
    const mp = s.people[m.pid], C = town === 'hearthmoor' ? s.justice : s.courts && s.courts[town]; if (!mp || !C) return null;
    if ((C.cases || []).some(k => k.status === 'open' && k.kind === 'fraud' && k.accused === mp.id)) return null;
    const value = guilty ? m.skim : 8 + Math.floor(rand(s) * 15);
    const c = newCase(s, 'fraud', { accused: mp.id, accuser: null, victim: 'player', value, where: name, truth: guilty ? 'guilty' : 'mistaken', excuse: guilty ? null : ['A cart of supplies was held at the toll gate; the receipts came a week late.', 'The missing coin was paid to a carpenter for repairs; the bill was filed under the wrong day.', 'The till was short because a customer paid in a foreign coin the clerk could not change.'][Math.floor(rand(s) * 3)], what: value + 'c missing from the takings of ' + name, claim: (how === 'audit' ? 'Your auditor finds the books of ' : 'The books of ') + name + ' ' + value + 'c short, and ' + mp.name + ' keeps them.' }, C);
    c.hidden = evidencePool(s, c); if (how === 'audit' && guilty) c.evidence.push({ text: 'The auditor traces the missing coin to ' + mp.name + '’s purse.', w: 2 });
    if (guilty) m.skim = 0;
    event(s, 'The books of ' + name + ' are ' + value + 'c short. A case against ' + mp.name + ', your manager, is open in ' + C.name + '.', 'bad');
    return c;
  }
  // a dishonest manager may skim the takings; the books show it sooner or later, and sometimes an honest one is wrongly suspected
  function managerFraud(s, m, town, name, did) {
    const mp = s.people[m.pid]; if (!mp) return;
    if (m.honest == null) m.honest = charOf(mp);
    if (m.honest < 0.3 && rand(s) < 0.04 + (m.skim ? 0.15 : 0)) { const x = Math.min(Math.max(0, s.coins), 3 + Math.floor(rand(s) * 8)); if (x > 0) { spend(s, x); mp.purse += x; m.skim = (m.skim || 0) + x; } }
    const guilty = m.skim > 0 && rand(s) < 0.06 + m.skim / 200, mistaken = !m.skim && rand(s) < 0.004;
    if (!guilty && !mistaken) return;
    const c = openFraud(s, m, town, name, guilty); if (c) did.push('the books are ' + c.value + 'c short, and a fraud case is open against ' + m.name);
  }
  function managersDay(s, entry) {
    // anyone whose business has gone (sold, seized) goes back to looking for work
    for (const p of living(s)) if (p.job && p.job.type === 'manage' && !managerOf(s, p.job.kind, p.job.ref)) { p.job = null; plog(s, p, 'The business they managed changed hands.'); }
    for (const shop of s.shops) {
      const m = shop.manager; if (!m) continue;
      const mp = s.people[m.pid]; if (!mp || mp.status !== 'here') { shop.manager = null; report(s, 'Your ' + TRADES[shop.trade].name.toLowerCase() + ' has lost its manager.'); continue; }
      spend(s, m.wage); mp.purse += m.wage; s.rec.wagesPaid += m.wage;
      let budget = m.budget, did = [];
      const ss = shopStats(s, shop), T = TRADES[shop.trade], floor = Math.ceil(Object.keys(T.recipe).reduce((a, g) => a + T.recipe[g] * buyPrice(s, 'hearthmoor', g), 0) / Math.max(1, tierOf(shop).out) * 1.1);
      if (!shop.policy.supplyRuns) { shop.policy.supplyRuns = true; did.push('set the worker to buy supplies'); }
      { /* the manager orders supplies in bulk overnight, a little cheaper, so the worker never has to leave the counter */
        const r = T.recipe, Ti = tierOf(shop), want = {};
        // before and through winter, a manager lays in a reserve of what the shop uses, if you allow it and can spare the coin
        const reserve = shop.policy.reserve !== false && (seasonOf(s) === 'autumn' || seasonOf(s) === 'winter') && s.coins > 120;
        // a sensible manager buys a reserve only while it is cheap, and when supplies are dear buys only what the next batches need
        for (const g of Object.keys(r)) { const pr = goodsPrice(s, 'hearthmoor', g) / GOODS_BASE[g], days = reserve && pr <= 1 ? 10 : pr > 2.2 ? 1 : pr > 1.6 ? 2 : 4; want[g] = Math.max(0, Math.min(Ti.cap, r[g] * days) - shop.stock[g]); }   // only while it is cheap: a sensible manager does not corner the market
        const price = g => Math.ceil(buyPrice(s, 'hearthmoor', g, want[g]) * 0.9), cost = () => Object.keys(want).reduce((a, g) => a + (want[g] ? price(g) : 0), 0);
        while ((cost() > Math.max(0, s.coins - 20) || (reserve && cost() > 60 + budget * 4)) && Object.values(want).some(v => v > 0)) { const g = Object.keys(want).sort((a, b) => want[b] / r[b] - want[a] / r[a])[0]; want[g]--; }
        const c = cost(), got = Object.keys(want).filter(g => want[g]);
        if (got.length && c > 0) {
          spend(s, c); ss.supplies = (ss.supplies || 0) + c;
          for (const g of got) { shop.stock[g] += want[g]; if (s.goods && s.goods.hearthmoor) s.goods.hearthmoor[g] = Math.max(0, (s.goods.hearthmoor[g] || 0) - want[g]); }
          did.push('ordered ' + got.map(g => want[g] + ' ' + g).join(' and ') + ' for ' + c + 'c');
        }
      }
      if (shop.worker) shop.worker.mood = clamp(shop.worker.mood + 4, 0, 100);
      if (!shop.worker && s.applicants && s.applicants.length) {
        const pick = s.applicants.map((a, i) => ({ a, i })).filter(x => x.a.ask <= budget + 9).sort((x, y) => y.a.skill / y.a.ask - x.a.skill / x.a.ask)[0];
        if (pick) { const r = cmd(s, 'hire', shop.id, pick.i, pick.a.ask); if (r.ok) did.push('hired ' + pick.a.name + ' at ' + pick.a.ask + 'c'); }
      }
      if (shop.worker && shop.worker.wage < shop.worker.ask && shop.worker.ask - shop.worker.wage <= budget) { budget -= shop.worker.ask - shop.worker.wage; shop.worker.wage = shop.worker.ask; did.push('raised ' + shop.worker.name + '\u2019s pay to ' + shop.worker.ask + 'c'); }
      if (ss.tooExpensive > Math.max(3, ss.sold * 0.5) && shop.goods >= tierOf(shop).out && shop.price > floor) { shop.price--; did.push('lowered the price to ' + shop.price + 'c (' + ss.tooExpensive + ' turned away)'); }
      else if (ss.soldOut > 0 && ss.tooExpensive <= 1 && shop.price < Math.round(T.wtp * 1.4)) { shop.price++; did.push('raised the price to ' + shop.price + 'c (sold out)'); }
      if (m.skill < 0.85 && rand(s) < (1.15 - m.skill) * 0.2) { const loss = 1 + Math.floor(rand(s) * 4); spend(s, loss); did.push('lost ' + loss + 'c through a careless mistake'); }
      managerFraud(s, m, 'hearthmoor', managedName(s, 'shop', shop.id), did);
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
      managerFraud(s, m, town, name, did);
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
    if (shop.hands && shop.hands.length) {
      const hw = shop.hands.reduce((a, h) => a + h.wage, 0);
      if ((e.rounds || 0) < (e.roundsWanted || 0) * 0.6) notes.push({ text: 'Your hands could have sold ' + e.roundsWanted + ' ' + T.product + ' round the village but sold ' + (e.rounds || 0) + (e.roundsRefused ? ' (' + e.roundsRefused + ' turned them down at ' + Math.max(1, Math.round(shop.price * 0.85)) + 'c)' : '') + ': they cost ' + hw + 'c and brought in ' + (e.roundsCoin || 0) + 'c. ' + (shop.goods < Ti.out ? 'Keep more on the shelf, or let one go.' : 'Most people had already bought: one fewer hand would do.') });
      else notes.push({ text: 'Your hands sold ' + e.rounds + ' ' + T.product + ' beyond the counter for ' + (e.roundsCoin || 0) + 'c, against ' + hw + 'c in wages.' });
    } else if (shop.worker && handRoom(shop) > 0 && e.soldOut === 0 && shop.goods >= Ti.out) notes.push({ text: 'Your shelf ended the day with goods to spare. A hand could take some round the town.', fix: { label: 'Hire a hand', cmd: ['page', 'staff'] } });
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
    const unit = Object.keys(T.recipe).reduce((a, g) => a + T.recipe[g] * buyPrice(s, 'hearthmoor', g), 0) / Ti.out;
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
          if (!buyer || buyer.status !== 'here' || buyer.held) continue;
          const wtp = clamp(normal(s, wtpMean(shop, false), T.sd), 1, T.wtp * 3);
          if (shop.goods > 0 && workerAttending(shop) && wtp >= shop.price && buyer.purse >= shop.price) {
            const r0 = rand(s), q0 = r0 < T.qty3 ? 3 : r0 < T.qty3 + T.qty2 ? 2 : 1, qty = Math.max(0, Math.min(q0, shop.goods, Math.floor(buyer.purse / shop.price))), coin = qty * shop.price;
            shop.goods -= qty; earn(s, coin); buyer.purse -= coin; if (shop.trade === 'bakery' || shop.trade === 'tavern') buyer.ate += Math.min(coin, FOOD); boughtToday(s, buyer, shop.trade);
            st.sold += qty; st.revenue += coin; st.served++; st.servedBy.worker++;
            s.rec.sold[T.product] += qty; s.rec.goodsSold += qty; s.rec.salesRevenue += coin; s.rec.served++;
          } else st.noService++;
          continue;
        }
        if (!a) continue;
        if (a.mode === 'shop') { e.at = s.t + 60; insertSched(s, e); continue; }
        a.mode = 'shop'; a.phase = 'toShop';
        a.wtp = clamp(normal(s, wtpMean(shop, false), T.sd) * (1 + 0.06 * (s.village.favor[firstName(a.name)] || s.village.favor[a.name] || 0)), 1, T.wtp * 3);
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
    const cj = COMMON_JOBS[job]; return cj ? cj[1] : { field: 'Reaping wheat', forest: 'Felling pines', pit: 'Digging iron ore', market: 'Trading at the post', well: 'Drawing water' }[job] || 'Working';
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
  /* a manager on the floor lends a hand at the bench and the counter: up to half again as fast */
  const mgrBoost = shop => shop && shop.manager ? 1 + 0.25 * Math.min(1.3, shop.manager.skill || 1) : 1;
  function workerSpeed(w, shop) { return w.skill * (w.mood < 30 ? 0.7 : 1) * mgrBoost(shop) * handBoost(shop); }
  /* ---------- hands: extra staff for a bigger shop ----------
     A stall is one pair of hands. A timber building has room for a second, a stone one for a third, and
     from the timber building up, a manager. Hands help at the bench and the counter, and each one takes
     goods out to sell beyond the counter (round the houses, to the inns, to carters for Oakbridge) at a
     little under the shop price. That trade is real but limited: the first hand sells the most, the next
     less, and a hand with nothing on the shelf to take out is a wage for nothing. */
  const HAND_ROOM = [0, 1, 2];
  const handRoom = shop => HAND_ROOM[shop.tier || 0] || 0;
  const handBoost = shop => 1 + 0.3 * ((shop && shop.hands) || []).reduce((a, h) => a + Math.min(1.3, h.skill || 1) * (h.mood < 30 ? 0.6 : 1), 0);
  const ROUND_SALE = [1, 0.65, 0.4];
  // how many a hand can sell round the town in a day: enough to clear about 12c over the cost of making them
  function roundQuota(shop) { const T = TRADES[shop.trade], cost = Object.keys(T.recipe).reduce((a, g) => a + T.recipe[g] * BUY[g], 0) / Math.max(1, T.tiers[0].out), margin = Math.max(1, T.price * 0.85 - cost); return Math.max(1, Math.round(12 / margin)); }
  // who has already bought this trade today, at any of your counters
  function boughtToday(s, p, trade) { const k = 'b:' + trade; s.stats[k] = s.stats[k] || {}; s.stats[k][p.id] = 1; }
  /* Hands sell round the village to people who have not yet bought today. Each one judges the street price
     (a little under the counter price) as any customer would, and pays from their own purse. When everyone who
     wants bread already has it, there is nothing to sell, however many hands you send out. Rival bakers supply
     about half the village, so only the other half is there for your hands. */
  function handsRound(s, shop, st) {
    const hs = shop.hands || []; if (!hs.length) return null;
    const T = TRADES[shop.trade], price = Math.max(1, Math.round(shop.price * 0.85));
    let cap = 0; hs.forEach((h, i) => { cap += Math.round(roundQuota(shop) * (ROUND_SALE[i] || 0.3) * Math.min(1.2, h.skill || 1) * (h.mood < 30 ? 0.6 : 1)); });
    const keep = Math.min(shop.goods, Math.ceil(tierOf(shop).out / 2)); let left = Math.max(0, Math.min(cap, shop.goods - keep));
    const done = s.stats['b:' + shop.trade] || {}, mean = wtpMean(shop, false) * 0.97;
    const pool = villagers(s).filter(p => !p.kid && p.status === 'here' && !done[p.id] && p.purse >= price);
    let sold = 0, coin = 0, asked = 0, refused = 0;
    for (const p of pool) {
      if (left <= 0) break;
      if (rand(s) > T.villagerRate * 0.5) continue;
      asked++;
      const wtp = clamp(normal(s, mean, T.sd), 1, T.wtp * 3);
      if (wtp < price) { refused++; continue; }
      const r0 = rand(s), q0 = r0 < T.qty3 ? 3 : r0 < T.qty3 + T.qty2 ? 2 : 1, q = Math.max(0, Math.min(q0, left, Math.floor(p.purse / price)));
      if (!q) continue;
      p.purse -= q * price; if (shop.trade === 'bakery' || shop.trade === 'tavern') p.ate += Math.min(q * price, FOOD);
      left -= q; sold += q; coin += q * price; boughtToday(s, p, shop.trade);
    }
    shop.goods -= sold; earn(s, coin);
    st.revenue += coin; st.sold += sold; st.rounds = (st.rounds || 0) + sold; st.roundsWanted = (st.roundsWanted || 0) + cap; st.roundsCoin = (st.roundsCoin || 0) + coin; st.roundsRefused = (st.roundsRefused || 0) + refused;
    return { sold, cap, coin };
  }


  function updateCounter(s, shop, dt) {
    const pa = playerAttending(s, shop), wa = workerAttending(shop), st = shopStats(s, shop);
    if (pa) st.playerMin += dt;
    if (!shop.queue.length) { shop.serveProgress = 0; return; }
    const front = agentById(s, shop.queue[0]);
    if (!front) { shop.queue.shift(); return; }
    if (front.phase !== 'queue' || dist(front, plotPt(shop, 'queue0')) > 0.6 || shop.goods <= 0) return;
    const speed = Math.max(pa ? 1 : 0, wa ? workerSpeed(shop.worker, shop) : 0);
    if (speed <= 0) return;
    shop.serveProgress += dt * speed;
    if (shop.serveProgress >= SERVE_MIN) {
      const T = TRADES[shop.trade];
      const buyer = front.pid && s.people[front.pid];
      const qty = Math.max(0, Math.min(front.qty, shop.goods, buyer ? Math.floor(buyer.purse / shop.price) : 99)), coin = qty * shop.price;
      if (qty <= 0) { shop.serveProgress = 0; leaveShop(s, front, shop, 'broke'); return; }
      shop.goods -= qty; earn(s, coin);
      if (buyer) { buyer.purse -= coin; if (shop.trade === 'bakery' || shop.trade === 'tavern') buyer.ate += Math.min(coin, FOOD); boughtToday(s, buyer, shop.trade); }
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
    if (w.pid && s.people && s.people[w.pid] && s.people[w.pid].held) { w.indoors = true; w.why = 'Locked in the watch house'; w.task = 'held'; return; }
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
    const sp = workerSpeed(w, shop);
    const low = !shop.work.loaded && !canProduce(shop);
    const target = Math.min(Ti.cap - Ti.out, Ti.out * (2 + ((shop.hands || []).length)));
    const missingCost = Object.keys(T.recipe).reduce((a, g) => a + Math.max(0, T.recipe[g] - shop.stock[g]) * buyPrice(s, 'hearthmoor', g), 0);
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
        const cost = () => Object.keys(want).reduce((a, g) => a + (want[g] ? buyPrice(s, 'hearthmoor', g, want[g]) : 0), 0);
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
      appoint(s, 'elder', 'player'); s.rec.everElder = true; v.step = 9; if (s.gov) { s.gov.approval.elder = Math.max(60, s.gov.approval.you); s.rec.timesElected++; }
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
  function plog(s, p, text) { p.log.unshift({ day: s.day, text }); const cap = p.status === 'you' ? 20 : (!p.town || p.town === 'hearthmoor') ? 10 : 5; if (p.log.length > cap) p.log.length = cap; }
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
  const VAL_F = ['Marisol', 'Ines', 'Catalina', 'Leonor', 'Beatriz', 'Elvira', 'Ximena', 'Sancha', 'Aldonza', 'Teresa', 'Blanca', 'Mencia', 'Juana', 'Olalla', 'Urraca', 'Constanza', 'Rosalind', 'Pilar'];
  const VAL_M = ['Rodrigo', 'Alvaro', 'Diego', 'Gonzalo', 'Inigo', 'Fernan', 'Sancho', 'Pelayo', 'Tomas', 'Bernat', 'Jaume', 'Ramon', 'Marti', 'Lope', 'Nuno', 'Gaspar', 'Esteve', 'Oriol'];
  const VAL_FAMILY = ['Ferrer', 'Vidal', 'Roca', 'Castell', 'Sola', 'Arenas', 'Delmar', 'Montaner', 'Vives', 'Puig', 'Serra', 'Bosch', 'Navarro', 'Medina', 'Torres', 'Salvat', 'Oliver', 'Rius', 'Cabrera', 'Fuster', 'Mirall', 'Prats', 'Soler', 'Valls'];
  const FEMALE = new Set(VAL_F.concat(['Alda', 'Alys', 'Avice', 'Beatrix', 'Cecily', 'Constance', 'Dulcie', 'Eda', 'Edda', 'Edith', 'Elsie', 'Faye', 'Freya', 'Gerd', 'Gisela', 'Hawise', 'Helewise', 'Hilda', 'Ida', 'Imogen', 'Isabel', 'Isolde', 'Joan', 'Jocelyn', 'Katrin', 'Lettice', 'Linnet', 'Mabyn', 'Maren', 'Maud', 'Meriel', 'Merrin', 'Muriel', 'Nell', 'Nesta', 'Orabel', 'Ottilie', 'Petra', 'Philippa', 'Quenby', 'Rohese', 'Rosamund', 'Sabine', 'Sela', 'Sibyl', 'Tamsin', 'Tibby', 'Tiffany', 'Tilly', 'Una', 'Wynn', 'Yseult', 'Alys', 'Mabel', 'Agnes', 'Elsbeth', 'Annis', 'Margery', 'Alice', 'Emma', 'Mother', 'Goodwife', 'Widow', 'Lady']));
  const firstName = n => { const w = String(n || '').split(' '); return ['Old', 'Young', 'Elder', 'Steward', 'Lord', 'Mayor', 'Reeve'].includes(w[0]) && w[1] ? w[1] : w[0]; };
  function sexOf(p) { if (!p) return 'm'; if (p.sex) return p.sex; const w = String(p.name || '').split(' ')[0]; return FEMALE.has(w) || FEMALE.has(firstName(p.name)) ? 'f' : 'm'; }
  function newPerson(s, o) {
    const id = 'p' + (s.nextPid++);
    if (o && o.skill == null) o.skill = Math.round((0.6 + rand(s) * 0.6) * 100) / 100;
    const p = Object.assign({ id, name: 'Someone', age: 30, purse: 20, skill: 0.6 + rand(s) * 0.6, job: null, home: null, mood: 60, opinion: 0, arrears: 0, homeless: 0, status: 'here', log: [], palette: Math.floor(rand(s) * 10), ate: 0, retired: false }, o);
    p.id = id; s.people[id] = p; return p;
  }
  function addBody(s, p, at) {
    if (s.agents.some(a => a.pid === p.id)) return;
    const pt = at || homePoint(s, p) || P.square;
    s.agents.push({ id: s.nextId++, kind: 'person', pid: p.id, name: p.name, x: pt.x, z: pt.z, face: 0, mode: 'routine', doing: '', icon: null, iconUntil: 0, palette: p.palette, kid: !!p.kid, job: p.job && p.job.type === 'commons' ? p.job.what : null });
  }
  function bodyOf(s, p) { const a = indexOf(s.agents, 'pid').get(p.id); return a && a.pid === p.id ? a : null; }
  // where you live: your hut, or a house you have bought and moved into
  // the seat of a region you hold: Varrow Manor becomes your family's manor, Stane Keep your keep
  const SEAT_STYLE = { hearthmoor: f => f + ' Manor', greenhaven: f => f + ' Hall', oakbridge: f => f + ' Keep', ironcrest: f => f + ' Keep', eastwatch: f => 'Castle ' + f, crownmere: () => 'Crownmere Castle' };
  function seatName(s, id) { return SEAT_STYLE[id] ? SEAT_STYLE[id](familyName(s)) : 'the seat of ' + REGIONS[id]; }
  function yourSeat(s) { const id = s.player && s.player.seat; return id && s.realm && regionLord(s, id) === 'player' ? id : null; }
  function yourHouse(s) { if (s.player && s.player.seat && yourSeat(s)) return null; const id = s.player && s.player.house; const h = id ? houseById(s, id) : null; return h && h.owner === 'player' ? h : null; }
  function yourTown(s) { const st = yourSeat(s); if (st) return st === 'hearthmoor' ? undefined : st; const h = yourHouse(s); return h && h.town && h.town !== 'hearthmoor' ? h.town : undefined; }
  // the shape of a house on the ground: which way its door faces, and whether it is a tall townhouse
  function houseShape(h) {
    const i = +String(h.id).replace(/^[a-z]+/, ''), L = h.town === 'oakbridge' ? OAK.houses : h.town === 'crownmere' ? CM.houses : h.town === 'greenhaven' ? GH.houses : null;
    const src = L && L[i];
    if (src) return { face: src.face, tall: !!src.tall, kind: h.town };
    return { face: Math.atan2(P.center.x - h.x, P.center.z - h.z), tall: (h.cap || 0) >= 4, kind: 'hearthmoor' };
  }
  function doorOf(h) { const f = houseShape(h).face; return { x: h.x + Math.sin(f) * 4.2, z: h.z + Math.cos(f) * 4.2 }; }
  function homeOfYou(s) { const st = yourSeat(s); if (st) { const pt = SEATS()[st]; return { x: pt.x, z: pt.z, name: seatName(s, st), town: st, house: null, seat: st }; } const h = yourHouse(s); return h ? { x: h.x, z: h.z, name: h.name, town: h.town || 'hearthmoor', house: h } : { x: P.home.x, z: P.home.z, name: 'your hut', town: 'hearthmoor', house: null }; }
  // everyone who lives with you follows you to a new home
  function bringFamily(s, why) {
    const T = yourTown(s), tn = T || 'hearthmoor';
    for (const p of living(s)) {
      if (p.home !== 'you') continue;
      if (townOf(p) !== tn) {
        if (p.job && !(p.job.type === 'biz' && p.job.role === 'owner')) loseJob(s, p, 'Left their work to move with ' + s.name + '.');
        p.town = T; plog(s, p, why);
        const a = bodyOf(s, p); if (a && s.bodiesIn && s.bodiesIn !== tn) s.agents = s.agents.filter(x => x !== a);
        if (!a && (!s.bodiesIn || s.bodiesIn === tn)) addBody(s, p);
      }
      const a = bodyOf(s, p), pt = homePoint(s, p); if (a && pt && Math.hypot(a.x - pt.x, a.z - pt.z) > 60) { a.x = pt.x; a.z = pt.z; }
    }
  }
  function homePoint(s, p) {
    if (!p.home) return null;
    if (p.home === 'manor') return MANOR_HOME;
    if (p.home.startsWith('seat:')) { const st = SEATS()[p.home.slice(5)]; return st ? { x: st.x, z: st.z } : null; }
    if (p.home === 'you') { const H = homeOfYou(s); return { x: H.x + 1.5, z: H.z + 1.5 }; }
    if (p.home.startsWith('biz:')) { const e = empById(p.home.slice(4)); return { x: e.x, z: e.z }; }
    const h = houseById(s, p.home); return h ? { x: h.x, z: h.z } : null;
  }
  function occupation(s, p) {
    const j = p.job;
    if (s.realm && p.status !== 'dead') {
      const R = s.realm, f = sexOf(p) === 'f';
      if (p.id === R.king && R.crown === 'king') return f ? 'Queen of Alderwyn' : 'King of Alderwyn';
      if (p.id === R.prince) return f ? 'Princess of Alderwyn' : 'Prince of Alderwyn';
      for (const k in COUNCIL) if (R.council[k] === p.id) return COUNCIL[k];
      for (const id in R.regions) if (R.regions[id].lord === p.id) return (f ? 'Lady of ' : 'Lord of ') + REGIONS[id];
    }
    if (!j) return p.kid ? (p.age >= 10 ? 'Child, helps at home' : 'Child') : p.retired ? 'Retired' : p.status === 'left' ? 'Gone from Hearthmoor' : 'Out of work';
    if (j.type === 'commons') return COMMON_JOBS[j.what] ? COMMON_JOBS[j.what][0] : { field: 'Farmer', forest: 'Woodcutter', pit: 'Miner', market: 'Trader at the post', well: 'Water-carrier' }[j.what];
    if (j.type === 'biz') { const e = empById(j.biz), b = s.biz[j.biz]; return (j.role === 'owner' ? 'Owner of ' : (b.owner === 'player' ? 'Works for you at ' : 'Works at ')) + e.name; }
    if (j.type === 'office' && j.office === 'mayor') return 'Mayor of Oakbridge';
    if (j.type === 'shop') { const sh = shopById(s, j.shop); return 'Works for you at your ' + (sh ? TRADES[sh.trade].name.toLowerCase() : 'shop'); }
    if (j.type === 'manage') return 'Manages ' + managedName(s, j.kind, j.ref) + ' for you';
    if (j.type === 'watch') return p.held ? 'Village watch (locked up)' : 'Village watch';
    if (j.type === 'office') return OFFICES[j.office].title;
    return 'Working';
  }
  function homeText(s, p) {
    if (p.home && p.home.startsWith('seat:')) return 'Lives at the seat of ' + REGIONS[p.home.slice(5)];
    if (!p.home) return p.status === 'left' ? 'Left the village' : 'Homeless, sleeping in the square';
    if (p.home === 'manor') return 'Lives at Varrow Manor';
    if (p.home === 'you') return 'Lives with you';
    if (p.home.startsWith('biz:')) return 'Lives above ' + empById(p.home.slice(4)).name;
    const h = houseById(s, p.home);
    if (h.owner === p.id) return 'Owns ' + h.name;
    return 'Rents ' + h.name + ' from ' + landlordName(s, h.owner) + ' at ' + h.rent + 'c a day' + (p.arrears ? ' (' + p.arrears + ' days behind)' : '');
  }
  function income(s, p) {
    const j = p.job;
    if (p.held) return 0;
    if (j && j.type === 'watch') { const g = s.justice && s.justice.watch.find(x => x.pid === p.id); return g ? g.wage : 0; }
    if (!j) return p.retired || p.kid ? 0 : ODD_JOBS;
    if (j.type === 'commons') return townOf(p) === 'oakbridge' ? COMMONS_PAY + 1 : townOf(p) === 'crownmere' ? COMMONS_PAY + 2 : townOf(p) === 'ironcrest' ? COMMONS_PAY + 2 : townOf(p) === 'eastwatch' ? COMMONS_PAY + 1 : townOf(p) === 'greenhaven' ? COMMONS_PAY : COMMONS_PAY - (s.village.shortage ? 2 : 0) + (j.what === 'field' && s.village.land && s.village.land.use === 'pasture' && s.village.land.state === 'done' ? 1 : 0);
    if (j.type === 'biz') { const b = s.biz[j.biz]; if (j.role === 'owner') return Math.max(0, Math.round(avg(b.profits))); const st = b.staff.find(x => x.pid === p.id); return st ? st.wage : 0; }
    if (j.type === 'shop') { const sh = shopById(s, j.shop); return sh && sh.worker ? sh.worker.wage : 0; }
    if (j.type === 'manage') { const m = managerOf(s, j.kind, j.ref); return m ? m.wage : 0; }
    if (j.type === 'office') return OFFICES[j.office].salary || OFFICES[j.office].chestPay || 0;
    return 0;
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  function vacancy(s, maxRent, town) {
    // empty homes first; failing that, a room as a lodger in someone else's house
    town = town || 'hearthmoor';
    return s.houses.filter(h => (h.town || 'hearthmoor') === town && h.cap > h.tenants.length && !h.tenants.includes(h.owner) && h.owner !== 'player-home' && !(s.player && s.player.house === h.id) && (maxRent == null || h.rent <= maxRent)).sort((a, b) => (a.tenants.length ? 1 : 0) - (b.tenants.length ? 1 : 0) || a.rent - b.rent)[0] || null;
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
    if (j.type === 'watch' && s.justice) s.justice.watch = s.justice.watch.filter(g => g.pid !== p.id);
    if (j.type === 'shop' && j.hand) { const sh = shopById(s, j.shop); if (sh && sh.hands) sh.hands = sh.hands.filter(h => h.pid !== p.id); }
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
  // Hearthmoor's families and their surnames; a wife takes her husband's name, and her own is kept as her maiden name
  const HM_FAMILIES = {
    Aldric: ['Thatcher'], Rosamund: ['Thatcher', 'Fenn'], Pip: ['Thatcher'], Maren: ['Hale'], Hilda: ['Hale'], Tobin: ['Woodward'], Ida: ['Woodward', 'Reed'], Wat: ['Woodward'], Tilly: ['Woodward'],
    Edda: ['Brook', 'Pike'], Rook: ['Brook'], Wynn: ['Marsh', 'Carter'], Corin: ['Marsh'], Brannoch: ['Ashe'], Sela: ['Ashe', 'Lowe'], Gerd: ['Baxter'], Hollin: ['Smith'], Ysolde: ['Tapper'],
    Ash: ['Wright'], Tamsin: ['Miller'], Osric: ['Penn'], Linnet: ['Penn', 'Vale'], Cade: ['Tanner'], Freya: ['Tanner', 'Holt'], Bram: ['Fuller'], Elsie: ['Fuller'], Merrin: ['Dacre'], Pell: ['Roper'], Hobb: ['Stone']
  };
  function giveSurnames(s) {
    const renamed = new Map();
    for (const p of Object.values(s.people)) {
      if (p.town && p.town !== 'hearthmoor') continue;
      const w = p.name.split(' '), title = ['Old', 'Mother', 'Goodwife'].includes(w[0]) ? w[0] : null, first = title ? w[1] : w[0];
      const f = HM_FAMILIES[first]; if (!f || (w.length > (title ? 2 : 1))) continue;
      const old = p.name; p.name = (title && title !== 'Old' ? title + ' ' : '') + first + ' ' + f[0];
      if (f[1]) p.maiden = first + ' ' + f[1];
      renamed.set(first, f[0]); renamed.set(old, f[0]);
    }
    // children named after a parent's first name take the family's surname instead
    for (const p of Object.values(s.people)) {
      const w = p.name.split(' '); if (w.length !== 2) continue;
      const par = (p.parents || []).map(id => s.people[id]).filter(Boolean), dad = par.find(q => sexOf(q) === 'm') || par[0];
      if (dad && renamed.has(w[1]) && firstName(dad.name) === w[1]) p.name = w[0] + ' ' + renamed.get(w[1]);
    }
  }
  // the generations before: every family gets its dead, so the world did not begin on the day you arrived
  function generateAncestry(s) {
    if (s.ancestry) return; s.ancestry = 1;
    let sd = 8675309; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const rate = s.ageRate || 4, FIRST_F = FIRST.filter(n => FEMALE.has(n)).concat(BABY_F), FIRST_M = FIRST.filter(n => !FEMALE.has(n)).concat(BABY_M);
    const pick = L => L[Math.floor(r() * L.length)], SUR = FAMILY.concat(['Hale', 'Fenn', 'Reed', 'Pike', 'Lowe', 'Vale', 'Holt', 'Carter', 'Thatcher', 'Woodward', 'Brook', 'Ashe']);
    const lastOf = n => { const w = String(n).split(' '); return w.length > 1 ? w[w.length - 1] : null; };
    const dead = (name, sex, ageAt, yearsAgo, town, maiden) => {
      const id = 'p' + (s.nextPid++), died = s.day - Math.max(1, Math.round(yearsAgo)) * rate;
      const p = Object.assign({}, PERSON_TEMPLATE, { id, name, age: Math.round(ageAt), sex, status: 'dead', died, log: [{ day: died, text: 'Died, aged ' + Math.round(ageAt) + '.' }], ancestor: true });
      if (town) p.town = town; if (maiden) p.maiden = maiden; s.people[id] = p; return p;
    };
    const couple = (sur, town, childAge) => {
      // a father and mother, born some thirty years before their eldest; both have since died
      const gap = 24 + r() * 12, fAge = 48 + r() * 34, mAge = 46 + r() * 36, born = childAge + gap;
      const f = dead(pick(FIRST_M) + ' ' + sur, 'm', fAge, Math.max(1, born - fAge + r() * 3), town);
      const mm = pick(SUR.filter(x => x !== sur)), mf = pick(FIRST_F), m = dead(mf + ' ' + sur, 'f', mAge, Math.max(1, born - 2 - mAge + r() * 3), town, mf + ' ' + mm);
      f.spouse = m.id; m.spouse = f.id; f.gen = born; return { f, m, born };
    };
    // the living who have no parents on record, grouped into families by the name they were born with
    const roots = Object.values(s.people).filter(p => p.status === 'here' && !p.kid && !(p.parents || []).length && lastOf(p.maiden || p.name) && !(p.job && p.job.type === 'office' && ['lord', 'steward', 'taxman', 'guard'].includes(p.job.office)));
    const groups = new Map();
    for (const p of roots) { const k = (p.town || 'hearthmoor') + '|' + lastOf(p.maiden || p.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const fathersBySur = new Map(), mothersByMaiden = new Map();
    for (const [k, ps] of groups) {
      const [town, sur] = k.split('|'); ps.sort((a, b) => b.age - a.age);
      // brothers and sisters: close in age, a handful at most
      let set = [];
      const flush = () => { if (!set.length) return; const c = couple(sur, town === 'hearthmoor' ? undefined : town, set[0].age); set.forEach(ch => { ch.parents = [c.f.id, c.m.id]; }); const fk = town + '|' + sur; if (!fathersBySur.has(fk)) fathersBySur.set(fk, []); fathersBySur.get(fk).push(c); const mk = town + '|' + lastOf(c.m.maiden); if (!mothersByMaiden.has(mk)) mothersByMaiden.set(mk, []); mothersByMaiden.get(mk).push(c); set = []; };
      for (const p of ps) { if (set.length && (set.length >= 5 || set[0].age - p.age > 14 || r() < 0.3 || set.some(q => q.spouse === p.id))) flush(); set.push(p); }
      flush();
    }
    // the grandparents: fathers who share a surname in a town were brothers; some mothers were sisters
    const grand = (list, sur, town, viaMother) => {
      for (let i = 0; i < list.length; i += 3) {
        const sibs = list.slice(i, i + 3), eldest = Math.max(...sibs.map(c => c.born)), g = couple(sur, town, eldest);
        sibs.forEach(c => { (viaMother ? c.m : c.f).parents = [g.f.id, g.m.id]; });
        if (!viaMother && r() < 0.6) { const gg = couple(sur, town, g.born); g.f.parents = [gg.f.id, gg.m.id]; }
      }
    };
    for (const [k, list] of fathersBySur) { const [town, sur] = k.split('|'); grand(list, sur, town === 'hearthmoor' ? undefined : town, false); }
    for (const [k, list] of mothersByMaiden) { const [town, sur] = k.split('|'); if (r() < 0.7) grand(list, sur, town === 'hearthmoor' ? undefined : town, true); }
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
    giveSurnames(s);
    for (const p of living(s)) if (!['lord', 'steward', 'taxman'].includes(p.job && p.job.office)) addBody(s, p);
    s.agents.forEach(a => { if (a.job) a.spot = jobSpot(s, a.job); });
  }

  /* the village's businesses keep their own books */
  /* ================= one economy (Stage V) =================
     Grain, timber and iron have their own stock and price in every town. Every business, yours or not,
     sells into the same demand: the town's grown people and its travellers, shared between every seller of
     that trade by how much each can make. Ingredients cost what they cost in that town's market today. */
  const GOODS_BASE = { grain: 2, wood: 2, ore: 3 };
  const TOWN_GOODS = {
    hearthmoor: { make: { grain: 30, wood: 25, ore: 9 }, use: { grain: 20, wood: 15, ore: 6 }, travellers: 8 },
    greenhaven: { make: { grain: 60, wood: 10, ore: 0 }, use: { grain: 25, wood: 15, ore: 4 }, travellers: 10 },
    oakbridge: { make: { grain: 15, wood: 22, ore: 0 }, use: { grain: 50, wood: 35, ore: 12 }, travellers: 40 },
    crownmere: { make: { grain: 25, wood: 15, ore: 0 }, use: { grain: 150, wood: 90, ore: 40 }, travellers: 120 },
    ironcrest: { make: { grain: 2, wood: 35, ore: 90 }, use: { grain: 40, wood: 30, ore: 20 }, travellers: 15 },
    eastwatch: { make: { grain: 10, wood: 5, ore: 0 }, use: { grain: 70, wood: 60, ore: 15 }, travellers: 60 },
    dawnport: { make: { grain: 40, wood: 4, ore: 0 }, use: { grain: 60, wood: 45, ore: 10 }, travellers: 55 }
  };
  // per trade: how often a grown person buys (visits a day), how much each time, the usual price,
  // the goods used per unit sold, and how many units one pair of hands can make in a day
  const ECON = {
    bakery: { rate: 0.6, qty: 1.3, price: 5, inputs: { grain: 0.5, wood: 0.25 }, perWorker: 6 },
    tavern: { rate: 0.55, qty: 1.6, price: 3, inputs: { grain: 0.5, wood: 0.15 }, perWorker: 10 },
    smithy: { rate: 0.06, qty: 1, price: 18, inputs: { ore: 1.5, wood: 1 }, perWorker: 1.5 },
    joinery: { rate: 0.05, qty: 1, price: 12, inputs: { wood: 2.5 }, perWorker: 2.5 },
    mill: { rate: 0.5, qty: 1, price: 2, inputs: { grain: 0.5 }, perWorker: 15 },
    butcher: { rate: 0.35, qty: 1.2, price: 4, inputs: { grain: 0.6 }, perWorker: 7 },
    chandler: { rate: 0.2, qty: 1.3, price: 3, inputs: { wood: 0.3 }, perWorker: 10 },
    tailor: { rate: 0.05, qty: 1, price: 12, inputs: {}, perWorker: 2.5 },
    weaver: { rate: 0.07, qty: 1, price: 8, inputs: {}, perWorker: 4 },
    potter: { rate: 0.1, qty: 1.2, price: 4, inputs: { wood: 0.4 }, perWorker: 7 },
    cooper: { rate: 0.05, qty: 1, price: 8, inputs: { wood: 1.5 }, perWorker: 3.5 },
    wheelwright: { rate: 0.03, qty: 1, price: 14, inputs: { wood: 2, ore: 0.3 }, perWorker: 2 },
    carter: { rate: 0.12, qty: 1, price: 3, inputs: {}, perWorker: 10 },
    boatwright: { rate: 0.012, qty: 1, price: 40, inputs: { wood: 6 }, perWorker: 0.75 },
    goldsmith: { rate: 0.012, qty: 1, price: 30, inputs: { ore: 1 }, perWorker: 1 },
    apothecary: { rate: 0.12, qty: 1, price: 5, inputs: {}, perWorker: 6 },
    mason: { rate: 0.025, qty: 1, price: 20, inputs: {}, perWorker: 1.5 },
    tanner: { rate: 0.06, qty: 1, price: 6, inputs: {}, perWorker: 5 },
    dairy: { rate: 0.45, qty: 1, price: 2, inputs: { grain: 0.3 }, perWorker: 15 },
    estate: { rate: 0, qty: 0, price: 0, inputs: {}, perWorker: 0, flat: 70 }
  };
  const goodsTarget = (t, g) => Math.max(20, TOWN_GOODS[t].use[g] * 5);
  function setupGoods(s) {
    if (s.goods) return;
    s.goods = {};
    for (const t in TOWN_GOODS) { s.goods[t] = {}; for (const g of GOODS) { const T = TOWN_GOODS[t]; s.goods[t][g] = Math.round(goodsTarget(t, g) + 2 * (T.make[g] - T.use[g])); } }
    for (const t in TOWN_GOODS) for (const g of GOODS) s.goods[t][g] = Math.max(8, s.goods[t][g]);
  }
  function goodsPrice(s, t, g, shift) { setupGoods(s); const st = Math.max(1, s.goods[t || 'hearthmoor'][g] + (shift || 0)); return GOODS_BASE[g] * clamp(Math.pow(goodsTarget(t || 'hearthmoor', g) / st, 0.6), 0.4, 3.2); }
  /* a load is priced unit by unit: each one bought makes the next dearer, each one sold makes the next cheaper */
  function loadPrice(s, t, g, n, dir) { let sum = 0; for (let k = 0; k < n; k++) sum += goodsPrice(s, t, g, dir * k); return sum; }
  const buyPrice = (s, t, g, n) => { n = n || 1; return Math.max(n, Math.round(loadPrice(s, t, g, n, -1) * 1.1)); };
  const sellPrice = (s, t, g, n) => { n = n || 1; return Math.max(0, Math.floor(loadPrice(s, t, g, n, 1) * 0.75)); };
  // the last fifteen days of prices in every market, so a trend can be seen before the season turns
  function logPrices(s) {
    if (!s.goods) return; s.priceLog = s.priceLog || {};
    for (const t in s.goods) { const L = s.priceLog[t] = s.priceLog[t] || {}; for (const g of GOODS) { const a = L[g] = L[g] || []; a.push(Math.round(goodsPrice(s, t, g) * 100) / 100); if (a.length > 15) a.shift(); } }
  }
  function goodsDay(s) {
    setupGoods(s);
    for (const t in TOWN_GOODS) for (const g of GOODS) {
      // merchants' carts bring the town's usual imports (or carry off its usual surplus), and only slowly
      // close a shortage or a glut, so a market that runs short stays short for a week or two: worth hauling to
      // the season moves what the land gives and what the town burns; carts make up only half the difference,
      // so grain is dear by late winter and cheap after the harvest
      const T = TOWN_GOODS[t], st = s.goods[t][g], fx = seasonFx(s), mk = T.make[g] * (fx[g] || 1), us = T.use[g] * (g === 'wood' ? fx.fuel : 1);
      // when a market runs badly short the price draws traders from the other towns, faster the worse it gets
      const short = Math.max(0, goodsTarget(t, g) * 0.5 - st);
      const carts = 0.8 * (T.use[g] - T.make[g]) + 0.5 * ((us - mk) - (T.use[g] - T.make[g])) + 0.1 * (goodsTarget(t, g) - st) + 0.25 * short;
      s.goods[t][g] = Math.max(4, Math.round(st + mk * (0.85 + rand(s) * 0.3) - us * (0.85 + rand(s) * 0.3) + carts));
    }
    // now and then a blight, a flood, a lost convoy or a bumper year shakes one market
    if (rand(s) < 0.16) {
      const towns = Object.keys(TOWN_GOODS), t = towns[Math.floor(rand(s) * towns.length)], g = GOODS[Math.floor(rand(s) * GOODS.length)];
      if (goodsTarget(t, g) >= 20) {
        const glut = rand(s) < 0.3, why = glut ? { grain: 'a bumper harvest', wood: 'a great felling in the woods', ore: 'a rich new seam' }[g] : { grain: 'blight in the fields', wood: 'floods on the timber road', ore: 'a flooded mine' }[g];
        s.goods[t][g] = Math.max(Math.round(goodsTarget(t, g) * 0.18), Math.round(s.goods[t][g] * (glut ? 2.2 : 0.3)));
        s.shocks = (s.shocks || []).concat({ day: s.day, town: t, good: g, glut }).slice(-12);
        event(s, (glut ? 'Glut' : 'Shortage') + ' in ' + REGIONS[t].replace(/^the /, '') + ': ' + why + '. ' + g.charAt(0).toUpperCase() + g.slice(1) + (glut ? ' is cheap there now; it will take a week or two to clear.' : ' is dear there now; it will take a week or two to recover.'), glut ? 'info' : 'story');
      }
    }
  }
  const MARKET_AT = { hearthmoor: 'market', oakbridge: 'oaksq', greenhaven: 'ghgreen', crownmere: 'cmmarket', ironcrest: 'icsquare', eastwatch: 'ewharbour' };
  function marketHere(s) { setupGoods(s); for (const t in MARKET_AT) { const L = LOCS[MARKET_AT[t]]; if (L && dist(s.player, L) < L.r + (t === 'hearthmoor' ? 0 : 4)) return t; } return null; }
  // the day's demand for a trade in a town, and how much each seller can make
  function sellersOf(s, t, trade) {
    const out = [];
    for (const id in s.biz) { const b = s.biz[id]; if (b.closed || b.trade !== trade || (b.town || 'hearthmoor') !== t) continue; out.push({ b, cap: bizCap(s, b) }); }
    if (t === 'hearthmoor') for (const sh of s.shops) if (sh.trade === trade) out.push({ shop: sh, cap: shopCap(sh) });
    return out;
  }
  function bizCap(s, b) { const E = ECON[b.trade] || ECON.carter, own = b.owner === 'player' && !b.lease ? (b.manager ? 1 : 0) : (s.people && s.people[b.owner] && s.people[b.owner].held ? 0.4 : 1); return (b.staff.filter(x => !(s.people && s.people[x.pid] && s.people[x.pid].held)).length + own) * E.perWorker * (b.disrepair ? 0.7 : 1); }
  function shopCap(sh) { return (ECON[sh.trade] || ECON.carter).perWorker * (1 + (sh.worker ? 1 : 0) + (sh.manager ? 0.5 : 0) + ((sh.hands || []).length * 0.1)) * [1, 1.5, 2][sh.tier || 0]; }
  function townDemand(s, t, trade) {
    const E = ECON[trade]; if (!E) return 0;
    const folk = living(s).filter(p => townOf(p) === t && !p.kid && p.age >= 14);
    const work = folk.length ? folk.filter(p => p.job || p.retired).length / folk.length : 0.8;
    return (folk.length * E.rate * (0.55 + 0.55 * work) + TOWN_GOODS[t].travellers * seasonFx(s).travel * E.rate) * E.qty;
  }
  function inputCost(s, t, trade, units) { const E = ECON[trade] || {}; return Object.keys(E.inputs || {}).reduce((a, g) => a + E.inputs[g] * goodsPrice(s, t, g), 0) * units; }
  // the share of the village's custom that comes to one of your lot shops
  function shopShare(s, sh) { const all = sellersOf(s, 'hearthmoor', sh.trade), tot = all.reduce((a, x) => a + x.cap, 0); return tot ? shopCap(sh) / tot : 1; }
  function bizDay(s) {
    const pop = adults(s), employed = pop.filter(p => p.job).length / Math.max(1, pop.length), dem = {};
    for (const id in s.biz) {
      const b = s.biz[id];
      if (b.closed) {
        b.lastProfit = 0;
        // an empty shop does not stay empty for ever: someone from outside takes it on
        if (b.owner !== 'player' && b.closedOn != null && s.day - b.closedOn > 20 && b.trade !== 'estate' && rand(s) < 0.05) {
          const SUR = ['Ashby', 'Brook', 'Carter', 'Fletcher', 'Mason', 'Wright', 'Cooper', 'Hayward', 'Fowler', 'Reeve', 'Webb', 'Lowe'], F = rand(s) < 0.5 ? BABY_F : BABY_M;
          const nm = F[Math.floor(rand(s) * F.length)] + ' ' + SUR[Math.floor(rand(s) * SUR.length)];
          if (!Object.values(s.people).some(q => q.name === nm)) {
            const q = newPerson(s, { name: nm, age: 24 + Math.floor(rand(s) * 20), purse: 80, town: b.town, sex: F === BABY_F ? 'f' : 'm', job: { type: 'biz', biz: id, role: 'owner' }, home: 'biz:' + id });
            q.log = [{ day: s.day, text: 'Came from Ashford and reopened ' + empById(id).name + '.' }];
            b.owner = q.id; b.closed = false; b.profits = [3, 3, 3]; b.staff = []; b.lossDays = 0; b.closedOn = null;
            event(s, q.name + ' has come from Ashford and reopened ' + empById(id).name + ' in ' + REGIONS[b.town || 'hearthmoor'].replace(/^the /, '') + '.', 'info');
          }
        }
        continue;
      }
      const lessee = b.owner === 'player' && b.lease ? person(s, b.lease.pid) : null, mine = b.owner === 'player' && !lessee;
      const own = lessee || (b.owner === 'player' ? null : person(s, b.owner));
      const workers = b.staff.length + (own ? 1 : 0);
      const rivals = Object.values(s.biz).filter(x => x !== b && !x.closed && x.trade === b.trade && (x.town || 'hearthmoor') === (b.town || 'hearthmoor')).length;
      const competition = Math.max(0.35, 1 - 0.28 * ((b.town || 'hearthmoor') === 'hearthmoor' ? s.shops.filter(x => x.trade === b.trade).length : 0)) / (1 + 0.3 * rivals) * (b.town === 'oakbridge' ? 1.35 : 1);
      const t0 = b.town || 'hearthmoor', E = ECON[b.trade] || ECON.carter, key = t0 + ':' + b.trade;
      if (!dem[key]) { const sel = sellersOf(s, t0, b.trade); dem[key] = { units: townDemand(s, t0, b.trade) * (s.village.shortage && t0 === 'hearthmoor' && (b.trade === 'bakery' || b.trade === 'tavern') ? 0.7 : 1), cap: sel.reduce((a, x) => a + x.cap, 0) }; }
      const cap = bizCap(s, b), D0 = dem[key], sold = E.flat ? 0 : Math.min(cap, D0.cap ? D0.units * cap / D0.cap : 0);
      const revenue0 = E.flat ? E.flat : Math.round(sold * E.price * (t0 === 'oakbridge' ? 1.1 : 1) * (s.realm && s.realm.monopoly && s.realm.monopoly.trade === b.trade && b.owner === s.realm.monopoly.pid ? 1.3 : 1));
      // not every business does as well: a sharp owner sells more than a dull one, and any place can hit a bad spell
      // (a rival's price war, a spoiled batch, sickness in the house, a fire in the back room) that lasts a few weeks
      if (!b.slump && !E.flat && rand(s) < 0.007) { const why = ['a price war with a rival', 'a spoiled batch and a bad name', 'sickness in the house', 'a fire in the back room', 'a feud with the guild'][Math.floor(rand(s) * 5)]; b.slump = { until: s.day + 10 + Math.floor(rand(s) * 16), why }; if (b.owner === 'player') event(s, empById(id).name + ' has hit a bad spell: ' + why + '. Takings will be down for a few weeks.', 'bad'); else if (own) plog(s, own, empById(id).name + ' hit a bad spell: ' + why + '.'); }
      if (b.slump && s.day >= b.slump.until) b.slump = null;
      const knack = own && !lessee ? 0.72 + 0.3 * Math.min(1.2, own.skill || 0.9) : b.manager ? 0.6 + 0.4 * Math.min(1.3, b.manager.skill || 1) : 1;
      const revenue = Math.round(revenue0 * (E.flat ? 1 : knack * (b.slump ? 0.55 : 1)));
      b.lastSold = Math.round(sold);
      let wages = 0;
      for (const st of b.staff) {
        const w = person(s, st.pid);
        const paid = mine ? st.wage : Math.min(st.wage, Math.max(0, own.purse));
        if (mine) spend(s, paid); else own.purse -= paid;
        w.purse += paid; wages += paid;
        if (paid < st.wage) { w.mood = clamp(w.mood - 15, 0, 100); plog(s, w, 'Was not paid in full.'); }
      }
      const premises = { hearthmoor: 3, greenhaven: 4, ironcrest: 6, oakbridge: 8, eastwatch: 9, crownmere: 11 }[t0] || 3;
      const supplies = Math.round((E.flat ? revenue * 0.35 : inputCost(s, t0, b.trade, sold) + sold * E.price * 0.08) * (mine && b.manager ? 0.9 : 1)), profit = revenue - supplies - wages - premises;
      b.lastRevenue = revenue; b.lastProfit = profit; b.lastWages = wages;
      b.profits.push(profit); if (b.profits.length > 5) b.profits.shift();
      if (mine) {
        const net = revenue - supplies - premises;
        if (net >= 0) earn(s, net); else spend(s, -net);
        s.stats.owned = (s.stats.owned || 0) + profit;
        continue;
      }
      own.purse += revenue - supplies - premises;
      if (own.purse > 300) own.purse -= Math.round((own.purse - 300) * 0.12);   // a prosperous household lives well
      if (lessee) continue;
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
      b.lossDays = avg(b.profits) < 0 ? (b.lossDays || 0) + 1 : Math.max(0, (b.lossDays || 0) - 2);
      if ((own.purse <= 0 && b.profits.every(x => x < 0)) || (b.lossDays >= 20 && own.purse < 80) || b.lossDays >= 40) {
        b.closed = true;
        b.staff.slice().forEach(st => loseJob(s, person(s, st.pid), empById(id).name + ' closed its doors.'));
        loseJob(s, own, 'Their business, ' + empById(id).name + ', failed.');
        own.purse = Math.max(own.purse, 0);
        if (own.home === 'biz:' + id) { own.home = null; plog(s, own, 'Had to leave the rooms above the shop.'); }
        b.closedOn = s.day; b.lossDays = 0; b.slump = null; s.rec.bizClosed = (s.rec.bizClosed || 0) + 1;
        event(s, empById(id).name + ' has closed. ' + own.name + ' is out of work' + (own.home ? '.' : ' and out of a home.'), 'bad');
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
      const yours = p.kid && s.you && (p.parents || []).includes(s.you.pid);
      const payer = yours ? null : p.kid ? (parentsOf(s, p).find(q => q.purse > 0) || p) : p;
      const food = Math.max(0, (p.kid ? FOOD - 1 : FOOD) - p.ate); let paidFood;
      if (yours) { spend(s, food); s.stats.family = (s.stats.family || 0) + food; paidFood = food; } else { paidFood = Math.min(Math.max(0, payer.purse), food); payer.purse -= paidFood; }
      if (paidFood < food) { p.mood = clamp(p.mood - 10, 0, 100); if (!p.hungry) plog(s, p, 'Went to bed hungry.'); p.hungry = true; } else p.hungry = false;
      p.ate = 0;
      // rent
      const h = p.home && houseById(s, p.home);
      if (h && h.owner !== p.id && h.rent > 0 && rentPayer(s, h, p)) {
        // rent owed piles up: paying today does not clear what was missed before
        p.owed = (p.owed || 0) + h.rent;
        const pay = Math.min(Math.max(0, p.purse), p.owed);
        if (pay > 0) {
          p.purse -= pay; p.owed -= pay; h.taken = (h.taken || 0) + pay;
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
      const target = (p.job || p.kid ? 60 : 30) + seasonFx(s).mood + (p.home ? 15 : -20) + (p.kid ? 0 : p.purse > 30 ? 10 : p.purse < 5 ? -10 : 0) + (s.village.projects.well ? 5 : 0);
      p.mood = Math.round(clamp(p.mood + (target - p.mood) * 0.3, 0, 100));
      // debts grow: the Ashford moneylender takes 2% a day
      if (p.purse < 0) p.purse -= Math.max(1, Math.ceil(-p.purse * INTEREST));
      // savings get spent: clothes, tools, ale, tithes and feast days keep coin from piling up for ever
      else if (!p.kid && p.purse > 80) p.purse -= Math.round((p.purse - 80) * 0.03);
      p.purse = Math.round(p.purse);
      if (j && j.type === 'biz' && j.role === 'hand') p.tenure = (p.tenure || 0) + 1;
    }
  }

  /* ---------- a whole life: everyone ages, marries, has children, grows old and dies, and what they leave passes on ----------
     A year passes every few game days (s.ageRate: 0 means ageing is off). Birthdays are spread over the year, so a
     generation never all grows old at once. */
  const AGE_RATES = { off: 0, calendar: YEAR_DAYS, steady: 15, quick: 4 };
  const bdayOf = (s, p) => { const n = parseInt(String(p.id).slice(1), 10) || 0; return (n * 7 + 3) % Math.max(1, s.ageRate || 1); };
  const sameFamily = (a, b) => (a.parents || []).some(id => (b.parents || []).includes(id)) || (a.parents || []).includes(b.id) || (b.parents || []).includes(a.id);
  const childrenOf = (s, p) => Object.values(s.people).filter(q => (q.parents || []).includes(p.id));
  const surname = n => String(n).split(' ').slice(-1)[0];
  function lifeDay(s) {
    const rate = s.ageRate; if (!rate) return;
    const today = s.day % rate;
    yourBirthday(s, today);
    for (const p of living(s)) {
      if (isHousehold(p) && p.job && p.job.office !== 'lord') continue;   // the manor's servants come and go
      if (bdayOf(s, p) !== today) continue;
      p.age++;
      if (p.kid && p.age >= 16) { p.kid = false; plog(s, p, 'Came of age at sixteen.'); }
      if (!p.kid && !p.retired && p.age >= 64 + (parseInt(String(p.id).slice(1), 10) % 6) && !(p.job && (p.job.role === 'owner' || p.job.type === 'office' || p.job.type === 'manage'))) { if (p.job) loseJob(s, p, 'Retired after a long working life.'); p.retired = true; plog(s, p, 'Retired.'); }
      // the old Elder hands over the chair
      if (p.job && p.job.type === 'office' && p.job.office === 'elder' && p.age >= 72 && s.offices.elder === p.id) { loseJob(s, p, 'Stepped down as Elder in old age.'); p.retired = true; s.offices.elder = null; govLog(s, 'Elder ' + p.name + ' steps down at ' + p.age + '. The moot will choose a successor.', 'story'); }
      const die = p.age >= 95 ? 1 : p.age >= 80 ? 0.25 : p.age >= 70 ? 0.1 : p.age >= 60 ? 0.03 : p.age >= 2 ? 0.003 : 0.02;
      if (rand(s) < die) { dies(s, p); continue; }
      // grown children with work and savings set up on their own
      if (!p.kid && !p.spouse && p.age >= 19 && p.job && p.purse >= 15 && (p.parents || []).length && p.home && parentsOf(s, p).some(q => q.home === p.home)) {
        const h = vacancy(s, Math.max(1, income(s, p) - FOOD), townOf(p)); if (h) { moveOut(s, p, 'Left the family home.'); moveIn(s, p, h); }
      }
      // courtship and marriage
      if (!p.kid && !p.spouse && p.age >= 18 && p.age <= 45 && rand(s) < 0.2) {
        const sx = sexOf(p), mate = living(s).find(q => q !== p && !q.kid && !q.spouse && townOf(q) === townOf(p) && sexOf(q) !== sx && Math.abs(q.age - p.age) <= 8 && q.age >= 18 && !sameFamily(p, q) && !isHousehold(q));
        if (mate) marry(s, p, mate);
      }
      // children, spread out over the years
      if (p.spouse && sexOf(p) === 'f' && p.age >= 18 && p.age <= 42) {
        const kids = childrenOf(s, p).filter(c => c.status === 'here' && c.kid).length;
        const hh = p.home && houseById(s, p.home), full = hh && hh.tenants.length >= (hh.cap || 4);
        if (rand(s) < (full ? 0.02 : Math.max(0.03, 0.17 - kids * 0.04))) born(s, p, s.people[p.spouse]);
      }
    }
  }
  function marry(s, a, b) {
    const man = sexOf(a) === 'm' ? a : b, wife = man === a ? b : a;
    a.spouse = b.id; b.spouse = a.id;
    if (!wife.maiden) wife.maiden = wife.name;
    const nn = wife.name.split(' ')[0] + ' ' + surname(man.name); if (!Object.values(s.people).some(q => q.name === nn && q !== wife)) wife.name = nn;
    // they set up house together: in his home, hers, or somewhere new
    const hm = man.home && houseById(s, man.home), hw = wife.home && houseById(s, wife.home);
    const room = h => h && h.tenants.length < (h.cap || 4);
    if (room(hm) && !String(man.home).startsWith('biz:')) { if (wife.home && !String(wife.home).startsWith('biz:')) moveOut(s, wife, 'Moved in with ' + man.name + '.'); moveIn(s, wife, hm); wife.hh = man.id; }
    else if (room(hw)) { moveOut(s, man, 'Moved in with ' + wife.name + '.'); moveIn(s, man, hw); man.hh = wife.id; }
    else if (String(man.home).startsWith('biz:')) { moveOut(s, wife, 'Moved in above the shop.'); wife.home = man.home; }
    plog(s, man, 'Married ' + wife.name + '.'); plog(s, wife, 'Married ' + man.name + '.');
    if (townOf(a) === 'hearthmoor') event(s, man.name + ' and ' + wife.name + ' are married.', 'info');
  }
  const BABY_F = ['Alys', 'Avice', 'Edith', 'Joan', 'Mabyn', 'Nell', 'Petra', 'Sibyl', 'Una', 'Isabel', 'Muriel', 'Cecily', 'Tilly', 'Maud'], BABY_M = ['Hugh', 'Walter', 'Ralph', 'Odo', 'Simon', 'Martin', 'Ivo', 'Godwin', 'Kit', 'Wat', 'Roger', 'Gilbert', 'Jory', 'Osbert'];
  function born(s, mother, father) {
    const fem = rand(s) < 0.5, L = fem ? BABY_F : BABY_M, fam = surname((father || mother).name);
    let name = L[Math.floor(rand(s) * L.length)] + ' ' + fam; for (let k = 0; k < 6 && Object.values(s.people).some(q => q.name === name); k++) name = L[Math.floor(rand(s) * L.length)] + ' ' + fam;
    const c = newPerson(s, { name, age: 0, purse: 0, rep: 0, palette: Math.floor(rand(s) * 10), town: mother.town, sex: fem ? 'f' : 'm', born: s.day });
    c.kid = true; c.parents = [mother.id].concat(father ? [father.id] : []); c.hh = (father && father.home === mother.home ? father : mother).id;
    c.log = [{ day: s.day, text: 'Born to ' + mother.name + (father ? ' and ' + father.name : '') + '.' }];
    if (mother.home && houseById(s, mother.home)) moveIn(s, c, houseById(s, mother.home)); else c.home = mother.home;
    plog(s, mother, 'Gave birth to ' + c.name + '.'); if (father) plog(s, father, 'Became a father to ' + c.name + '.');
    if (bodyOf(s, mother)) addBody(s, c);
    if (townOf(mother) === 'hearthmoor') event(s, mother.name + (father ? ' and ' + father.name : '') + ' have a ' + (fem ? 'daughter' : 'son') + ', ' + c.name.split(' ')[0] + '.', 'info');
    return c;
  }
  // who inherits: a spouse first, then the children (adults before minors, eldest first), then brothers and sisters
  function heirsOf(s, p) {
    const sp = p.spouse && s.people[p.spouse] && s.people[p.spouse].status === 'here' ? s.people[p.spouse] : null;
    const kids = childrenOf(s, p).filter(c => c.status === 'here').sort((a, b) => b.age - a.age);
    const sibs = living(s).filter(q => q !== p && (p.parents || []).length && (q.parents || []).some(id => (p.parents || []).includes(id)) && !q.kid);
    return { spouse: sp, kids, sibs, first: sp || kids.find(c => !c.kid) || sibs[0] || kids[0] || null };
  }
  function dies(s, p) {
    p.status = 'dead'; p.died = s.day; plog(s, p, 'Died, aged ' + p.age + '.'); p.log = p.log.slice(0, 3);
    const b = bodyOf(s, p); if (b) s.agents = s.agents.filter(x => x !== b);
    const H = heirsOf(s, p), heir = H.first, town = TOWNS[townOf(p)] ? TOWNS[townOf(p)].name : 'Hearthmoor';
    const said = [];
    // coin: all to the spouse, or shared among the children, or to the next of kin
    if (p.purse > 0) {
      if (H.spouse) H.spouse.purse += p.purse; else if (H.kids.length) H.kids.forEach(c => { c.purse += Math.floor(p.purse / H.kids.length); }); else if (heir) heir.purse += p.purse;
    }
    p.purse = 0;
    // houses they owned
    for (const h of s.houses) if (h.owner === p.id) { h.owner = heir ? heir.id : (h.town ? 'town:' + h.town : 'office:lord'); said.push(h.name); }
    // their business: the heir takes it on if grown, or it shuts until someone reopens it
    if (p.job && p.job.type === 'biz' && p.job.role === 'owner') {
      const bz = s.biz[p.job.biz], adult = heir && !heir.kid ? heir : (H.kids.find(c => !c.kid) || null);
      if (bz && adult) { if (adult.job) loseJob(s, adult, 'Left their work to take over ' + empById(bz.id).name + '.'); bz.owner = adult.id; bz.staff = bz.staff.filter(x => x.pid !== adult.id); adult.job = { type: 'biz', biz: bz.id, role: 'owner' }; plog(s, adult, 'Inherited ' + empById(bz.id).name + '.'); said.push(empById(bz.id).name); }
      else if (bz) { bz.closed = true; bz.staff.forEach(x => { const w = s.people[x.pid]; if (w) { w.job = null; plog(s, w, empById(bz.id).name + ' closed when ' + p.name + ' died.'); } }); bz.staff = []; }
      p.job = null;
    }
    // offices fall vacant and are filled their own way; a lordship passes to a grown child, with the crown's recognition
    if (p.job && p.job.type === 'office') {
      const off = p.job.office; p.job = null;
      if (off === 'lord') { const ch = H.kids.find(c => !c.kid); if (ch) { s.offices.lord = null; appoint(s, 'lord', ch.id); ch.home = 'manor'; govLog(s, ch.name + ' succeeds as lord of Hearthmoor, recognised by ' + REALM.king + '.', 'story'); } else { s.offices.lord = p.id; replaceLord(s, 'he has died without an heir'); } }
      else if (s.offices[off] === p.id) { s.offices[off] = null; if (off === 'elder') govLog(s, 'Elder ' + p.name + ' has died. The moot will choose a successor.', 'story'); }
    } else if (p.job) loseJob(s, p, 'Died.');
    for (const id in (s.towns || {})) { const T = s.towns[id]; if (T.mayor === p.id) { T.mayor = null; T.nextVote = s.day + 1; townLog(s, Object.assign(T, { id }), (T.title || 'Mayor') + ' ' + p.name + ' has died. The town will vote for a successor tomorrow.'); } T.council = T.council.filter(x => x !== p.id); }
    if (s.gov) s.gov.council = s.gov.council.filter(x => x !== p.id);
    for (const sh of s.shops) if (sh.worker && sh.worker.pid === p.id) { sh.worker = null; event(s, p.name + ', who worked at your ' + TRADES[sh.trade].name.toLowerCase() + ', has died.', 'bad'); }
    if (p.home && houseById(s, p.home)) { const h = houseById(s, p.home); h.tenants = h.tenants.filter(x => x !== p.id); }
    if (s.you && s.you.spouse === p.id) { s.you.spouse = null; s.you.widowed = p.id; event(s, 'Your ' + (sexOf(p) === 'f' ? 'wife' : 'husband') + ', ' + p.name + ', has died, aged ' + p.age + '.', 'story'); }
    if (H.spouse) { H.spouse.spouse = null; H.spouse.widowed = p.id; H.spouse.mood = clamp(H.spouse.mood - 30, 0, 100); plog(s, H.spouse, 'Widowed: ' + p.name + ' has died.'); }
    if (p.hh) { /* their household carries on under whoever is left */ }
    living(s).filter(q => q.hh === p.id).forEach(q => { q.hh = H.spouse ? H.spouse.id : null; });
    for (const k of ['job', 'home', 'purse', 'mood', 'opinion', 'arrears', 'homeless', 'ate', 'retired', 'skill']) p[k] = PERSON_TEMPLATE[k];
    for (const k of ['owed', 'hungry', 'tenure', 'hh']) delete p[k];
    event(s, p.name + ' of ' + town + ' has died, aged ' + p.age + '.' + (heir ? ' ' + heir.name + ' inherits' + (said.length ? ' ' + said.join(' and ') : '') + '.' : ''), townOf(p) === 'hearthmoor' ? 'story' : 'info');
  }

  /* ---------- your own life: courtship, marriage, children, and who carries on after you ----------
     You have a record among the people (status 'you') so family trees can include you; your heir becomes you. */
  function you(s) {
    if (!s.you) s.you = { age: 22, bday: 1, spouse: null, court: {}, heir: null, hoping: true, generation: 1, family: null, sex: s.look && s.look.body === 'f' ? 'f' : 'm', lastTalk: {} };
    const Y = s.you;
    if (!Y.pid || !s.people[Y.pid]) { const r = newPerson(s, { name: s.name, age: Y.age, purse: 0, sex: Y.sex, palette: 0 }); r.status = 'you'; r.log = [{ day: s.day, text: 'Came to Hearthmoor with nothing.' }]; Y.pid = r.id; }
    const r = s.people[Y.pid]; r.name = s.name; r.age = Y.age; r.sex = Y.sex; r.spouse = Y.spouse;
    return Y;
  }
  const familyName = s => { const Y = you(s); return Y.family || (s.name.includes(' ') ? surname(s.name) : s.name); };
  const yourKids = s => { const Y = you(s); return Object.values(s.people).filter(q => (q.parents || []).includes(Y.pid)); };
  const canCourt = (s, q) => { const Y = you(s); return q && q.status === 'here' && !q.kid && q.age >= 18 && !q.spouse && !Y.spouse && sexOf(q) !== Y.sex && !isHousehold(q) && !(q.parents || []).includes(Y.pid); };
  function yourBirthday(s, today) {
    const Y = you(s); if (s.pendingDeath || Y.bday % s.ageRate !== today) return;
    Y.age++; s.people[Y.pid].age = Y.age;
    if (Y.regent && Y.age >= 16) { event(s, 'You come of age at 16. ' + Y.regent.name + '\u2019s regency ends: the family\u2019s affairs are yours to run.', 'story'); Y.regent = null; const me = s.people[Y.pid]; if (me) me.kid = false; }
    const die = Y.age >= 95 ? 1 : Y.age >= 80 ? 0.22 : Y.age >= 70 ? 0.08 : Y.age >= 60 ? 0.02 : 0;
    if (rand(s) < die) { s.pendingDeath = { day: s.day, age: Y.age }; event(s, 'You have died, aged ' + Y.age + '. Your story passes on.', 'story'); return; }
    if (Y.age === 60 || Y.age === 70) event(s, 'You turn ' + Y.age + '. It may be time to think about who carries on after you: see the Family page.', 'story');
    // children, if you and your spouse are hoping for them
    const sp = Y.spouse && s.people[Y.spouse];
    if (sp && sp.status === 'here' && Y.hoping) {
      const mother = Y.sex === 'f' ? Y : sp, mAge = mother === Y ? Y.age : sp.age, kids = yourKids(s).filter(c => c.kid && c.status === 'here').length;
      if (mAge >= 18 && mAge <= 42 && rand(s) < Math.max(0.15, 0.55 - kids * 0.06)) yourChild(s, sp);
    }
  }
  function yourChild(s, sp) {
    const Y = you(s), fem = rand(s) < 0.5, L = fem ? BABY_F : BABY_M, fam = familyName(s);
    let name = L[Math.floor(rand(s) * L.length)] + ' ' + fam; for (let k = 0; k < 8 && Object.values(s.people).some(q => q.name === name); k++) name = L[Math.floor(rand(s) * L.length)] + ' ' + fam;
    const c = newPerson(s, { name, age: 0, purse: 0, rep: 0, palette: Math.floor(rand(s) * 10), sex: fem ? 'f' : 'm', born: s.day, home: 'you' });
    c.kid = true; c.parents = [Y.pid, sp.id]; c.log = [{ day: s.day, text: 'Born to ' + s.name + ' and ' + sp.name + '.' }];
    plog(s, sp, 'Had a ' + (fem ? 'daughter' : 'son') + ', ' + c.name.split(' ')[0] + ', with ' + s.name + '.');
    if (bodyOf(s, sp) || !s.bodiesIn || s.bodiesIn === 'hearthmoor') addBody(s, c);
    event(s, 'You and ' + sp.name + ' have a ' + (fem ? 'daughter' : 'son') + ': ' + c.name + '.', 'story');
    return c;
  }
  function wedYou(s, q) {
    const Y = you(s); Y.spouse = q.id; q.spouse = Y.pid; Y.court = {};
    if (q.job && q.job.type === 'office' && HOUSEHOLD.includes(q.job.office)) loseJob(s, q, 'Left the manor to marry.');
    if (q.home && q.home !== 'you') moveOut(s, q, 'Moved in with ' + s.name + '.');
    { const T = yourTown(s); if (townOf(q) !== (T || 'hearthmoor')) { if (q.job && (q.job.type !== 'biz' || q.job.role !== 'owner')) loseJob(s, q, 'Left their work to move to ' + (T ? TOWNS[T].name : 'Hearthmoor') + '.'); q.town = T; } }
    q.home = 'you'; q.opinion = clamp((q.opinion || 0) + 30, -100, 100);
    if (Y.sex === 'm' && sexOf(q) === 'f') { q.maiden = q.maiden || q.name; const nn = q.name.split(' ')[0] + ' ' + familyName(s); if (!Object.values(s.people).some(x => x.name === nn)) q.name = nn; }
    plog(s, q, 'Married ' + s.name + '.'); s.people[Y.pid].log.unshift({ day: s.day, text: 'Married ' + q.name + '.' });
    addStanding(s, 5, 'the village celebrated your wedding.');
  }
  function yourHeirs(s) {
    const Y = you(s), sp = Y.spouse && s.people[Y.spouse], kids = yourKids(s).filter(c => c.status === 'here').sort((a, b) => b.age - a.age);
    const named = Y.heir && s.people[Y.heir] && s.people[Y.heir].status === 'here' ? s.people[Y.heir] : null;
    const me = s.people[Y.pid], sibs = me && (me.parents || []).length ? living(s).filter(q => (q.parents || []).some(id => me.parents.includes(id))).sort((a, b) => b.age - a.age) : [];
    const spo = sp && sp.status === 'here' ? sp : null;
    return { named, kids, spouse: spo, sibs, best: named || kids.find(c => !c.kid) || spo || sibs.find(c => !c.kid) || kids[0] || sibs[0] || null };
  }
  // what passes on: coin and property by the inheritance rules; offices fall vacant; a lordship passes to a grown child of the blood
  function inheritPreview(s, h) {
    const out = [(s.coins < 0 ? 'your debt of ' + (-s.coins) + 'c' : s.coins + 'c in coin')];
    if (s.shops.length) out.push(s.shops.length + (s.shops.length === 1 ? ' shop' : ' shops'));
    const bz = Object.values(s.biz || {}).filter(b => b.owner === 'player').length; if (bz) out.push(bz + (bz === 1 ? ' business' : ' businesses'));
    const hs = s.houses.filter(x => x.owner === 'player').length; if (hs) out.push(hs + (hs === 1 ? ' house' : ' houses'));
    if (s.player.horse) out.push('your horse ' + s.player.horse.name);
    const notes = [];
    if (s.offices.elder === 'player') notes.push('The Elder\u2019s chair is elected: it falls vacant and the moot chooses.');
    if (s.offices.lord === 'player') notes.push(h && (h.parents || []).includes(you(s).pid) && !h.kid ? 'The lordship passes to ' + h.name + ', with the crown\u2019s recognition.' : 'The lordship needs a grown child of your blood; without one it passes out of the family.');
    if (s.village.council) notes.push('Your seat on the village council falls vacant; ' + (h ? h.name : 'your heir') + ' starts with part of your standing and can win it back at a moot (standing 40).');
    return { gets: out, notes };
  }
  function succeed(s, h, why) {
    const Y = you(s), old = s.people[Y.pid], v = s.village, wasLord = s.offices.lord === 'player';
    // the one who came before joins the dead (or retires to live with the family)
    old.name = s.name; old.age = Y.age; old.spouse = Y.spouse;
    if (why === 'retire') { old.status = 'here'; old.retired = true; old.home = 'you'; old.town = undefined; old.purse = 0; old.rep = Math.round(v.standing * 0.8); old.log.unshift({ day: s.day, text: 'Handed everything to ' + h.name + ' and retired.' }); addBody(s, old); }
    else { old.status = 'dead'; old.died = s.day; old.log.unshift({ day: s.day, text: 'Died, aged ' + Y.age + '.' }); const sp = Y.spouse && s.people[Y.spouse]; if (sp) { sp.spouse = null; sp.widowed = old.id; } }
    // offices: the Elder's chair is elected, so it falls vacant; the lordship passes only to a grown child of the blood
    if (s.offices.elder === 'player') { s.offices.elder = null; govLog(s, 'The Elder\u2019s chair stands empty. The moot will choose.', 'story'); }
    if (wasLord) { if ((h.parents || []).includes(Y.pid) && !h.kid) { /* kept below */ } else { s.offices.lord = null; replaceLord(s, 'the old lord is gone and no child of the blood can take the title'); } }
    if (s.offices.steward === 'player') s.offices.steward = null;
    // the realm: lordships and the crown pass to a grown child of the blood, with the crown's recognition; council seats are given, not inherited
    if (s.realm) {
      const R = s.realm, blood = (h.parents || []).includes(Y.pid) && !h.kid;
      for (const k in COUNCIL) if (R.council[k] === 'player') R.council[k] = noble(s, { name: nameForNoble(s), age: 50, town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[k] + ' after ' + s.name + ' died.' }).id;
      for (const id in R.regions) if (R.regions[id].lord === 'player') { if (blood && (R.favour >= 20 || isRuler(s))) realmLog(s, h.name + ' inherits ' + REGIONS[id] + ', and the crown recognises the claim.', 'story'); else { R.regions[id].lord = null; realmLog(s, 'The lordship of ' + REGIONS[id] + ' returns to the crown: ' + (blood ? 'the court does not recognise the heir' : 'no child of the blood can take it') + '.', 'story'); } }
      if (isRuler(s) && !blood) { R.crown = 'king'; succession(s, 'The ruler of Alderwyn has died without a child of the blood'); }
      if (s.player.seat && regionLord(s, s.player.seat) !== 'player') s.player.seat = null;
      else if (isRuler(s)) realmLog(s, h.name + ' is crowned ruler of Alderwyn in the Great Hall of the Realm.', 'story');
    }
    // the heir steps into your shoes: your coin and property, their own purse, part of your standing, and the town's memory of your family
    const b = bodyOf(s, h); if (b) { s.player.x = b.x; s.player.z = b.z; s.agents = s.agents.filter(x => x !== b); }
    if (h.job) loseJob(s, h, 'Gave up their work to take on the family\u2019s affairs.');
    if (h.home && h.home !== 'you') moveOut(s, h, 'Moved into the family home.');
    s.coins += Math.max(0, h.purse); h.purse = 0;
    const prev = s.name; s.name = h.name; s.job = null; s.player.dest = null; s.player.action = null;
    Y.regent = null;
    if (h.age < 16 && s.ageRate) {
      const rg = [Y.spouse && s.people[Y.spouse], ...living(s).filter(q => !q.kid && q.age >= 18 && (q.parents || []).some(x => (h.parents || []).includes(x)) && q.id !== h.id)].find(q => q && q.status === 'here');
      Y.regent = { pid: rg ? rg.id : null, name: rg ? rg.name : 'the village council' };
      event(s, h.name + ' is only ' + h.age + '. ' + (rg ? rg.name : 'The village council') + ' will act as regent, running the family\u2019s affairs, until ' + h.name.split(' ')[0] + ' comes of age at 16.', 'story');
    }
    if (v.council) { v.council = false; govLog(s, 'Your seat on the village council falls vacant. The moot will choose again: ' + h.name + ' can win it back.', 'story'); }
    Y.age = h.age < 16 && s.ageRate ? h.age : Math.max(16, h.age); Y.sex = sexOf(h); Y.spouse = h.spouse && s.people[h.spouse] && s.people[h.spouse].status === 'here' ? h.spouse : null; Y.heir = null; Y.court = {}; Y.generation++; Y.family = surname(h.name);
    if (Y.spouse) { const sp = s.people[Y.spouse]; sp.spouse = h.id; if (sp.home !== 'you') { moveOut(s, sp, 'Moved in with ' + h.name + '.'); sp.home = 'you'; } }
    // the heir's own record becomes yours; your children stay listed as theirs
    h.status = 'you'; h.kid = false; h.town = undefined; Y.pid = h.id; h.log.unshift({ day: s.day, text: why === 'retire' ? 'Took over from ' + prev + '.' : 'Inherited everything from ' + prev + '.' });
    v.standing = Math.round(v.standing * 0.4 + (h.rep || 0) * 0.3);
    if (v.standing < 40 && v.council && s.gov) { v.council = false; s.gov.lostSeatDay = s.day; }
    for (const q of Object.values(s.people)) if (q.status === 'here' && q.id !== h.id) q.opinion = Math.round((q.opinion || 0) * 0.5);
    if (wasLord && s.offices.lord === 'player') govLog(s, h.name + ' succeeds ' + prev + ' as lord of Hearthmoor, recognised by ' + REALM.king + '.', 'story');
    s.rec.generations = Y.generation;
    s.pendingDeath = null;
    event(s, (why === 'retire' ? prev + ' hands everything to ' : 'You carry on as ') + h.name + ', aged ' + Y.age + '. Generation ' + Y.generation + ' of the family.', 'story');
  }
  // with nobody to carry on: the family's property goes back to the lord and the town, and you begin again as a newcomer
  function beginAgain(s, name, sex) {
    const Y = you(s), old = s.people[Y.pid];
    old.name = s.name; old.status = 'dead'; old.died = s.day; old.log.unshift({ day: s.day, text: 'Died, aged ' + Y.age + ', leaving no heir.' });
    if (s.offices.elder === 'player') s.offices.elder = null;
    if (s.offices.lord === 'player') { s.offices.lord = null; replaceLord(s, 'the old lord died without an heir'); }
    if (s.realm) { const R = s.realm; for (const k in COUNCIL) if (R.council[k] === 'player') R.council[k] = noble(s, { name: nameForNoble(s), age: 50, town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[k] + '.' }).id; for (const id in R.regions) if (R.regions[id].lord === 'player') R.regions[id].lord = null; if (isRuler(s)) { R.crown = 'king'; succession(s, 'The ruler of Alderwyn has died without an heir'); } R.favour = 0; R.exile = null; s.player.house = null; s.player.seat = null; }
    s.houses.filter(h => h.owner === 'player').forEach(h => { h.owner = 'office:lord'; });
    Object.values(s.biz || {}).filter(b => b.owner === 'player').forEach(b => { b.closed = true; b.manager = null; });
    s.shops.slice().forEach(sh => { if (sh.worker && sh.worker.pid && s.people[sh.worker.pid]) s.people[sh.worker.pid].job = null; });
    s.shops = []; s.coins = 5; s.job = null; s.village.council = false; s.village.standing = 0; s.player.horse = null; s.player.riding = false;
    s.name = name || 'Wren'; s.player.x = P.home.x; s.player.z = P.home.z;
    const gen = Y.generation; s.you = null; const Z = you(s); Z.generation = gen + 1; Z.sex = sex || 'm'; Z.age = 20; if (s.name.includes(' ')) Z.family = s.name.split(' ').slice(1).join(' ');
    s.pendingDeath = null;
    event(s, 'A newcomer arrives in Hearthmoor with 5 coins: ' + s.name + '. The world remembers those who came before.', 'story');
  }

  /* ---------- how are we related? ---------- */
  function ancestors(s, id) { const out = new Map(), q = [[id, 0]]; while (q.length) { const [x, d] = q.shift(); const p = s.people[x]; if (!p || d > 8) continue; for (const pid of p.parents || []) if (!out.has(pid)) { out.set(pid, d + 1); q.push([pid, d + 1]); } } return out; }
  function bloodRelation(s, a, b) {
    if (a === b) return 'self';
    const A = ancestors(s, a), B = ancestors(s, b), pb = s.people[b], f = sexOf(pb) === 'f';
    const greats = n => n > 0 ? 'great-'.repeat(n) : '';
    if (A.has(b)) { const d = A.get(b); return d === 1 ? (f ? 'mother' : 'father') : greats(d - 2) + (f ? 'grandmother' : 'grandfather'); }
    if (B.has(a)) { const d = B.get(a); return d === 1 ? (f ? 'daughter' : 'son') : greats(d - 2) + (f ? 'granddaughter' : 'grandson'); }
    let best = null; for (const [x, da] of A) if (B.has(x)) { const db = B.get(x); if (!best || da + db < best[0] + best[1]) best = [da, db]; }
    if (!best) return null;
    const [da, db] = best;
    if (da === 1 && db === 1) { const shared = (s.people[a].parents || []).filter(x => (pb.parents || []).includes(x)).length; return (shared < 2 && ((s.people[a].parents || []).length > 1 || (pb.parents || []).length > 1) ? 'half-' : '') + (f ? 'sister' : 'brother'); }
    if (da === 1) return greats(db - 2) + (f ? 'niece' : 'nephew');
    if (db === 1) return greats(da - 2) + (f ? 'aunt' : 'uncle');
    const deg = Math.min(da, db) - 1, rem = Math.abs(da - db), ord = ['', 'first', 'second', 'third', 'fourth', 'fifth'][deg] || deg + 'th';
    return ord + ' cousin' + (rem ? (rem === 1 ? ' once removed' : rem === 2 ? ' twice removed' : ' ' + rem + ' times removed') : '');
  }
  // b is a's ___
  function relation(s, a, b) {
    const pa = s.people[a], pb = s.people[b]; if (!pa || !pb) return null;
    const r = bloodRelation(s, a, b); if (r) return r;
    const f = sexOf(pb) === 'f';
    if (pa.spouse === b || pb.spouse === a) return f ? 'wife' : 'husband';
    if (pa.widowed === b || pb.widowed === a) return 'late ' + (f ? 'wife' : 'husband');
    // in-laws: through a's spouse, or through b's spouse
    const sa = pa.spouse || pa.widowed;
    if (sa) { const r2 = bloodRelation(s, sa, b); if (r2 && ['mother', 'father', 'sister', 'brother', 'half-sister', 'half-brother'].includes(r2)) return r2 + '-in-law'; if (r2 === 'son' || r2 === 'daughter') return 'step' + r2; }
    const sb = pb.spouse || pb.widowed;
    if (sb) { const r3 = bloodRelation(s, a, sb); if (r3 === 'son' || r3 === 'daughter') return f ? 'daughter-in-law' : 'son-in-law'; if (r3 && /sister|brother/.test(r3)) return (f ? 'sister' : 'brother') + '-in-law'; if (r3 === 'mother' || r3 === 'father') return f ? 'stepmother' : 'stepfather'; if (r3 === 'uncle' || r3 === 'aunt') return f ? 'aunt by marriage' : 'uncle by marriage'; if (r3) return r3 + '\u2019s ' + (f ? 'wife' : 'husband'); }
    return null;
  }

  /* each morning: the jobless look for work, the homeless for a roof, and some give up */
  function peopleMorning(s) {
    lifeDay(s);
    for (const k of living(s).filter(q => q.kid)) {
      if (s.you && (k.parents || []).includes(s.you.pid)) { if (k.home !== 'you') { if (k.home && houseById(s, k.home)) moveOut(s, k, 'Came home.'); k.home = 'you'; } continue; }
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
        const here = townOf(p), shutOk = b => b.closed && (b.town || 'hearthmoor') === here && b.owner !== 'player' && s.day - (b.closedOn || 0) >= 6, shut = Object.values(s.biz).find(b => shutOk(b) && b.trade === s.biz[p.job.biz].trade) || Object.values(s.biz).find(shutOk);
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
    // newcomers arrive when there is a roof to be had: a lone worker, or a young family from Ashford.
    // A village that is shrinking draws them in faster; a crowded one, hardly at all.
    const jobless = villagers(s).filter(idleAdult).length, pop = villagers(s).length, roof = vacancy(s, 4);
    if (roof && (jobless <= 2 || pop < 34) && rand(s) < (pop < 30 ? 0.5 : pop < 34 ? 0.3 : pop < 40 ? 0.08 : 0.02)) {
      const SUR = ['Ashby', 'Brook', 'Carter', 'Fletcher', 'Mason', 'Wright', 'Cooper', 'Hayward', 'Fowler', 'Reeve', 'Webb', 'Lowe', 'Pike', 'Thorne', 'Woodall', 'Rook'];
      const used = new Set(Object.values(s.people).map(p => p.name)), pickName = (L, fam) => { for (let k = 0; k < 12; k++) { const n = L[Math.floor(rand(s) * L.length)] + ' ' + fam; if (!used.has(n)) { used.add(n); return n; } } return null; };
      const fam = SUR[Math.floor(rand(s) * SUR.length)], family = roof.cap - roof.tenants.length >= 2 && rand(s) < 0.65;
      const a = pickName(BABY_M, fam), b = family ? pickName(BABY_F, fam) : null;
      if (a) {
        const man = newPerson(s, { name: a, age: 20 + Math.floor(rand(s) * 12), purse: 70, sex: 'm', job: { type: 'commons', what: ['field', 'forest', 'pit'][Math.floor(rand(s) * 3)] } }); moveIn(s, man, roof); plog(s, man, 'Arrived from Ashford looking for work, with some savings.'); addBody(s, man, P.road);
        let who = a;
        if (b) {
          const wife = newPerson(s, { name: b, age: man.age - 2 + Math.floor(rand(s) * 4), purse: 40, sex: 'f', job: rand(s) < 0.6 ? { type: 'commons', what: 'field' } : null }); wife.spouse = man.id; man.spouse = wife.id; moveIn(s, wife, roof); plog(s, wife, 'Came to Hearthmoor with her husband ' + a + '.'); addBody(s, wife, P.road);
          const kids = Math.min(roof.cap - roof.tenants.length, Math.floor(rand(s) * 3));
          for (let k = 0; k < kids; k++) { const f = rand(s) < 0.5, n = pickName(f ? BABY_F : BABY_M, fam); if (!n) break; const c = newPerson(s, { name: n, age: 1 + Math.floor(rand(s) * 9), purse: 0, sex: f ? 'f' : 'm' }); c.kid = true; c.parents = [wife.id, man.id]; c.hh = man.id; moveIn(s, c, roof); plog(s, c, 'Came to Hearthmoor with the family.'); addBody(s, c, P.road); }
          who = 'The ' + fam + ' family';
        }
        s.rec.newcomers = (s.rec.newcomers || 0) + 1;
        event(s, who + (b ? ' have' : ' has') + ' arrived from Ashford and moved into ' + roof.name + '.', 'info');
      }
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
    if (!inA || !OAK.bridge) return tgt;
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
      else if (j.office === 'keeper' && h >= 8 && h < 17) { tgt = ringSpot(LOCS.granary.x, LOCS.granary.z + 3, 0.5, 2, a.id, s.day, 49); doing = 'Keeping the granary'; working = true; }
      else if (j.office === 'watch' && h >= 7 && h < 20) { tgt = ringSpot(LOCS.bridge.x, LOCS.bridge.z, 1, 3, a.id, s.day, 51); doing = 'Keeping watch on the east road'; working = true; }
      else if (j.office === 'keeper' || j.office === 'watch') { tgt = null; }
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
    const need = 1 + (v.towerBuilt ? 1 : 0) + Math.floor(Object.keys(v.projects).length / 2) + (v.land && v.land.state === 'done' ? 1 : 0);
    // the village works: the Elder decides how much goes on upkeep; too little and things fall apart, more and the village thrives
    const pe = s.offices.elder === 'player', works = pe && g.works != null ? g.works : need;
    v.chest -= works; g.worksNeed = need; g.worksToday = works;
    if (works < need) {
      g.neglect = (g.neglect || 0) + (need - works); approve(s, 'elder', -Math.min(1.5, (need - works) * 0.4));
      const built = Object.keys(v.projects);
      if (g.neglect >= 8 && built.length) { const k = built[Math.floor(rand(s) * built.length)]; delete v.projects[k]; v.broken = v.broken || {}; v.broken[k] = true; g.neglect = 0; govLog(s, PROJECTS[k].name + ' has fallen into disrepair for want of upkeep. Mending it costs half what it took to build.', 'bad'); }
    } else { g.neglect = Math.max(0, (g.neglect || 0) - 1); if (works > need) approve(s, 'elder', Math.min(1.2, (works - need) * 0.25)); }
    // the officers the Elder appoints are paid from the chest
    for (const off of ['keeper', 'watch']) { const id = s.offices[off]; if (!id) continue; const q = s.people[id]; if (!q || q.status !== 'here' || !q.job || q.job.office !== off) { s.offices[off] = null; continue; } v.chest -= OFFICES[off].chestPay; q.purse += OFFICES[off].chestPay; }
    if (v.land && v.land.state === 'done' && v.land.use === 'pasture') v.chest += 2;
    if (v.land && v.land.state === 'building' && s.day >= v.land.doneDay) finishLand(s);
    const up = works;
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
    // the open land: a growing village wants homes
    if (!v.land && s.day >= 12 && v.chest >= LAND_USES.cottages.cost + 25 && rand(s) < 0.15) { startLand(s, 'cottages'); approve(s, 'elder', 4); govLog(s, 'Elder ' + e.name + ' opens the common land for three new cottages, paid from the chest.', 'good'); }
    // officers: a keeper when the granary runs short, a watchman when the chest can bear it
    if (!s.offices.keeper && v.shortage && v.chest > 20) { const c = officerCandidates(s)[0]; if (c) { appointOfficer(s, 'keeper', c); govLog(s, 'Elder ' + e.name + ' appoints ' + c.name + ' Granary Keeper.', 'info'); } }
    if (!s.offices.watch && v.chest > 70 && rand(s) < 0.1) { const c = officerCandidates(s)[0]; if (c) { appointOfficer(s, 'watch', c); govLog(s, 'Elder ' + e.name + ' appoints ' + c.name + ' Village Watchman.', 'info'); } }
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
  function officerCandidates(s) {
    return villagers(s).filter(p => !p.kid && !p.retired && p.age >= 20 && p.age <= 60 && !isHousehold(p) && (!p.job || p.job.type === 'commons') && p.status === 'here')
      .sort((a, b) => (b.rep || 0) - (a.rep || 0)).slice(0, 4);
  }
  function appointOfficer(s, off, p) {
    const old = s.offices[off] && s.people[s.offices[off]]; if (old && old.job && old.job.office === off) { old.job = null; plog(s, old, 'Replaced as ' + OFFICES[off].title + '.'); }
    p.job = { type: 'office', office: off }; s.offices[off] = p.id; p.opinion = clamp((p.opinion || 0) + (s.offices.elder === 'player' ? 15 : 0), -100, 100);
    plog(s, p, 'Appointed ' + OFFICES[off].title + ' by ' + elderTitle(s) + '.');
  }
  function startLand(s, use) { const U = LAND_USES[use]; s.village.chest -= U.cost; s.village.land = { use, state: 'building', doneDay: s.day + U.days, started: s.day }; }
  function finishLand(s) {
    const v = s.village, L = v.land; L.state = 'done';
    if (L.use === 'cottages') {
      const fams = ['Ashdown', 'Pryor', 'Tilney'], firsts = [['Gilbert', 'Avice'], ['Hamo', 'Rohese'], ['Simon', 'Nesta']];
      NEW_COTTAGES.forEach((c, i) => {
        const h = { id: 'hn' + i, name: c.name, x: c.x, z: c.z, owner: 'office:lord', rent: 3, cap: 4, tenants: [] }; s.houses.push(h);
        const a = newPerson(s, { name: firsts[i][0] + ' ' + fams[i], age: 26 + i * 6, purse: 30, palette: i + 2, job: { type: 'commons', what: ['field', 'forest', 'pit'][i] } }); moveIn(s, a, h);
        const b = newPerson(s, { name: firsts[i][1] + ' ' + fams[i], age: 24 + i * 6, purse: 20, palette: i + 5, job: i === 1 ? null : { type: 'commons', what: 'field' } }); moveIn(s, b, h);
        a.spouse = b.id; b.spouse = a.id; b.hh = a.id;
        const k = newPerson(s, { name: ['Wat', 'Tibby', 'Kit'][i] + ' ' + fams[i], age: 4 + i * 2, purse: 0, palette: i }); k.kid = true; k.parents = [a.id, b.id]; k.hh = a.id; moveIn(s, k, h);
        [a, b, k].forEach(p => { p.log = [{ day: s.day, text: 'Moved into ' + c.name + ' on the new common land.' }]; p.rep = 15; if (s.bodiesIn === 'hearthmoor' || !s.bodiesIn) addBody(s, p); });
      });
      govLog(s, 'The new cottages on the common land are finished. Three families move in: the Ashdowns, the Pryors and the Tilneys.', 'good');
    } else govLog(s, 'The common pasture is fenced and open. Field hands earn a little more, and grazing fees go to the chest.', 'good');
    approve(s, 'elder', 5);
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
    { const v = s.village; if (v.step >= 6 && !v.council && v.standing >= 40 && !(you(s).regent)) { v.council = true; addStanding(s, 4, 'the moot returns you to the village council.'); } }
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
      if (g.petitions >= 2) { notes.push('A second petition against ' + lordTitle(s) + ' goes to King Aldwin in Crownmere.'); after.push(() => replaceLord(s, 'the village petitioned the King against him twice')); }
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
      // failing that, the most respected grown villager is talked into standing
      if (!cands.length) { const any = villagers(s).filter(p => p.id !== exclude && !isHousehold(p) && !p.kid && p.age >= 25 && p.age <= 70 && p.status === 'here').sort((a, b) => (b.rep || 0) - (a.rep || 0) || (b.opinion || 0) - (a.opinion || 0))[0]; if (any) cands.push(any); }
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
    else { heir = newPerson(s, { name: ['Aldous Penrith', 'Hamon Grey', 'Bertram Ashe'][Math.floor(rand(s) * 3)], age: 40 + Math.floor(rand(s) * 12), purse: 300, palette: 2 }); heir.log.push({ day: s.day, text: 'Sent from Crownmere by King Aldwin to hold Hearthmoor.' }); }
    const oldName = old ? old.name : 'the lord';
    appoint(s, 'lord', heir.id);
    if (old) { old.rep = Math.max(0, (old.rep || 0) - 40); plog(s, old, 'Stripped of Hearthmoor by the King: ' + why + '.'); if (!old.home && old.status === 'here') { const h = vacancy(s, 99); if (h) moveIn(s, old, h); } }
    g.approval.lord = 55; g.petitions = 0; g.lordDebtDays = 0;
    let msg = 'King Aldwin strips ' + oldName + ' of Hearthmoor: ' + why + '. ' + heir.name + (heir === stw ? ', the steward who ran his estate,' : ', a knight from Crownmere,') + ' is the new Lord.';
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
      orchard: { x: orchard.x, z: orchard.z, rx: 8, rz: 6 }, hedging: { x: -195, z: -880, rx: 14, rz: 3 },
      gh_watch: { x: green.x, z: green.z, rx: 7, rz: 7 }
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
  const GH_JOBS = { gh_watch: ['Watchman', 'Keeping watch on the green'], ghfields: ['Field hand', 'Working the wheat fields'], ghfields2: ['Field hand', 'Hoeing the barley'], shepherd: ['Shepherd', 'Minding the sheep'], cowherd: ['Cowherd', 'Minding the cattle'], orchard: ['Orchard hand', 'Tending the orchard'], hedging: ['Hedger', 'Laying the hedges'] };
  Object.assign(BIZ_BASE, { dairy: 22, estate: 40 });
  /* ---------- Crownmere: the capital of Alderwyn (Stage IV) ----------
     A walled city of seven wards on the south shore of Crown Lake, beneath the mountains: Castle Hill and the
     royal castle on the lake to the north-west, the Court Quarter of the great houses, the Great Market at the
     heart, the Guild Ward to the east, the Lakeside quays, the crowded Old Town, and the South Ward inside the
     main gate where the roads from Oakbridge and Greenhaven come in. */
  const LAKE = { x: 300, z: -1300, rx: 190, rz: 95 };
  const inLake = (x, z, m) => ((x - LAKE.x) / (LAKE.rx + (m || 0))) ** 2 + ((z - LAKE.z) / (LAKE.rz + (m || 0))) ** 2 < 1;
  const CM = (function () {
    const C = { x: 215, z: -1010 };
    let sd = 777; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const segD = (x, z, pts) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return best; };
    const riverDist = (x, z) => segD(x, z, RIVER);
    const lakeDist = (x, z) => { const k = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz); return (k - 1) * Math.min(LAKE.rx, LAKE.rz); };
    // the wards: squares and their landmarks
    const market = { x: C.x, z: C.z, r: 32, name: 'the Great Market' };
    const courtSq = { x: C.x - 92, z: C.z - 90, r: 18, name: 'Court Square' };
    const guildSq = { x: C.x + 110, z: C.z - 30, r: 20, name: 'Guild Square' };
    const southSq = { x: C.x + 10, z: C.z + 150, r: 20, name: 'the South Ward square' };
    const oldSq = { x: C.x + 110, z: C.z + 95, r: 13, name: 'Old Town Well' };
    const castle = { x: C.x - 150, z: C.z - 185, face: 0.35 };
    const quay = { x0: C.x - 30, x1: C.x + 170 };
    const gS = { x: C.x + 20, z: C.z + 232 }, gW = { x: C.x - 236, z: C.z + 20 };
    const streets = [
      { name: 'Kingsway', w: 7, pts: [[gS.x, gS.z - 2], [southSq.x, southSq.z], [market.x + 4, market.z + 30], [market.x - 10, market.z - 30], [courtSq.x + 16, courtSq.z + 10], [castle.x + 20, castle.z + 42]] },
      { name: 'West Gate Road', w: 5.5, pts: [[gW.x + 2, gW.z], [C.x - 140, C.z + 14], [market.x - 32, market.z + 4]] },
      { name: 'Guild Street', w: 5, pts: [[market.x + 32, market.z - 6], [guildSq.x - 20, guildSq.z + 4]] },
      { name: 'Lake Street', w: 5, pts: [[market.x + 8, market.z - 32], [C.x + 30, C.z - 120], [C.x + 50, C.z - 190]] },
      { name: 'Quayside', w: 6, pts: [] },
      { name: 'Old Town Lane', w: 3.6, pts: [[market.x + 26, market.z + 20], [oldSq.x - 13, oldSq.z - 4], [oldSq.x + 13, oldSq.z + 6], [C.x + 180, C.z + 150]] },
      { name: 'Tanners Row', w: 3.2, pts: [[oldSq.x, oldSq.z + 13], [C.x + 100, C.z + 170], [southSq.x + 20, southSq.z + 4]] },
      { name: 'Court Lane', w: 4, pts: [[courtSq.x - 18, courtSq.z], [C.x - 170, C.z - 60], [C.x - 175, C.z + 10]] },
      { name: 'Guild Row', w: 4, pts: [[guildSq.x + 20, guildSq.z], [C.x + 200, C.z - 10], [C.x + 205, C.z + 70], [oldSq.x + 13, oldSq.z + 2]] },
      { name: 'Ward Street', w: 4, pts: [[southSq.x - 20, southSq.z - 2], [C.x - 90, C.z + 120], [C.x - 140, C.z + 70], [C.x - 140, C.z + 14]] },
      { name: 'Chapel Lane', w: 3.4, pts: [[market.x - 30, market.z + 14], [C.x - 70, C.z + 60], [C.x - 90, C.z + 120]] },
      { name: 'Mint Street', w: 3.6, pts: [[guildSq.x, guildSq.z - 20], [C.x + 100, C.z - 120], [C.x + 50, C.z - 150]] }
    ];
    // the quay runs along the shore inside the walls
    const shoreZ = x => LAKE.z + LAKE.rz * Math.sqrt(Math.max(0, 1 - ((x - LAKE.x) / LAKE.rx) ** 2)) + 10;
    for (let x = quay.x0; x <= quay.x1; x += 20) streets[4].pts.push([x, shoreZ(x)]);
    const streetDist = (x, z) => Math.min(...streets.map(st => segD(x, z, st.pts) - st.w / 2));
    const onRing = (q, a, extra) => { const d = q.r + (extra || 5.6); return { x: q.x + Math.cos(a) * d, z: q.z + Math.sin(a) * d, face: Math.atan2(-Math.cos(a), -Math.sin(a)) }; };
    const onStreet = (si, t, side) => {
      const st = streets[si], pts = st.pts; let L = 0; const ls = []; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); L += l; }
      let d = t * L, i = 0; while (i < ls.length - 1 && d > ls[i]) { d -= ls[i]; i++; }
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], f = d / ls[i], nx = -(bz - az) / ls[i], nz = (bx - ax) / ls[i], off = st.w / 2 + 5;
      return { x: ax + (bx - ax) * f + nx * off * side, z: az + (bz - az) * f + nz * off * side, face: Math.atan2(-nx * side, -nz * side) };
    };
    const T = (id, trade, name, boss, at, district) => ({ id, trade, name, boss, x: at.x, z: at.z, face: at.face, district, town: 'crownmere', noJob: true, oak: true, shift: [7, 17], wage: 8 });
    const M = market, ring = (q, n, a0, skip) => { const out = []; for (let k = 0; k < n; k++) { const a = a0 + k / n * Math.PI * 2; if (!skip || !skip(a)) out.push(onRing(q, a)); } return out; };
    // exits from the Great Market, so nothing is placed across a street
    const exitsM = [[0, 30], [-10, -30], [32, -6], [8, -32], [26, 20], [-32, 4], [-30, 14]].map(([x, z]) => Math.atan2(z, x));
    const clearOf = exits => a => exits.some(e => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < 0.28);
    const mSlots = ring(M, 16, 0.1, clearOf(exitsM));
    const names = [
      ['bakery', 'The Crown Bakery', 'Hugo Baker'], ['butcher', 'Kingsway Butchers', 'Rafe Flesher'], ['tavern', 'The Royal Oak', 'Mistress Joan'], ['chandler', 'Lamps & Lights', 'Ivo Waxman'],
      ['tailor', 'Fine Cloth of Crownmere', 'Isabel Draper'], ['goldsmith', 'The Gilded Crown', 'Simon Gold'], ['apothecary', 'The Physic Garden', 'Mother Agnes'], ['bakery', 'Market Ovens', 'Walter Pye'],
      ['tavern', 'The Three Kings', 'Godwin Ale'], ['weaver', 'Market Mercers', 'Cecily Mercer'], ['potter', 'Market Potters', 'Odo Crocker'], ['butcher', 'The Shambles', 'Hamo Bull']
    ];
    const biz = [];
    names.forEach(([t, n, b], i) => { if (mSlots[i]) biz.push(T('c_m' + i, t, n, b, mSlots[i], 'market')); });
    const gSlots = ring(guildSq, 10, 0.2, clearOf([Math.PI + 0.2, 0, -Math.PI / 2]));
    [['smithy', 'The Royal Armoury', 'Ralph Steel'], ['joinery', 'Master Joiners', 'Piers Wright'], ['mason', 'The Masons’ Lodge', 'Hugh Mason'], ['weaver', 'The Weavers’ Guild', 'Alys Weaver'], ['cooper', 'Guild Coopers', 'Edwin Hoop'], ['wheelwright', 'Royal Wheelwrights', 'Wat Wheeler'], ['tanner', 'The Glovers', 'Nesta Glove'], ['carter', 'The Kingsway Carriers', 'Garrick Cart']]
      .forEach(([t, n, b], i) => { if (gSlots[i]) biz.push(T('c_g' + i, t, n, b, gSlots[i], 'guild')); });
    const cSlots = ring(courtSq, 8, 0.3, clearOf([Math.atan2(10, 16), Math.PI, Math.atan2(-30, 50)]));
    [['goldsmith', 'The King’s Jeweller', 'Maud Silver'], ['tailor', 'Court Tailors', 'Philippa Lace'], ['tavern', 'The Crown and Sceptre', 'Lord Ralph Moreton'], ['apothecary', 'The Royal Physician', 'Master Leofric']]
      .forEach(([t, n, b], i) => { if (cSlots[i]) biz.push(T('c_c' + i, t, n, b, cSlots[i], 'court')); });
    const sSlots = ring(southSq, 10, 0.4, clearOf([Math.PI / 2, -Math.PI / 2, Math.PI, 0.2]));
    [['tavern', 'The Travellers’ Rest', 'Bertram Inns'], ['bakery', 'South Ward Bakehouse', 'Una Crust'], ['carter', 'Southgate Stables', 'Jory Ostler'], ['butcher', 'Southgate Butchers', 'Roger Cleaver'], ['wheelwright', 'Gate Wheelwrights', 'Kit Spoke'], ['smithy', 'Southgate Forge', 'Brand Smith']]
      .forEach(([t, n, b], i) => { if (sSlots[i]) biz.push(T('c_s' + i, t, n, b, sSlots[i], 'south')); });
    [[3, 0.45, 1, 'boatwright', 'Crown Lake Boatwrights', 'Tamsin Keel'], [3, 0.7, -1, 'tavern', 'The Anchor and Crown', 'Mother Brine'], [5, 0.5, 1, 'potter', 'Old Town Pottery', 'Ansel Clay'], [5, 0.75, -1, 'bakery', 'Old Town Ovens', 'Dunstan Loaf'], [6, 0.5, 1, 'tanner', 'The Old Tannery', 'Wulf Hide'], [8, 0.5, 1, 'chandler', 'Guild Row Chandlers', 'Ottilie Tallow'], [9, 0.4, 1, 'cooper', 'Ward Coopers', 'Martin Stave'], [10, 0.5, 1, 'weaver', 'Chapel Lane Weavers', 'Avice Loom'], [11, 0.5, -1, 'goldsmith', 'The Royal Mint', 'Master Fennick']]
      .forEach(([si, t, sd0, tr, n, b], i) => biz.push(T('c_x' + i, tr, n, b, onStreet(si, t, sd0), ['lake', 'lake', 'old', 'old', 'old', 'guild', 'south', 'market', 'guild'][i])));
    // shops along the great streets: Kingsway, the West Gate Road, Lake Street and Ward Street
    const TR8 = ['bakery', 'tailor', 'chandler', 'tavern', 'butcher', 'potter', 'weaver', 'apothecary', 'cooper', 'smithy', 'goldsmith', 'joinery'];
    const FN = ['Alder', 'Bell', 'Carver', 'Dyer', 'Fletcher', 'Gower', 'Hayes', 'Kemp', 'Lister', 'Marsh', 'Nash', 'Parr', 'Quill', 'Rowe', 'Sadler', 'Tarrant', 'Vane', 'Webb', 'Yates', 'Ashe', 'Brook', 'Crane', 'Drury', 'Ewer'];
    const TN = { bakery: 'Bakehouse', tailor: 'Tailors', chandler: 'Chandlery', tavern: 'Alehouse', butcher: 'Butchers', potter: 'Pottery', weaver: 'Mercers', apothecary: 'Apothecary', cooper: 'Coopers', smithy: 'Smithy', goldsmith: 'Goldsmiths', joinery: 'Joiners' };
    let kx = 0;
    for (const [si, ts] of [[0, [0.12, 0.2, 0.62, 0.7, 0.86]], [1, [0.25, 0.45, 0.65, 0.8]], [3, [0.2, 0.35]], [9, [0.3, 0.6, 0.8]], [2, [0.5]], [11, [0.3, 0.7]]]) for (const t of ts) for (const sd1 of [-1, 1]) {
      const tr = TR8[kx % TR8.length], fam = FN[kx % FN.length], at = onStreet(si, t, sd1);
      biz.push(T('c_k' + kx, tr, fam + '\u2019s ' + TN[tr], (['Alys', 'Hugh', 'Joan', 'Ralph', 'Maud', 'Odo', 'Petra', 'Simon'][kx % 8]) + ' ' + fam, at, ['south', 'west', 'lake', 'south', 'guild', 'guild'][[0, 1, 3, 9, 2, 11].indexOf(si)])); kx++;
    }
    // drop any that would sit on a street or crowd another

    const hall = { x: guildSq.x + 2, z: guildSq.z - 34, face: 0 };                       // the Guildhall of Crownmere, seat of the Lord Mayor
    const cathedral = { x: market.x - 70, z: market.z + 50, face: Math.PI / 4 };          // the Great Hall of the Realm, where the court sits in state
    const mansions = [[C.x - 150, C.z - 120], [C.x - 120, C.z - 40], [C.x - 60, C.z - 150], [C.x - 190, C.z - 20], [C.x - 30, C.z - 110]].map(([x, z], i) => ({ x, z, face: i * 1.3 }));
    // the wall: around the city on three sides, and along the lake shore it gives way to the quay and the castle
    const Rn = a => 236 + 10 * Math.sin(2 * a + 1.2) + 7 * Math.sin(3 * a + 0.4) + 5 * Math.sin(5 * a + 2.0);
    const keepOut = biz.map(b => ({ x: b.x, z: b.z, m: 14 })).concat([{ x: castle.x, z: castle.z, m: 34 }, { x: cathedral.x, z: cathedral.z, m: 22 }]);
    streets.forEach(st => st.pts.forEach(([x, z]) => keepOut.push({ x, z, m: 12 })));
    const NV = 44, wall = [], aS = Math.atan2(gS.z - C.z, gS.x - C.x);
    for (let k = 0; k < NV; k++) {
      const a = aS + k / NV * Math.PI * 2; let R = Rn(a) + (k ? (r() - 0.5) * 6 : 0);
      for (const o of keepOut) { const ao = Math.atan2(o.z - C.z, o.x - C.x), da = Math.abs(Math.atan2(Math.sin(ao - a), Math.cos(ao - a))); if (da < 0.16) R = Math.max(R, Math.hypot(o.x - C.x, o.z - C.z) + o.m * (1 - da / 0.22)); }
      let x = C.x + Math.cos(a) * R, z = C.z + Math.sin(a) * R;
      if (inLake(x, z, 4)) { const k0 = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz); x = LAKE.x + (x - LAKE.x) / k0 * 1.04; z = LAKE.z + (z - LAKE.z) / k0 * 1.04; }
      wall.push([x, z]);
    }
    wall.push(wall[0].slice());
    // the gates: the south gate is the first vertex; the west gate is the vertex nearest the west road
    const gate = { x: wall[0][0], z: wall[0][1], face: Math.atan2(wall[0][0] - C.x, wall[0][1] - C.z) };
    let wi = 0, wd = 1e9; wall.forEach(([x, z], i) => { const d = Math.hypot(x - gW.x, z - gW.z); if (d < wd) { wd = d; wi = i; } });
    const gateW = { x: wall[wi][0], z: wall[wi][1], face: Math.atan2(wall[wi][0] - C.x, wall[wi][1] - C.z), i: wi };
    streets[0].pts[0] = [gate.x, gate.z]; streets[1].pts[0] = [gateW.x, gateW.z];
    for (let i = biz.length - 1; i >= 0; i--) { const b = biz[i]; if (streetDist(b.x, b.z) < 3.4 || biz.some((o, j) => j < i && Math.hypot(o.x - b.x, o.z - b.z) < 10.5) || Math.hypot(b.x - cathedral.x, b.z - cathedral.z) < 20 || Math.hypot(b.x - hall.x, b.z - hall.z) < 15 || mansions.some(m => Math.hypot(b.x - m.x, b.z - m.z) < 13) || Math.hypot(b.x - castle.x, b.z - castle.z) < 42 || [market, courtSq, guildSq, southSq, oldSq].some(q => Math.hypot(b.x - q.x, b.z - q.z) < q.r + 4)) biz.splice(i, 1); }
    const shoreWall = wall.map(([x, z]) => lakeDist(x, z) < 12);
    const inside = (x, z) => { let c = false; for (let i = 0, j = wall.length - 2; i < wall.length - 1; j = i++) { const [xi, zi] = wall[i], [xj, zj] = wall[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const wallDist = (x, z) => segD(x, z, wall);
    const squares = [market, courtSq, guildSq, southSq, oldSq];
    const fits = (x, z, rad) => inside(x, z) && wallDist(x, z) > rad + 3 && lakeDist(x, z) > rad + 6 && riverDist(x, z) > rad + 9 && streetDist(x, z) > rad - 1.2 &&
      squares.every(q => Math.hypot(x - q.x, z - q.z) > q.r + rad + 1) && Math.hypot(x - castle.x, z - castle.z) > 40 + rad && Math.hypot(x - cathedral.x, z - cathedral.z) > 16 + rad &&
      Math.hypot(x - hall.x, z - hall.z) > 12 + rad && mansions.every(m => Math.hypot(x - m.x, z - m.z) > 10 + rad) && Math.hypot(x - gate.x, z - gate.z) > 14 + rad && Math.hypot(x - gateW.x, z - gateW.z) > 14 + rad;
    const houses = [], taken = biz.map(b => ({ x: b.x, z: b.z, r: 5.2 }));
    const free = (x, z, rad) => taken.every(t => Math.hypot(x - t.x, z - t.z) > t.r + rad + 0.6);
    for (const row of [0, 1]) for (const st of streets) {
      for (let i = 0; i < st.pts.length - 1; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 3; d < len - 2; d += 2) for (const side of [-1, 1]) {
          const off = st.w / 2 + 4 + row * 10.5, x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side, rad = 4.3;
          if (!fits(x, z, rad) || !free(x, z, rad)) continue;
          const dm = Math.hypot(x - C.x, z - C.z), old = Math.hypot(x - oldSq.x, z - oldSq.z) < 70;
          houses.push({ x, z, face: Math.atan2(-nx * side, -nz * side), tall: !old && (dm < 140 ? r() < 0.8 : r() < 0.45) }); taken.push({ x, z, r: rad });
        }
      }
    }
    const nearest = (x, z) => { let best = null, bd = 1e9; for (const st of streets) for (let i = 0; i < st.pts.length - 1; i++) { const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; best = { x: px, z: pz, d }; } } return best; };
    for (let k = 0; k < 6000 && houses.length < 640; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 270, x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d, rad = 4.3;
      const n = nearest(x, z); if (!n || n.d > 34 || !fits(x, z, rad) || !free(x, z, rad + 0.4)) continue;
      houses.push({ x, z, face: Math.atan2(n.x - x, n.z - z), tall: r() < 0.4 }); taken.push({ x, z, r: rad + 0.4 });
    }
    const spots = {
      cm_fish: { x: (quay.x0 + quay.x1) / 2, z: shoreZ((quay.x0 + quay.x1) / 2) - 9, rx: 90, rz: 2 }, cm_watch: { x: gate.x - Math.sin(gate.face) * 14, z: gate.z - Math.cos(gate.face) * 14, rx: 8, rz: 5 },
      cm_castle: { x: castle.x + 34, z: castle.z + 44, rx: 14, rz: 8 }, cm_porter: { x: market.x, z: market.z, rx: 24, rz: 24 },
      cm_mason: { x: cathedral.x + 20, z: cathedral.z + 16, rx: 10, rz: 8 }, cm_carter: { x: southSq.x + 30, z: southSq.z, rx: 8, rz: 10 },
      cm_wash: { x: quay.x0 + 24, z: shoreZ(quay.x0 + 24) - 9, rx: 18, rz: 1.5 }, cm_labour: { x: C.x + 150, z: C.z + 130, rx: 30, rz: 22 }
    };
    const plazas = [
      { id: 'market', name: 'the Great Market', x: market.x, z: market.z, r0: 6, r1: market.r - 3, w: 6 },
      { id: 'court', name: 'Court Square', x: courtSq.x, z: courtSq.z, r0: 3, r1: courtSq.r - 2, w: 2 },
      { id: 'guild', name: 'Guild Square', x: guildSq.x, z: guildSq.z, r0: 3, r1: guildSq.r - 2, w: 2.5 },
      { id: 'south', name: 'the South Ward square', x: southSq.x, z: southSq.z, r0: 3, r1: southSq.r - 2, w: 2.5 },
      { id: 'old', name: 'the Old Town well', x: oldSq.x, z: oldSq.z, r0: 2, r1: oldSq.r - 2, w: 2 },
      { id: 'quay', name: 'the quayside', x: (quay.x0 + quay.x1) / 2, z: shoreZ((quay.x0 + quay.x1) / 2) - 4, r0: 0, r1: 14, w: 2 }
    ];
    return { C, LAKE, wall, gate, gateW, shoreWall, inside, market, courtSq, guildSq, southSq, oldSq, squares, castle, cathedral, hall, mansions, streets, biz, houses, spots, plazas, shoreZ, quay, riverDist, lakeDist, riverX: () => 1e9, bridge: null, avoid: 0, push: 0, board: { x: market.x - 12, z: market.z + 12 } };
  })();
  // the roads to the capital: north from Oakbridge's gate, and north-east from Greenhaven
  ROADS.crown = [[OAK.gate.x + Math.sin(OAK.gate.face) * 6, OAK.gate.z + Math.cos(OAK.gate.face) * 6], [350, -360], [318, -450], [300, -560], [278, -660], [CM.gate.x + Math.sin(CM.gate.face) * 30, CM.gate.z + Math.cos(CM.gate.face) * 30], [CM.gate.x + Math.sin(CM.gate.face) * 6, CM.gate.z + Math.cos(CM.gate.face) * 6], [CM.gate.x, CM.gate.z]];
  ROADS.westcm = [[GH.entry.x, GH.entry.z], [-140, -850], [-100, -910], [CM.gateW.x + Math.sin(CM.gateW.face) * 26, CM.gateW.z + Math.cos(CM.gateW.face) * 26], [CM.gateW.x + Math.sin(CM.gateW.face) * 6, CM.gateW.z + Math.cos(CM.gateW.face) * 6], [CM.gateW.x, CM.gateW.z]];
  LOCS.cmmarket = { x: CM.market.x, z: CM.market.z, r: CM.market.r, name: 'The Great Market of Crownmere', town: 'crownmere' };
  LOCS.cmcastle = { x: CM.castle.x + Math.sin(CM.castle.face) * 30, z: CM.castle.z + Math.cos(CM.castle.face) * 30, r: 8, name: 'Crownmere Castle', town: 'crownmere' };
  LOCS.cmhall = { x: CM.hall.x, z: CM.hall.z + 9, r: 6, name: 'The Guildhall of Crownmere', town: 'crownmere' };
  LOCS.cmgreat = { x: CM.cathedral.x + Math.sin(CM.cathedral.face) * 12, z: CM.cathedral.z + Math.cos(CM.cathedral.face) * 12, r: 7, name: 'The Great Hall of the Realm', town: 'crownmere' };
  LOCS.cmquay = { x: CM.plazas[5].x, z: CM.plazas[5].z, r: 12, name: 'Crownmere Quayside', town: 'crownmere' };
  LOCS.cmgate = { x: CM.gate.x + Math.sin(CM.gate.face) * 5, z: CM.gate.z + Math.cos(CM.gate.face) * 5, r: 12, name: 'The King\u2019s Gate', town: 'crownmere' };
  LOCS.cmgatew = { x: CM.gateW.x + Math.sin(CM.gateW.face) * 5, z: CM.gateW.z + Math.cos(CM.gateW.face) * 5, r: 12, name: 'The West Gate', town: 'crownmere' };
  CM.biz.forEach(b0 => { LOCS['cb:' + b0.id] = { x: b0.x + Math.sin(b0.face) * 3.6, z: b0.z + Math.cos(b0.face) * 3.6, r: 3.2, name: b0.name, biz: b0.id, town: 'crownmere' }; });
  CM.biz.forEach(b => { b.spot = { x: b.x + Math.sin(b.face) * 1.2, z: b.z + Math.cos(b.face) * 1.2 }; b.front = { x: b.x + Math.sin(b.face) * 4, z: b.z + Math.cos(b.face) * 4 }; BIZ_SITES.push(b); });
  /* ---------- Stage IV: Ironcrest, the mining town on its mountain shelf, and Eastwatch, the port ----------
     Both are laid out the same way: streets first, then shops along them, then houses in rows behind. */
  function makeTown(cfg) {
    const C = cfg.C; let sd = cfg.seed; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const segD = (x, z, pts) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return best; };
    const streets = cfg.streets, plazas = cfg.plazas;
    const streetDist = (x, z) => Math.min(...streets.map(st => segD(x, z, st.pts) - st.w / 2));
    const onStreet = (si, t, side) => {
      const st = streets[si], pts = st.pts; let L = 0; const ls = []; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); L += l; }
      let d = t * L, i = 0; while (i < ls.length - 1 && d > ls[i]) { d -= ls[i]; i++; }
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], f = d / ls[i], nx = -(bz - az) / ls[i], nz = (bx - ax) / ls[i], off = st.w / 2 + 5;
      return { x: ax + (bx - ax) * f + nx * off * side, z: az + (bz - az) * f + nz * off * side, face: Math.atan2(-nx * side, -nz * side) };
    };
    const biz = cfg.biz.map(([id, trade, name, boss, si, t, side, district]) => { const at = onStreet(si, t, side); return { id, trade, name, boss, x: at.x, z: at.z, face: at.face, district, town: cfg.id, noJob: true, oak: true, shift: [6, 16], wage: 7 }; });
    const marks = cfg.marks || [];
    const taken = biz.map(b => ({ x: b.x, z: b.z, r: 5.2 })).concat(marks.map(m => ({ x: m.x, z: m.z, r: m.r })));
    const free = (x, z, rad) => taken.every(t => Math.hypot(x - t.x, z - t.z) > t.r + rad + 1.2);
    const fits = (x, z, rad) => streetDist(x, z) > rad - 1.0 && plazas.every(q => Math.hypot(x - q.x, z - q.z) > q.r1 + rad + 1.5) && Math.hypot(x - C.x, z - C.z) < cfg.R && !(cfg.avoid && cfg.avoid(x, z, rad));
    const houses = [];
    for (const row of [0, 1, 2]) for (const st of streets) {
      if (st.noHouses) continue;
      for (let i = 0; i < st.pts.length - 1; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 3; d < len - 2; d += 2) for (const side of [-1, 1]) {
          const off = st.w / 2 + 4 + row * 10.5, x = ax + (bx - ax) * d / len + nx * off * side, z = az + (bz - az) * d / len + nz * off * side, rad = 3.6;
          if (houses.length >= cfg.maxHouses || !fits(x, z, rad) || !free(x, z, rad)) continue;
          houses.push({ x, z, face: Math.atan2(-nx * side, -nz * side), tall: r() < cfg.tall * (row ? 0.6 : 1) }); taken.push({ x, z, r: rad });
        }
      }
    }
    return Object.assign({ C, streets, biz, houses, plazas, spots: cfg.spots, riverDist: () => 1e9, riverX: () => 1e9, inside: cfg.inside || (() => true), bridge: null, avoid: 0, push: 0, board: cfg.board, entry: cfg.entry }, cfg.extra || {});
  }
  const IC = makeTown({
    id: 'ironcrest', C: { x: 700, z: -1270 }, seed: 7741, R: 92, maxHouses: 46, tall: 0.25,
    streets: [
      { name: 'Gate Street', w: 4.6, pts: [[700, -1176], [702, -1215], [700, -1258]] },
      { name: 'Mine Road', w: 4.2, pts: [[700, -1258], [698, -1310], [704, -1346]], noHouses: false },
      { name: 'Smelter Row', w: 4.0, pts: [[700, -1258], [742, -1256], [778, -1250]] },
      { name: 'West Lane', w: 3.4, pts: [[700, -1258], [664, -1262], [632, -1275]] },
      { name: 'Upper Row', w: 3.2, pts: [[698, -1305], [735, -1312], [758, -1320]] },
      { name: 'Lower Lane', w: 3.0, pts: [[702, -1215], [664, -1212], [648, -1222]] }
    ],
    plazas: [{ id: 'square', name: 'Ironcrest Square', x: 700, z: -1258, r0: 3, r1: 12, w: 4 }, { id: 'mineyard', name: 'the mine yard', x: 706, z: -1350, r0: 2, r1: 9, w: 2 }],
    marks: [{ x: 640, z: -1300, r: 14 }, { x: 792, z: -1256, r: 15 }, { x: 806, z: -1294, r: 12 }, { x: 690, z: -1372, r: 7 }, { x: 728, z: -1368, r: 7 }],
    biz: [
      ['i_tavern', 'tavern', 'The Pick and Lantern', 'Bertrand Coale', 0, 0.78, 1, 'square'], ['i_forge', 'smithy', 'Stane Forge', 'Oswin Stane', 2, 0.35, 1, 'smelters'],
      ['i_hammer', 'smithy', 'Hammerfall Smithy', 'Gilda Hammond', 2, 0.6, -1, 'smelters'], ['i_bake', 'bakery', 'Ironcrest Ovens', 'Mabel Crane', 0, 0.45, -1, 'gate'],
      ['i_butcher', 'butcher', 'Highfold Butchers', 'Rufus Highfold', 3, 0.4, 1, 'west'], ['i_carter', 'carter', 'Ore Carters', 'Dunstan Wray', 1, 0.55, 1, 'mine'],
      ['i_mason', 'mason', 'Quarrymasters', 'Hilde Quarry', 1, 0.3, -1, 'mine'], ['i_chand', 'chandler', 'Lamp and Wick', 'Eda Lampton', 3, 0.7, -1, 'west'],
      ['i_apoth', 'apothecary', 'Miners’ Remedies', 'Silas Fenwick', 4, 0.5, 1, 'upper'], ['i_cooper', 'cooper', 'Crag Coopers', 'Ned Cragg', 5, 0.5, 1, 'gate']
    ],
    spots: { ic_mine: { x: 708, z: -1360, rx: 14, rz: 5 }, ic_smelt: { x: 790, z: -1262, rx: 8, rz: 6 }, ic_char: { x: 812, z: -1300, rx: 9, rz: 6 }, ic_haul: { x: 712, z: -1330, rx: 5, rz: 10 }, ic_watch: { x: 700, z: -1182, rx: 6, rz: 3 } },
    board: { x: 708, z: -1250 }, entry: { x: 700, z: -1176 },
    extra: { keep: { x: 640, z: -1300, face: Math.atan2(700 - 640, -1258 + 1300) }, smelters: [{ x: 784, z: -1250 }, { x: 796, z: -1262 }, { x: 790, z: -1240 }], adits: [{ x: 690, z: -1372 }, { x: 728, z: -1368 }], slag: { x: 806, z: -1294 } }
  });
  const EW = (function () {
    const C = { x: 1060, z: -300 }, R = 125;
    const wall = []; for (let a = 70; a <= 290.1; a += 8) { const t = a * Math.PI / 180; wall.push([C.x + Math.cos(t) * R * (1 + 0.05 * Math.sin(a * 0.11)), C.z + Math.sin(t) * R]); }
    wall.unshift([1138, wall[0][1]]); wall.push([1138, wall[wall.length - 1][1]]);
    const gi = wall.findIndex(([x, z]) => Math.abs(z - C.z) < 5), gate = { x: wall[gi][0], z: wall[gi][1], face: -Math.PI / 2, i: gi };
    const inside = (x, z) => Math.hypot(x - C.x, z - C.z) < R - 3 && x < 1136;
    const T = makeTown({
      id: 'eastwatch', C, seed: 9133, R: R - 6, maxHouses: 112, tall: 0.55,
      inside, avoid: (x, z, rad) => x > 1110 - rad || (x > 1080 && z < -380) || Math.hypot(x - 1096, z - 190 - -370) < 0,
      streets: [
        { name: 'High Street', w: 5, pts: [[gate.x + 6, gate.z], [1000, -300], [1062, -300]] },
        { name: 'Quay Street', w: 5.4, pts: [[1112, -405], [1112, -300], [1112, -200]], noHouses: true },
        { name: 'Harbour Way', w: 4.6, pts: [[1062, -300], [1106, -300]] },
        { name: 'North Street', w: 3.6, pts: [[1000, -300], [1006, -350], [1040, -392]] },
        { name: 'South Street', w: 3.6, pts: [[1000, -300], [1006, -250], [1040, -208]] },
        { name: 'Rope Walk', w: 3.4, pts: [[1062, -300], [1062, -345], [1100, -360]] },
        { name: 'Fish Lane', w: 3.4, pts: [[1062, -300], [1062, -255], [1100, -238]] },
        { name: 'Chapel Row', w: 3.0, pts: [[1006, -350], [968, -360], [958, -330]] },
        { name: 'Tanner’s Row', w: 3.0, pts: [[1006, -250], [968, -240], [958, -268]] }
      ],
      plazas: [{ id: 'harbour', name: 'Harbour Square', x: 1076, z: -300, r0: 4, r1: 13, w: 4 }, { id: 'cross', name: 'the market cross', x: 1000, z: -300, r0: 3, r1: 9, w: 3 }, { id: 'fish', name: 'the fish market', x: 1098, z: -236, r0: 2, r1: 7, w: 2 }],
      marks: [{ x: 1094, z: -186, r: 16 }, { x: 1094, z: -408, r: 14 }, { x: 1030, z: -340, r: 2 }],
      biz: [
        ['e_anchor', 'tavern', 'The Salt Anchor', 'Hester Brine', 2, 0.5, -1, 'harbour'], ['e_mermaid', 'tavern', 'The Mermaid', 'Jory Penhale', 0, 0.75, 1, 'high'], ['e_lantern', 'tavern', 'The Lantern', 'Wenna Trask', 6, 0.6, 1, 'fish'],
        ['e_bake1', 'bakery', 'Quayside Bakery', 'Tomas Bunn', 0, 0.55, -1, 'high'], ['e_bake2', 'bakery', 'Seagate Ovens', 'Agatha Rowe', 4, 0.4, 1, 'south'],
        ['e_forge', 'smithy', 'Harbour Forge', 'Cador Smith', 5, 0.45, 1, 'rope'], ['e_fish', 'butcher', 'The Fishmongers', 'Morwenna Hook', 6, 0.3, -1, 'fish'], ['e_butcher', 'butcher', 'Penrose Butchers', 'Alan Penrose', 3, 0.45, -1, 'north'],
        ['e_ship1', 'boatwright', 'Eastwatch Shipwrights', 'Gideon Keel', 5, 0.8, -1, 'rope'], ['e_ship2', 'boatwright', 'Slipway Boatwrights', 'Bran Tolley', 6, 0.85, 1, 'fish'],
        ['e_coop1', 'cooper', 'Harbour Coopers', 'Ned Staves', 3, 0.75, 1, 'north'], ['e_coop2', 'cooper', 'Saltbarrel Coopers', 'Ivo Pell', 4, 0.75, -1, 'south'],
        ['e_chand', 'chandler', 'Ship Chandlers', 'Lowen Tallow', 2, 0.3, 1, 'harbour'], ['e_rope', 'weaver', 'The Rope Walk', 'Senara Cord', 5, 0.2, -1, 'rope'], ['e_sail', 'tailor', 'Sailmakers', 'Petroc Canvas', 1, 0.15, -1, 'quay'],
        ['e_exch', 'goldsmith', 'The Merchant Exchange', 'Julian Marchant', 0, 0.9, -1, 'high'], ['e_apoth', 'apothecary', 'Harbour Apothecary', 'Kerra Salve', 7, 0.5, 1, 'chapel'],
        ['e_cart1', 'carter', 'Quay Carters', 'Gwen Barrow', 1, 0.85, -1, 'quay'], ['e_cart2', 'carter', 'Customs Carters', 'Hal Wainer', 3, 0.2, 1, 'north'],
        ['e_mason', 'mason', 'Seawall Masons', 'Eli Stonard', 8, 0.5, -1, 'tanners'], ['e_potter', 'potter', 'Clay Lane Pottery', 'Nessa Kiln', 7, 0.2, -1, 'chapel'], ['e_tanner', 'tanner', 'Eastwatch Tannery', 'Ruan Hyde', 8, 0.8, 1, 'tanners']
      ],
      spots: { ew_dock: { x: 1118, z: -300, rx: 3, rz: 70 }, ew_fish: { x: 1124, z: -240, rx: 2, rz: 14 }, ew_net: { x: 1100, z: -222, rx: 6, rz: 3 }, ew_sail: { x: 1120, z: -350, rx: 3, rz: 20 }, ew_yard: { x: 1100, z: -400, rx: 8, rz: 6 }, ew_watch: { x: gate.x + 9, z: gate.z, rx: 3, rz: 6 } },
      board: { x: 1068, z: -288 }, entry: { x: gate.x - 8, z: gate.z },
      extra: { wall, gate, keep: { x: 1094, z: -186, face: Math.PI }, lighthouse: { x: 1168, z: -440 }, shipyard: { x: 1094, z: -408 }, quayX: 1132, shoreX: 1136 }
    });
    return T;
  })();
  const IC_JOBS = { ic_mine: ['Miner', 'Cutting ore in the mine'], ic_smelt: ['Smelter hand', 'Tending the smelters'], ic_char: ['Charcoal burner', 'Burning charcoal'], ic_haul: ['Ore hauler', 'Hauling ore carts'], ic_watch: ['Watchman', 'Keeping the road gate'] };
  const EW_JOBS = { ew_dock: ['Docker', 'Unloading ships at the quay'], ew_fish: ['Fisher', 'Fishing from the boats'], ew_net: ['Net mender', 'Mending nets on the strand'], ew_sail: ['Sailor', 'Crewing a coaster'], ew_yard: ['Shipwright’s hand', 'Building a ship on the slip'], ew_watch: ['Harbour watchman', 'Watching the harbour gate'] };
  /* ---------- Valdoria, across the Sundering Sea: Dawnport, and Stormrest Isle on the way ---------- */
  // Valdoria's coast faces Alderwyn across about 760 m of open water. Dawnport is its great port: sandstone, red tiles,
  // arcaded streets, a customs house on the quay and the Consul's palace on the rise behind the town.
  const VSHORE = z => 1900 + 10 * Math.sin(z / 70) + 4 * Math.sin(z / 23);
  const ISLE = { x: 1520, z: -330, r: 46 };
  const DP = (function () {
    const C = { x: 1990, z: -300 }, R = 104;
    const T = makeTown({
      id: 'dawnport', C, seed: 20231, R: R - 6, maxHouses: 104, tall: 0.6,
      inside: (x, z) => Math.hypot(x - C.x, z - C.z) < R - 3 && x > 1908,
      avoid: (x, z, rad) => x < 1916 + rad || Math.hypot(x - 2084, z + 300) < 22 + rad || Math.hypot(x - 1934, z + 366) < 12 + rad,
      streets: [
        { name: 'the High Calle', w: 5.2, pts: [[1918, -300], [1960, -300], [2010, -300], [2062, -300]] },
        { name: 'the Quay', w: 5.4, pts: [[1912, -392], [1912, -300], [1912, -210]], noHouses: true },
        { name: 'Salt Street', w: 3.8, pts: [[1960, -300], [1964, -348], [1996, -386]] },
        { name: 'Vine Street', w: 3.8, pts: [[1960, -300], [1964, -252], [1996, -214]] },
        { name: 'the Arcade', w: 4.2, pts: [[2010, -300], [2014, -346], [2050, -360]] },
        { name: 'Fountain Lane', w: 3.6, pts: [[2010, -300], [2014, -254], [2050, -240]] },
        { name: 'Palace Steps', w: 4.4, pts: [[2062, -300], [2070, -300]], noHouses: true }
      ],
      plazas: [{ id: 'harbour', name: 'the Harbour Plaza', x: 1934, z: -300, r0: 4, r1: 13, w: 4 }, { id: 'mayor', name: 'the Plaza Mayor', x: 2010, z: -300, r0: 3, r1: 11, w: 3 }, { id: 'fish', name: 'the fish market', x: 1922, z: -238, r0: 2, r1: 7, w: 2 }],
      marks: [{ x: 2084, z: -300, r: 20 }, { x: 1934, z: -366, r: 12 }, { x: 2040, z: -274, r: 6 }],
      biz: [
        ['d_gull', 'tavern', 'The Red Gull', 'Marisol Ferrer', 0, 0.12, 1, 'harbour'], ['d_vine', 'tavern', 'The Vine and Barrel', 'Rodrigo Vidal', 0, 0.62, -1, 'high'], ['d_lamp', 'tavern', 'The Lamplighter', 'Leonor Serra', 3, 0.5, 1, 'vine'],
        ['d_oven1', 'bakery', 'Saint Olalla’s Ovens', 'Tomas Puig', 0, 0.42, -1, 'high'], ['d_oven2', 'bakery', 'The Fig Tree Bakery', 'Elvira Bosch', 4, 0.5, 1, 'arcade'],
        ['d_forge', 'smithy', 'Anchor Forge', 'Gonzalo Roca', 2, 0.5, -1, 'salt'], ['d_fishm', 'butcher', 'The Fish Hall', 'Ximena Delmar', 0, 0.22, -1, 'harbour'], ['d_butch', 'butcher', 'Navarro Butchers', 'Lope Navarro', 5, 0.5, 1, 'fountain'],
        ['d_yard', 'boatwright', 'Dawnport Shipwrights', 'Jaume Montaner', 2, 0.85, 1, 'salt'], ['d_cooper', 'cooper', 'The Wine Coopers', 'Bernat Vives', 3, 0.8, -1, 'vine'],
        ['d_chand', 'chandler', 'Candle and Lamp', 'Teresa Sola', 4, 0.3, -1, 'arcade'], ['d_silk', 'weaver', 'The Silk Looms', 'Catalina Castell', 4, 0.8, 1, 'arcade'], ['d_tailor', 'tailor', 'Arcade Tailors', 'Ramon Oliver', 5, 0.8, -1, 'fountain'],
        ['d_gold', 'goldsmith', 'The Counting House', 'Diego Medina', 0, 0.82, 1, 'high'], ['d_apoth', 'apothecary', 'The Orange Tree Apothecary', 'Ines Arenas', 5, 0.25, -1, 'fountain'],
        ['d_cart', 'carter', 'Quay Carters', 'Nuno Torres', 1, 0.75, -1, 'quay'], ['d_mason', 'mason', 'Sandstone Masons', 'Pelayo Rius', 2, 0.25, 1, 'salt'], ['d_potter', 'potter', 'The Red Clay Pottery', 'Blanca Salvat', 3, 0.25, -1, 'vine'], ['d_tanner', 'tanner', 'Dawnport Tannery', 'Sancho Vidal', 1, 0.3, 1, 'quay']
      ],
      spots: { dp_dock: { x: 1916, z: -300, rx: 2.5, rz: 70 }, dp_fish: { x: 1918, z: -230, rx: 2, rz: 12 }, dp_salt: { x: 1960, z: -398, rx: 12, rz: 4 }, dp_sail: { x: 1916, z: -352, rx: 2, rz: 18 }, dp_vine: { x: 2030, z: -206, rx: 12, rz: 5 }, dp_watch: { x: 2060, z: -300, rx: 3, rz: 4 } },
      board: { x: 1944, z: -288 }, entry: { x: 1918, z: -300 },
      extra: { palace: { x: 2084, z: -300, face: -Math.PI / 2 }, customs: { x: 1934, z: -366, face: Math.PI / 2 }, fountain: { x: 2010, z: -300 }, quayX: 1910 }
    });
    return T;
  })();
  const DP_JOBS = { dp_dock: ['Docker', 'Unloading ships on the quay'], dp_fish: ['Fisher', 'Fishing from the boats'], dp_salt: ['Salt raker', 'Raking the salt pans'], dp_sail: ['Sailor', 'Crewing a merchant ship'], dp_vine: ['Vine dresser', 'Working the vineyards above the town'], dp_watch: ['Harbour guard', 'Keeping the quay for the Consul'] };
  DP.biz.forEach(b => { b.spot = { x: b.x + Math.sin(b.face) * 1.2, z: b.z + Math.cos(b.face) * 1.2 }; b.front = { x: b.x + Math.sin(b.face) * 4, z: b.z + Math.cos(b.face) * 4 }; BIZ_SITES.push(b); });
  TOWNS.dawnport = { name: 'Dawnport', x: DP.C.x, z: DP.C.z, r: 106, open: true, foreign: 'valdoria' };
  LOCS.dpharbour = { x: 1934, z: -300, r: 11, name: 'the Harbour Plaza', town: 'dawnport' };
  LOCS.dpquay = { x: 1916, z: -300, r: 8, name: 'Dawnport Quay', town: 'dawnport', port: 'dawnport' };
  LOCS.dpcustoms = { x: 1934, z: -352, r: 6, name: 'the Customs House', town: 'dawnport' };
  LOCS.dppalace = { x: 2064, z: -300, r: 6, name: 'the Consul’s Palace', town: 'dawnport' };
  LOCS.dpplaza = { x: 2010, z: -300, r: 10, name: 'the Plaza Mayor', town: 'dawnport' };
  DP.biz.forEach(b0 => { LOCS['db:' + b0.id] = { x: b0.x + Math.sin(b0.face) * 3.6, z: b0.z + Math.cos(b0.face) * 3.6, r: 3.2, name: b0.name, biz: b0.id, town: 'dawnport' }; });
  // the passage: ships sail from Eastwatch's quay, call at Stormrest Isle, and on to Dawnport. Anyone who can pay may go.
  const PORTS = {
    eastwatch: { x: 1128, z: -330, face: -Math.PI / 2, name: 'Eastwatch Quay' },
    stormrest: { x: ISLE.x - 30, z: ISLE.z, face: Math.PI / 2, name: 'Stormrest Harbour' },
    dawnport: { x: 1918, z: -300, face: Math.PI / 2, name: 'Dawnport Quay' }
  };
  LOCS.ewpassage = { x: PORTS.eastwatch.x, z: PORTS.eastwatch.z, r: 7, name: 'The Passage Office', town: 'eastwatch', port: 'eastwatch' };
  LOCS.stormrest = { x: ISLE.x - 22, z: ISLE.z, r: 9, name: 'The Stormrest Inn', port: 'stormrest' };
  const SAIL_MPM = 11;                       // a merchant ship makes about 11 m a game minute
  const PASSAGE = { 'eastwatch-dawnport': 40, 'eastwatch-stormrest': 18, 'stormrest-dawnport': 24 };
  const passageFare = (a, b) => PASSAGE[a + '-' + b] || PASSAGE[b + '-' + a] || 0;
  const seaDist = (a, b) => Math.hypot(PORTS[a].x - PORTS[b].x, PORTS[a].z - PORTS[b].z) * 1.08;
  // one winter day in five the sea is too rough to sail (the same days for everyone, so the forecast can be told)
  const seaRough = (s, d) => calendar({ day: d || s.day }).season === 'winter' && (((d || s.day) * 2654435761) >>> 0) % 100 < 20;
  const portHere = s => Object.keys(PORTS).find(k => Math.hypot(s.player.x - PORTS[k].x, s.player.z - PORTS[k].z) < 10) || null;
  IC.biz.forEach(b => { b.spot = { x: b.x + Math.sin(b.face) * 1.2, z: b.z + Math.cos(b.face) * 1.2 }; b.front = { x: b.x + Math.sin(b.face) * 4, z: b.z + Math.cos(b.face) * 4 }; BIZ_SITES.push(b); });
  EW.biz.forEach(b => { b.spot = { x: b.x + Math.sin(b.face) * 1.2, z: b.z + Math.cos(b.face) * 1.2 }; b.front = { x: b.x + Math.sin(b.face) * 4, z: b.z + Math.cos(b.face) * 4 }; BIZ_SITES.push(b); });
  ROADS.iron = [[CM.gate.x + Math.sin(CM.gate.face) * 30, CM.gate.z + Math.cos(CM.gate.face) * 30], [330, -806], [430, -812], [512, -830], [575, -880], [632, -975], [676, -1080], [698, -1150], [IC.entry.x, IC.entry.z]];
  ROADS.coast = [[OAK.gate.x + Math.sin(OAK.gate.face) * 6, OAK.gate.z + Math.cos(OAK.gate.face) * 6], [400, -296], [440, -287], [500, -282], [580, -276], [700, -288], [820, -300], [EW.gate.x - 30, EW.gate.z], [EW.gate.x - 6, EW.gate.z], [EW.gate.x, EW.gate.z]];
  TOWNS.ironcrest = { name: 'Ironcrest', x: IC.C.x, z: IC.C.z, r: 96, open: true };
  TOWNS.eastwatch = { name: 'Eastwatch', x: EW.C.x, z: EW.C.z, r: 128, open: true };
  LOCS.icsquare = { x: 700, z: -1258, r: 10, name: 'Ironcrest Square', town: 'ironcrest' };
  LOCS.icmine = { x: 708, z: -1352, r: 9, name: 'The Ironcrest Mines', town: 'ironcrest' };
  LOCS.icsmelt = { x: 788, z: -1268, r: 9, name: 'The Smelters', town: 'ironcrest' };
  LOCS.ickeep = { x: IC.keep.x + Math.sin(IC.keep.face) * 12, z: IC.keep.z + Math.cos(IC.keep.face) * 12, r: 6, name: 'Stane Keep', town: 'ironcrest' };
  LOCS.ewharbour = { x: 1076, z: -300, r: 11, name: 'Harbour Square', town: 'eastwatch' };
  LOCS.ewquay = { x: 1118, z: -330, r: 9, name: 'The Quays', town: 'eastwatch' };
  LOCS.ewyard = { x: 1094, z: -396, r: 9, name: 'The Shipyard', town: 'eastwatch' };
  LOCS.ewkeep = { x: EW.keep.x, z: EW.keep.z - 14, r: 6, name: 'Eastwatch Castle', town: 'eastwatch' };
  LOCS.ewgate = { x: EW.gate.x - 6, z: EW.gate.z, r: 6, name: 'The Land Gate', town: 'eastwatch' };
  LOCS.ewlight = { x: 1160, z: -432, r: 6, name: 'The Lighthouse', town: 'eastwatch' };
  IC.biz.forEach(b0 => { LOCS['ib:' + b0.id] = { x: b0.x + Math.sin(b0.face) * 3.6, z: b0.z + Math.cos(b0.face) * 3.6, r: 3.2, name: b0.name, biz: b0.id, town: 'ironcrest' }; });
  EW.biz.forEach(b0 => { LOCS['eb:' + b0.id] = { x: b0.x + Math.sin(b0.face) * 3.6, z: b0.z + Math.cos(b0.face) * 3.6, r: 3.2, name: b0.name, biz: b0.id, town: 'eastwatch' }; });
  const CM_JOBS = { cm_fish: ['Fisher', 'Fishing from the quay'], cm_watch: ['City watchman', 'Keeping the King\u2019s Gate'], cm_castle: ['Castle servant', 'Serving at the castle'], cm_porter: ['Market porter', 'Carrying in the Great Market'], cm_mason: ['Mason', 'Working on the Great Hall'], cm_carter: ['Carter', 'Loading carts in the South Ward'], cm_wash: ['Washer', 'Washing linen at the lake'], cm_labour: ['Labourer', 'Labouring in the Old Town'] };
  const LAYOUT = { oakbridge: OAK, greenhaven: GH, crownmere: CM, ironcrest: IC, eastwatch: EW, dawnport: DP };
  const COMMON_JOBS = Object.assign({}, OAK_JOBS, GH_JOBS, CM_JOBS, IC_JOBS, EW_JOBS, DP_JOBS);
  /* ---------- getting about: stage posts and coaches, and a horse of your own ---------- */
  const STAGE = {
    hearthmoor: { x: 72, z: 11, face: 0, name: 'Hearthmoor Stage Post' },
    oakbridge: { x: OAK.square.x - 10, z: OAK.square.z + 24, face: 0, name: 'Oakbridge Stage Post' },
    greenhaven: { x: GH.entry.x - 6, z: GH.entry.z - 9, face: 0, name: 'Greenhaven Stage Post' },
    crownmere: { x: CM.southSq.x, z: CM.southSq.z, face: 0, name: 'Crownmere Stage Post' },
    ironcrest: { x: 712, z: -1196, face: 0, name: 'Ironcrest Stage Post' },
    eastwatch: { x: EW.gate.x + 20, z: EW.gate.z + 14, face: 0, name: 'Eastwatch Stage Post' }
  };
  // in the towns, the stage post takes the nearest clear ground to where the road comes in, facing the nearest street
  const segDist0 = (x, z, pts) => { let b = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
  for (const [id, L, from] of [['oakbridge', OAK, OAK.gate], ['greenhaven', GH, GH.entry], ['crownmere', CM, CM.gate], ['ironcrest', IC, IC.entry], ['eastwatch', EW, EW.gate]]) {
    const blds = L.houses.map(h => [h.x, h.z]).concat(L.biz.map(b => [b.x, b.z])), st = STAGE[id];
    let best = null;
    for (let r0 = 10; r0 < 70 && !best; r0 += 2) for (let k = 0; k < 36 && !best; k++) {
      const a0 = k / 36 * Math.PI * 2, x = from.x + Math.cos(a0) * r0, z = from.z + Math.sin(a0) * r0;
      if ((L.inside && !L.inside(x, z)) || (L.wall && segDist0(x, z, L.wall) < 12) || L.riverDist(x, z) < 16) continue;
      if (blds.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 11.5)) continue;
      if (Object.values(ROADS).some(rd => segDist0(x, z, rd) < 8) || L.streets.some(q => segDist0(x, z, q.pts) < q.w / 2 + 6) || L.plazas.some(q => Math.hypot(q.x - x, q.z - z) < (q.r1 || 4) + 8)) continue;
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
  const EDGES = [['hearthmoor', 'fork', LEG.hearthmoor], ['fork', 'oakbridge', LEG.oakbridge], ['fork', 'greenhaven', LEG.greenhaven], ['oakbridge', 'crownmere', polyLen(ROADS.crown) + 60], ['greenhaven', 'crownmere', polyLen(ROADS.westcm) + 60], ['crownmere', 'ironcrest', polyLen(ROADS.iron) + 40], ['oakbridge', 'eastwatch', polyLen(ROADS.coast) + 40]];
  const roadDist = (a, b) => { if (a === b) return 0; const D = { [a]: 0 }, Q = [a]; while (Q.length) { Q.sort((x, y) => D[x] - D[y]); const u = Q.shift(); for (const [x, y, w] of EDGES) { const v = x === u ? y : y === u ? x : null; if (v && (D[v] == null || D[u] + w < D[v])) { D[v] = D[u] + w; Q.push(v); } } } return D[b] || 0; };
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
  // Crownmere: about 1,150 people. The great merchant houses own much of the city; a Lord Mayor and the guild masters run it
  // Ironcrest and Eastwatch: families, businesses, common work and a town council, as in the other towns
  function setupNewTown(s, id) {
    if (!s.towns || s.towns[id]) return;
    const L = LAYOUT[id], cfg = id === 'dawnport' ? { seed: 717171, pop: 450, jobs: ['dp_dock', 'dp_dock', 'dp_dock', 'dp_fish', 'dp_fish', 'dp_salt', 'dp_salt', 'dp_sail', 'dp_vine', 'dp_vine', 'dp_watch'], title: 'Consul', chest: 650, rent: [5, 3], pre: 'd', fam: VAL_FAMILY, first: [VAL_F, VAL_M] } : id === 'ironcrest' ? { seed: 515151, pop: 200, jobs: ['ic_mine', 'ic_mine', 'ic_mine', 'ic_mine', 'ic_smelt', 'ic_smelt', 'ic_char', 'ic_haul', 'ic_haul', 'ic_watch'], title: 'Reeve', chest: 300, rent: [4, 3], pre: 'i', fam: ['Stane', 'Coale', 'Cragg', 'Delver', 'Flint', 'Hewer', 'Ironside', 'Pickard', 'Sledge', 'Tor', 'Wray', 'Ashby', 'Quarry'] }
      : { seed: 616161, pop: 480, jobs: ['ew_dock', 'ew_dock', 'ew_dock', 'ew_fish', 'ew_fish', 'ew_net', 'ew_sail', 'ew_sail', 'ew_yard', 'ew_watch'], title: 'Harbourmaster', chest: 700, rent: [5, 3], pre: 'e', fam: ['Penhale', 'Trask', 'Brine', 'Keel', 'Tolley', 'Hook', 'Marchant', 'Rowe', 'Polgrean', 'Nance', 'Tremayne', 'Kitto', 'Jago', 'Pascoe', 'Rescorla'] };
    let sd = cfg.seed; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const used = new Set(Object.values(s.people).map(p => p.name));
    const FIRST_F = cfg.first ? cfg.first[0] : FIRST.filter(n => FEMALE.has(n)), FIRST_M = cfg.first ? cfg.first[1] : FIRST.filter(n => !FEMALE.has(n)), FAM = cfg.first ? cfg.fam : cfg.fam.concat(FAMILY), FIRST_ALL = FIRST_F.concat(FIRST_M);
    const nameFor = (fam, sex) => { const Ls = sex === 'f' ? FIRST_F : sex === 'm' ? FIRST_M : FIRST_ALL; for (let k = 0; k < 60; k++) { const n = Ls[Math.floor(r() * Ls.length)] + ' ' + fam; if (!used.has(n)) { used.add(n); return n; } } const n = 'Townsman ' + used.size; used.add(n); return n; };
    const hs = L.houses.map((h, i) => ({ id: cfg.pre + i, name: (h.tall ? 'Townhouse, ' : 'Cottage, ') + TOWNS[id].name, x: h.x, z: h.z, owner: 'town:' + id, rent: h.tall ? cfg.rent[0] : cfg.rent[1], cap: h.tall ? 6 : 4, tenants: [], town: id }));
    s.houses.push(...hs);
    const P0 = (o, h) => { const p = newPerson(s, Object.assign({ town: id, purse: 20 + Math.floor(r() * 30), palette: Math.floor(r() * 10) }, o)); if (h) moveIn(s, p, h); p.log = [{ day: s.day, text: 'Lives in ' + TOWNS[id].name + '.' }]; p.rep = 20; return p; };
    let hi = 0; const nextHouse = () => hs[(hi++ * 7) % hs.length];
    const family = (head, h, fam, kids) => {
      const sp = r() < 0.75 ? P0({ name: nameFor(fam, sexOf(head) === 'f' ? 'm' : 'f'), age: Math.max(18, head.age - 4 + Math.floor(r() * 8)), maiden: undefined }, h) : null;
      if (sp) { head.spouse = sp.id; sp.spouse = head.id; sp.hh = head.id; }
      for (let k = 0; k < kids; k++) { const c = P0({ name: nameFor(fam), age: 2 + Math.floor(r() * 13), purse: 0 }, h); c.kid = true; c.parents = [head.id].concat(sp ? [sp.id] : []); c.hh = head.id; }
      return sp;
    };
    for (const b of L.biz) {
      const fam = b.boss.split(' ').slice(-1)[0];
      const own = P0({ name: b.boss, age: 32 + Math.floor(r() * 24), purse: 130 + Math.floor(r() * 110), job: { type: 'biz', biz: b.id, role: 'owner' }, home: 'biz:' + b.id }); used.add(own.name);
      s.biz[b.id] = { id: b.id, trade: b.trade, owner: own.id, staff: [], profits: [10, 10, 10], closed: false, opened: 0, lastProfit: 0, lastRevenue: 0, town: id };
      const sp = r() < 0.65 ? P0({ name: nameFor(fam, sexOf(own) === 'f' ? 'm' : 'f'), age: own.age - 3, home: 'biz:' + b.id }) : null;
      if (sp) { own.spouse = sp.id; sp.spouse = own.id; sp.hh = own.id; }
      const nk = Math.floor(r() * 3); for (let k = 0; k < nk; k++) { const c = P0({ name: nameFor(fam), age: 3 + Math.floor(r() * 12), purse: 0, home: 'biz:' + b.id }); c.kid = true; c.parents = [own.id].concat(sp ? [sp.id] : []); c.hh = own.id; }
      const nh = 1 + Math.floor(r() * 2);
      for (let k = 0; k < nh; k++) { const hf = FAM[Math.floor(r() * FAM.length)], h = nextHouse(); const hand = P0({ name: nameFor(hf), age: 18 + Math.floor(r() * 25), job: { type: 'biz', biz: b.id, role: 'hand' } }, h); s.biz[b.id].staff.push({ pid: hand.id, wage: 8 + Math.floor(r() * 3) }); if (r() < 0.5) family(hand, h, hf, Math.floor(r() * 3)); }
    }
    let n = Object.values(s.people).filter(p => p.town === id).length;
    while (n < cfg.pop) {
      const fam = FAM[Math.floor(r() * FAM.length)], h = nextHouse();
      const head = P0({ name: nameFor(fam), age: 20 + Math.floor(r() * 42), job: r() < 0.9 ? { type: 'commons', what: cfg.jobs[Math.floor(r() * cfg.jobs.length)] } : null }, h);
      const sp = family(head, h, fam, Math.floor(r() * 4));
      if (sp && r() < 0.5) sp.job = { type: 'commons', what: cfg.jobs[Math.floor(r() * cfg.jobs.length)] };
      n = Object.values(s.people).filter(p => p.town === id).length;
    }
    const landlords = Object.values(s.people).filter(p => p.town === id && p.job && p.job.role === 'owner');
    hs.forEach(h => { if (r() < 0.5) { const l = landlords[Math.floor(r() * landlords.length)]; if (!h.tenants.includes(l.id)) h.owner = l.id; } });
    for (const p of Object.values(s.people)) if (p.town === id) p.rep = Math.round(repTarget(s, p));
    const masters = landlords.slice().sort((a, b) => b.rep - a.rep || b.purse - a.purse), mayor = masters[0];
    s.towns[id] = { title: cfg.title, chest: cfg.chest, fee: 'normal', approval: 60, council: masters.slice(1, 5).map(p => p.id), mayor: mayor.id, nextVote: s.day + 7, log: [], lastVote: null };
    plog(s, mayor, 'Chosen ' + cfg.title + ' of ' + TOWNS[id].name + '.');
  }
  // Valdoria: its own crown and its own customs. For now it is a place to go and to trade; its queen, its laws and its
  // dealings with Alderwyn come in the next part of the stage
  function setupValdoria(s) {
    if (s.valdoria) return;
    s.valdoria = { name: 'Valdoria', ruler: 'Queen Ximena II', capital: 'Valdor', duty: 1.2, log: [] };
  }
  function setupCrownmere(s) {
    if (!s.towns || s.towns.crownmere) return;
    let sd = 424242; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const used = new Set(Object.values(s.people).map(p => p.name));
    const FIRST_F = FIRST.filter(n => FEMALE.has(n)), FIRST_M = FIRST.filter(n => !FEMALE.has(n));
    const FAM = FAMILY.concat(['Ashe', 'Bowyer', 'Chapman', 'Draper', 'Falconer', 'Goldsmith', 'Harper', 'Ironmonger', 'Joiner', 'Kingsley', 'Lockyer', 'Mason', 'Netherby', 'Ostler', 'Pargeter', 'Quarrell', 'Roper', 'Skinner', 'Turner', 'Vintner', 'Wainwright']);
    const nameFor = (fam, sex) => { const L = sex === 'f' ? FIRST_F : sex === 'm' ? FIRST_M : FIRST; for (let k = 0; k < 60; k++) { const n = L[Math.floor(r() * L.length)] + ' ' + fam; if (!used.has(n)) { used.add(n); return n; } } const n = 'Citizen ' + used.size; used.add(n); return n; };
    const ch = CM.houses.map((h, i) => ({ id: 'c' + i, name: (h.tall ? 'Townhouse, ' : 'Cottage, ') + ({ market: 'by the Great Market' }[''] || (Math.hypot(h.x - CM.market.x, h.z - CM.market.z) < 80 ? 'Market Ward' : h.z < CM.C.z - 90 ? 'Lakeside' : h.x < CM.C.x - 60 ? 'Court Quarter' : h.x > CM.C.x + 60 && h.z > CM.C.z + 30 ? 'Old Town' : h.x > CM.C.x + 60 ? 'Guild Ward' : 'South Ward')), x: h.x, z: h.z, owner: 'town:crownmere', rent: h.tall ? 5 : 3, cap: h.tall ? 6 : 4, tenants: [], town: 'crownmere' }));
    s.houses.push(...ch);
    const P0 = (o, h) => { const p = newPerson(s, Object.assign({ town: 'crownmere', purse: 20 + Math.floor(r() * 30), palette: Math.floor(r() * 10) }, o)); if (h) moveIn(s, p, h); p.log = [{ day: s.day, text: 'Lives in Crownmere.' }]; p.rep = 20; return p; };
    let hi = 0; const nextHouse = () => ch[(hi++ * 7) % ch.length];
    const family = (head, h, fam, kids) => {
      const sp = r() < 0.75 ? P0({ name: nameFor(fam, sexOf(head) === 'f' ? 'm' : 'f'), age: Math.max(18, head.age - 4 + Math.floor(r() * 8)) }, h) : null;
      if (sp) { head.spouse = sp.id; sp.spouse = head.id; sp.hh = head.id; }
      for (let k = 0; k < kids; k++) { const c = P0({ name: nameFor(fam), age: 2 + Math.floor(r() * 13), purse: 0 }, h); c.kid = true; c.parents = [head.id].concat(sp ? [sp.id] : []); c.hh = head.id; }
      return sp;
    };
    for (const b of CM.biz) {
      const fam = b.boss.split(' ').slice(-1)[0];
      const own = P0({ name: b.boss, age: 34 + Math.floor(r() * 24), purse: 140 + Math.floor(r() * 120), job: { type: 'biz', biz: b.id, role: 'owner' }, home: 'biz:' + b.id });
      used.add(own.name);
      s.biz[b.id] = { id: b.id, trade: b.trade, owner: own.id, staff: [], profits: [10, 10, 10], closed: false, opened: 0, lastProfit: 0, lastRevenue: 0, town: 'crownmere' };
      const sp = r() < 0.65 ? P0({ name: nameFor(fam, sexOf(own) === 'f' ? 'm' : 'f'), age: own.age - 3, home: 'biz:' + b.id }) : null;
      if (sp) { own.spouse = sp.id; sp.spouse = own.id; sp.hh = own.id; }
      const nk = Math.floor(r() * 3); for (let k = 0; k < nk; k++) { const c = P0({ name: nameFor(fam), age: 3 + Math.floor(r() * 12), purse: 0, home: 'biz:' + b.id }); c.kid = true; c.parents = [own.id].concat(sp ? [sp.id] : []); c.hh = own.id; }
      const nh = 1 + Math.floor(r() * 2);
      for (let k = 0; k < nh; k++) {
        const hf = FAM[Math.floor(r() * FAM.length)], h = nextHouse();
        const hand = P0({ name: nameFor(hf), age: 18 + Math.floor(r() * 25), job: { type: 'biz', biz: b.id, role: 'hand' } }, h);
        s.biz[b.id].staff.push({ pid: hand.id, wage: 8 + Math.floor(r() * 3) });
        if (r() < 0.5) family(hand, h, hf, Math.floor(r() * 3));
      }
    }
    const jobs = ['cm_fish', 'cm_fish', 'cm_porter', 'cm_porter', 'cm_labour', 'cm_labour', 'cm_carter', 'cm_mason', 'cm_wash', 'cm_castle', 'cm_watch'];
    let n = Object.values(s.people).filter(p => p.town === 'crownmere').length;
    while (n < 1140) {
      const fam = FAM[Math.floor(r() * FAM.length)], h = nextHouse();
      const head = P0({ name: nameFor(fam), age: 20 + Math.floor(r() * 42), job: r() < 0.88 ? { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] } : null }, h);
      const sp = family(head, h, fam, Math.floor(r() * 4));
      if (sp && r() < 0.6) sp.job = { type: 'commons', what: jobs[Math.floor(r() * jobs.length)] };
      n = Object.values(s.people).filter(p => p.town === 'crownmere').length;
    }
    const landlords = Object.values(s.people).filter(p => p.town === 'crownmere' && p.job && p.job.role === 'owner');
    ch.forEach(h => { if (r() < 0.55) { const l = landlords[Math.floor(r() * landlords.length)]; if (!h.tenants.includes(l.id)) h.owner = l.id; } });
    for (const p of Object.values(s.people)) if (p.town === 'crownmere') p.rep = Math.round(repTarget(s, p));
    const masters = Object.values(s.people).filter(p => p.town === 'crownmere' && p.job && p.job.role === 'owner').sort((a, b) => b.rep - a.rep || b.purse - a.purse);
    const mayor = masters[0];
    s.towns.crownmere = { title: 'Lord Mayor', chest: 1500, fee: 'normal', approval: 60, council: masters.slice(1, 7).map(p => p.id), mayor: mayor.id, nextVote: s.day + 7, log: [], lastVote: null };
    plog(s, mayor, 'Chosen Lord Mayor of Crownmere by the guilds.');
  }
  const UPKEEP = { oakbridge: 135, greenhaven: 34, crownmere: 520, ironcrest: 70, eastwatch: 150, dawnport: 80 };
  const FEES = { low: { name: 'Low market fee (2c)', coin: 2 }, normal: { name: 'Market fee (3c)', coin: 3 }, high: { name: 'High market fee (5c)', coin: 5 } };
  function oakFolk(s) { return living(s).filter(p => p.town === 'oakbridge'); }
  function townFolk(s, id) { return living(s).filter(p => p.town === id); }
  const titleOf = T => T.title || 'Mayor';
  // each morning the mayor collects the market fee, pays for the watch and the bridge, and decides
  function townMorning(s) { for (const id in (s.towns || {})) townMorning1(s, id, s.towns[id]); }
  function townMorning1(s, id, T) {
    T.id = id;
    const fee = FEES[T.fee].coin;
    for (const b of Object.values(s.biz)) if (b.town === id && !b.closed) { const o = b.owner === 'player' ? null : s.people[b.owner]; if (o) { o.purse -= fee; T.chest += fee; } else if (b.owner === 'player') { spend(s, fee); T.chest += fee; s.stats.tax = (s.stats.tax || 0) + fee; } }
    const up = UPKEEP[id] || 40; T.chest -= up;
    // a full chest is spent on the town: paving, the watch, the walls, a feast day
    const capC = id === 'crownmere' ? 1500 : id === 'oakbridge' ? 400 : 150;
    if (T.chest > capC) { const w = Math.round((T.chest - capC) * 0.25); T.chest -= w; T.approval = clamp(T.approval + Math.min(1.5, w / 120), 0, 100); if (s.day % 9 === 0) townLog(s, Object.assign(T, { id }), (T.title || 'Mayor') + ' ' + (s.people[T.mayor] ? s.people[T.mayor].name : '') + ' spends ' + w + 'c from the full chest on the town.'); }   // the watch, the bridge, the walls, the streets
    // the mayor feeds the hungry from the town chest, more or less generously
    const m0 = s.people[T.mayor];
    if (m0 && T.chest > 60) {
      const folk0 = townFolk(s, id), hungryKids = new Set(folk0.filter(p => p.kid && p.hungry).flatMap(p => p.parents || []));
      const needy = folk0.filter(p => (p.hungry || p.purse < 3 || hungryKids.has(p.id)) && !p.kid).sort((a, b) => (hungryKids.has(b.id) ? 1 : 0) - (hungryKids.has(a.id) ? 1 : 0)).slice(0, Math.round(Math.max(12, folk0.length * (thriftOf(m0) < 0.5 ? 0.2 : 0.13))));
      const gift = (hungryKids.size > 6 && T.chest > 150) || T.chest > 600 ? 3 : 2; needy.forEach(p => { p.purse += gift; T.chest -= gift; });
      if (needy.length) T.approval = clamp(T.approval + Math.min(2, needy.length / 15), 0, 100);
      T.dole = needy.length * gift;
    } else T.dole = 0;
    if (T.chest < 0) T.chest -= Math.max(1, Math.ceil(-T.chest * INTEREST));
    const m = s.people[T.mayor];
    if (m && s.day % 4 === 0) {
      const k = id === 'oakbridge' ? 1 : id === 'crownmere' ? 4 : 0.35, want = T.chest < 0 ? 'high' : T.chest > 220 * k ? 'low' : T.chest < 60 * k ? 'high' : 'normal';
      if (want !== T.fee) { T.fee = want; T.approval = clamp(T.approval + (want === 'high' ? -6 : want === 'low' ? 4 : 1), 0, 100); townLog(s, T, titleOf(T) + ' ' + m.name + ' sets ' + FEES[want].name.toLowerCase() + (T.chest < 0 ? ', to pay down the town’s debts.' : '.')); }
    }
    if (s.day >= T.nextVote) { T.nextVote = s.day + 7; townVote(s, T); }
  }
  function townLog(s, T, text) { T.log.unshift({ day: s.day, text }); if (T.log.length > 20) T.log.length = 20; event(s, (TOWNS[T.id || 'oakbridge'] || TOWNS.oakbridge).name + ': ' + text, 'info'); }
  /* every town keeps a watch in proportion to its size: about one for every forty people, never fewer than two,
     and the capital a little more. They are townsfolk in a watchman's job, paid from the town chest. */
  const TOWN_WATCH_JOB = { oakbridge: 'watch', greenhaven: 'gh_watch', crownmere: 'cm_watch', ironcrest: 'ic_watch', eastwatch: 'ew_watch', dawnport: 'dp_watch' };
  function watchTarget(s, id) { const pop = id === 'hearthmoor' ? villagers(s).length : townFolk(s, id).length, T = s.towns && s.towns[id]; return Math.max(2, Math.round(pop / (id === 'crownmere' ? 35 : 40) * ((T && T.watchMul) || 1))); }
  function townWatch(s, id, T) {
    const job = TOWN_WATCH_JOB[id]; if (!job) return;
    const folk = townFolk(s, id), on = folk.filter(p => p.job && p.job.type === 'commons' && p.job.what === job), want = watchTarget(s, id);
    T.watchN = on.length; T.watchWant = want;
    // a few changes a day: the town takes on or lets go a watchman or two at a time
    const steps = T.watchSized ? 1 : 40;
    for (let k = 0; k < steps; k++) {
      const n = folk.filter(p => p.job && p.job.type === 'commons' && p.job.what === job).length;
      if (n < want) {
        const c = folk.find(p => !p.kid && !p.retired && p.age >= 18 && p.age <= 55 && !p.held && (!p.job || (p.job.type === 'commons' && p.job.what !== job)));
        if (!c) break; c.job = { type: 'commons', what: job }; plog(s, c, 'Took a place in the ' + (T.title === 'Harbourmaster' ? 'harbour' : 'town') + ' watch.');
      } else if (n > want) {
        const c = folk.filter(p => p.job && p.job.type === 'commons' && p.job.what === job).pop(); const others = Object.keys(COMMON_JOBS).filter(k => k !== job && TOWN_WATCH_JOB[id] && (LAYOUT[id] && LAYOUT[id].spots ? LAYOUT[id].spots[k] : k.startsWith(job.split('_')[0])));
        const nj = others.find(k => k !== job && !k.endsWith('watch')) || null; c.job = nj ? { type: 'commons', what: nj } : null; plog(s, c, 'Let go from the watch: the town has more watchmen than it needs.');
      } else break;
    }
    // a guard above the town's ordinary size is paid for from its chest
    if ((T.watchMul || 1) > 1) T.chest -= Math.round((T.watchMul - 1) * want * 4);
    T.watchSized = true; T.watchN = folk.filter(p => p.job && p.job.type === 'commons' && p.job.what === job).length;
  }
  function townEvening(s) { for (const id in (s.towns || {})) townEvening1(s, id, s.towns[id]); }
  function townEvening1(s, id, T) {
    T.id = id;
    townWatch(s, id, T);
    // a full chest gets spent on walls, wells, the watch and the poor
    if (T.chest > 600 && !(T.mayor === 'player')) T.chest -= Math.round((T.chest - 600) * 0.06);
    // a hungry household sends someone out to find day work: on the quay, in the fields, wherever there is some
    const jobsHere = Object.keys({ greenhaven: GH_JOBS, crownmere: CM_JOBS, ironcrest: IC_JOBS, eastwatch: EW_JOBS, dawnport: DP_JOBS }[id] || OAK_JOBS);
    const famHungry = new Set(townFolk(s, id).filter(p => p.kid && p.hungry).flatMap(p => p.parents || []));
    for (const p of townFolk(s, id)) {
      if (p.kid || p.job || p.retired || p.age < 16 || p.age > 62 || !(p.hungry || famHungry.has(p.id) || p.purse < 4) || rand(s) > 0.35) continue;
      const what = jobsHere[Math.floor(rand(s) * jobsHere.length)];
      p.job = { type: 'commons', what }; plog(s, p, 'Took work as ' + COMMON_JOBS[what][0].toLowerCase() + ' to keep the family fed.');
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
  function townAt(x, z) { let best = null, bd = 1e9; for (const id in TOWNS) { const T = TOWNS[id], d = Math.hypot(x - T.x, z - T.z) - T.r; if (d < 160 && d < bd) { bd = d; best = id; } } return best; }
  function syncBodies(s) {
    const here = townAt(s.player.x, s.player.z);
    if (!here || here === s.bodiesIn) return;
    s.bodiesIn = here;
    s.agents = s.agents.filter(a => a.kind !== 'person' || townOf(s.people[a.pid]) === here);
    for (const p of living(s)) if (townOf(p) === here && !(p.job && ['lord', 'steward', 'taxman'].includes(p.job.office))) { if (!bodyOf(s, p)) { addBody(s, p); const a = bodyOf(s, p); if (a && a.job) a.spot = jobSpot(s, a.job); } }
    s.schedule = s.schedule.filter(e => !e.id || s.agents.some(a => a.id === e.id));
  }

  /* ================= the kingdom of Alderwyn: lords, court, council, crown, and the bandits on its roads =================
     Six regions, each held by a lord under the crown. Your standing with the lords, the guilds, the court and the
     towns is your support; with enough of it, and a lordship and a council seat, the crown itself can be yours. */
  const REGIONS = { hearthmoor: 'Hearthmoor', greenhaven: 'Greenhaven', oakbridge: 'Oakbridge', crownmere: 'the Crown Lands', ironcrest: 'Ironcrest', eastwatch: 'Eastwatch', dawnport: 'Dawnport' };   // Dawnport is Valdoria's, named here only so messages can say where
  const COUNCIL = { treasury: 'Lord Treasurer', trade: 'Master of Trade', war: 'Marshal', law: 'Lord Justice' };
  /* the council is three careers, and you follow one. The road of coin runs from Master of Trade up to Lord
     Treasurer; the road of arms leads to Marshal; the road of law to Lord Justice. Once you have taken a seat on
     one road the others are shut to you, as a soldier who goes for one rank cannot hold its sister rank. */
  const COUNCIL_PATH = { trade: 'coin', treasury: 'coin', war: 'arms', law: 'law' };
  const PATH_NAME = { coin: 'the road of coin', arms: 'the road of arms', law: 'the road of law' };
  // each seat asks for proof that you have walked its road
  function seatNeeds(s, k) {
    const R = s.realm, rec = s.rec, owned = s.shops.length + Object.values(s.biz || {}).filter(b => b.owner === 'player').length, cb = R.contractsByKind || {};
    const supply = (cb.supply || 0) + (cb.repair || 0), clear = cb.clear || 0, patrol = rec.patrolCoin || 0, kept = R.kept || 0;
    const L = {
      trade: [[owned >= 3, 'own 3 shops or businesses (you have ' + owned + ')'], [supply >= 3, 'deliver 3 supply contracts (' + supply + ')']],
      treasury: [[R.council.trade === 'player' || (s.player.seatsHeld || []).includes('trade'), 'serve first as Master of Trade'], [netWorth(s) >= 2500, 'be worth 2,500c (' + netWorth(s) + 'c)'], [!R.embezzled, 'never have taken from the treasury']],
      war: [[patrol >= 300, 'pay 300c for patrols on the roads (' + patrol + 'c)'], [clear >= 1, 'clear one road of bandits by contract (' + clear + ')'], [yourLordships(s).some(id => ((s.bandits || {})[id] || 0) < 25), 'keep the roads of your own lands safe (bandits under 25)']],
      law: [[!!rec.everElder, 'have served as Elder of a town'], [kept >= 2, 'keep 2 promises (' + kept + ')'], [(rec.fairVerdicts || 0) >= 3, 'judge 3 cases by the evidence (' + (rec.fairVerdicts || 0) + ')'], [!(s.justice && s.justice.secrets.some(x => x.exposed && x.weight >= 2)), 'have no proven abuse of office against you']]
    }[k] || [];
    return L.filter(x => !x[0]).map(x => x[1]);
  }
  const LORDSHIP_FEE = { hearthmoor: 300, greenhaven: 350, ironcrest: 500, oakbridge: 600, eastwatch: 800 };
  const LAWS = {
    marketPeace: { name: 'The Market Peace', say: 'Watchmen in every market. Towns feel safe; it costs the treasury 6c a day.' },
    forestLaw: { name: 'Forest Law', say: 'The royal forests are closed to commoners. +10c a day to the treasury; the towns resent it.' },
    guildCharters: { name: 'Guild Charters', say: 'The guilds set their own prices. The guilds love it; the lords do not.' },
    harshJustice: { name: 'Harsh Justice', say: 'Hangings at the crossroads. Bandits stay away; the towns are uneasy.' },
    fairCourts: { name: 'The Fair Courts', say: 'Ambrose Fell\u2019s reform: favour can no longer be bought so easily, and theft from the treasury is hunted down. The towns approve; the lords grumble.' }
  };
  const SEATS = () => ({ crownmere: { x: CM.castle.x, z: CM.castle.z + 10 }, oakbridge: { x: OAK.keep.x, z: OAK.keep.z + 9 }, greenhaven: { x: GH.estate.x + 9, z: GH.estate.z }, ironcrest: { x: IC.keep.x + 8, z: IC.keep.z + 6 }, eastwatch: { x: EW.keep.x, z: EW.keep.z - 12 }, hearthmoor: MANOR_HOME });
  function noble(s, o) { const p = newPerson(s, Object.assign({ purse: 600, palette: 4, retired: true, rep: 70, mood: 70 }, o)); p.log = [{ day: s.day, text: o.why || 'Of noble blood.' }]; return p; }
  function setupRealm(s) {
    if (s.realm) return;
    const king = noble(s, { name: 'Aldwin Ardane', age: 66, town: 'crownmere', home: 'seat:crownmere', why: 'King of Alderwyn.' });
    const prince = noble(s, { name: 'Edmund Ardane', age: 19, town: 'crownmere', home: 'seat:crownmere', why: 'Prince of Alderwyn, the King’s only son.' }); prince.parents = [king.id];
    const lord = (name, age, town, why) => noble(s, { name, age, town, home: 'seat:' + town, why });
    const est = s.biz.g_estate && s.people[s.biz.g_estate.owner];
    const regions = {
      hearthmoor: { lord: 'office', tax: 1, patrol: 1, garrison: 0, roads: 1 },
      greenhaven: { lord: est ? est.id : lord(s, 'Mathis Ashcombe', 52, 'greenhaven', 'Lord of Greenhaven, of Ashcombe Hall.').id, tax: 1, patrol: 1, garrison: 0, roads: 1 },
      oakbridge: { lord: lord('Isolde Marlowe', 47, 'oakbridge', 'Lady of Oakbridge, who holds the keep.').id, tax: 1, patrol: 1, garrison: 1, roads: 1 },
      crownmere: { lord: 'crown', tax: 1, patrol: 2, garrison: 2, roads: 2 },
      ironcrest: { lord: lord('Gareth Stane', 58, 'ironcrest', 'Lord of Ironcrest and its mines.').id, tax: 1, patrol: 1, garrison: 1, roads: 1 },
      eastwatch: { lord: lord('Rowena Tarrant', 44, 'eastwatch', 'Lady of Eastwatch, Warden of the Coast.').id, tax: 1, patrol: 1, garrison: 1, roads: 1 }
    };
    for (const id in regions) { const r = regions[id]; if (r.lord && r.lord !== 'office' && r.lord !== 'crown' && s.people[r.lord]) { s.people[r.lord].noble = id; s.people[r.lord].opinion = 0; } }
    const courtier = (name, age, why) => noble(s, { name, age, town: 'crownmere', home: 'seat:crownmere', why });
    const council = { treasury: courtier('Hugo Wendle', 61, 'Lord Treasurer of Alderwyn.').id, trade: courtier('Margery Cole', 50, 'Master of Trade.').id, war: courtier('Ralph Durrant', 55, 'Marshal of Alderwyn.').id, law: courtier('Ambrose Fell', 63, 'Lord Justice.').id };
    s.realm = { king: king.id, prince: prince.id, crown: 'king', regions, council, favour: 0, kingSupport: 60, treasury: 1500, taxRate: 1, tariff: 1, laws: { marketPeace: true, forestLaw: false, guildCharters: false, harshJustice: false }, levies: 120, support: { lords: 40, guilds: 40, court: 0, towns: 40 }, rival: null, exile: null, lowDays: 0, debtDays: 0, log: [], offer: null, crowned: null };
    s.bandits = { oakbridge: 20, greenhaven: 15, hearthmoor: 10, crownmere: 10, ironcrest: 30, eastwatch: 25, lastRaid: null };
    setupFigures(s);
  }
  function realmLog(s, text, kind) { const R = s.realm; R.log.unshift({ day: s.day, text }); if (R.log.length > 30) R.log.length = 30; event(s, text, kind || 'info'); }
  const isRuler = s => !!(s.realm && s.realm.crown === 'player');
  const yourLordships = s => s.realm ? Object.keys(s.realm.regions).filter(id => regionLord(s, id) === 'player') : [];
  const yourSeats = s => s.realm ? Object.keys(COUNCIL).filter(k => s.realm.council[k] === 'player') : [];
  function regionLord(s, id) { const r = s.realm.regions[id]; if (r.lord === 'office') return s.offices.lord; if (r.lord === 'crown') return s.realm.crown === 'player' ? 'player' : s.realm.king; return r.lord; }
  function lordName(s, id) { const l = regionLord(s, id); return l === 'player' ? s.name : l && s.people[l] ? s.people[l].name : 'no one'; }
  const op01 = p => p ? clamp(50 + (p.opinion || 0) / 2, 0, 100) : 50;
  function computeSupport(s) {
    const R = s.realm, S = R.support;
    const lords = Object.keys(R.regions).map(id => { const l = regionLord(s, id); return l === 'player' ? 100 : l && s.people[l] ? op01(s.people[l]) : 50; });
    const owners = Object.values(s.biz).filter(b => !b.closed && b.owner !== 'player' && !(TOWNS[b.town] && TOWNS[b.town].foreign)).map(b => s.people[b.owner]).filter(Boolean);
    const mine = Object.values(s.biz).filter(b => b.owner === 'player').length;
    const mono = R.monopoly && !((R.figures || []).find(f => f.kind === 'merchant') || {}).ally ? 10 : 0;
    let guilds = avg(owners.map(op01)) + Math.min(15, mine * 2) - mono - (isRuler(s) ? (R.taxRate - 1) * 40 + (R.tariff - 1) * 15 - (R.laws.guildCharters ? 15 : 0) : 0);
    const tw = Object.keys(TOWNS).filter(t => !TOWNS[t].foreign).map(t => { const f = living(s).filter(p => townOf(p) === t && !p.kid); return f.length ? avg(f.slice(0, 120).map(op01)) : 50; });
    let towns = avg(tw) * 0.75 + (s.village ? s.village.standing : 0) * 0.15 + 10 + (R.laws.fairCourts ? 8 : 0) - (isRuler(s) ? (R.taxRate - 1) * 35 + (R.laws.forestLaw ? 8 : 0) + (R.laws.harshJustice ? 6 : 0) - (R.laws.marketPeace ? 6 : 0) : 0);
    let court = R.favour + yourSeats(s).length * 6 + yourLordships(s).length * 4;
    let lordAvg = avg(lords) - (R.laws.fairCourts ? 6 : 0) - (isRuler(s) && R.laws.guildCharters ? 10 : 0) - (isRuler(s) && R.debtDays > 5 ? 15 : 0);
    S.lords = Math.round(clamp(lordAvg, 0, 100)); S.guilds = Math.round(clamp(guilds, 0, 100)); S.court = Math.round(clamp(court, 0, 100)); S.towns = Math.round(clamp(towns, 0, 100));
    return Math.round((S.lords + S.guilds + S.court + S.towns) / 4);
  }
  const supportOf = s => s.realm ? Math.round((s.realm.support.lords + s.realm.support.guilds + s.realm.support.court + s.realm.support.towns) / 4) : 0;
  // bandits gather on the roads; patrols, garrisons, watchmen and the army keep them down
  function banditDay(s) {
    const B = s.bandits, R = s.realm; if (!B || !R) return;
    for (const id in R.regions) {
      const g = R.regions[id], army = R.levies / 150, watch = id === 'hearthmoor' ? Object.values(s.offices || {}).filter(x => x).length * 0.1 : 0;
      const down = g.patrol * 1.3 + g.garrison * 0.6 + army + watch + (R.laws.harshJustice ? 1.2 : 0) + (yourSeats(s).includes('war') ? 0.5 : 0);
      B[id] = clamp((B[id] || 0) + 1.6 + rand(s) * 1.6 - down, 0, 100);
      if (B[id] > 45 && rand(s) < (B[id] - 45) / 140) banditRaid(s, id);
    }
  }
  function banditRaid(s, id) {
    const B = s.bandits, g = s.realm.regions[id], guard = g.garrison * 0.25, name = REGIONS[id];
    let took = 0, what = [];
    const T = s.towns && s.towns[id];
    if (T) { const t = Math.round(Math.max(0, T.chest) * (0.12 - guard * 0.03)); T.chest -= t; took += t; if (t) what.push(t + 'c from the town chest'); T.approval = clamp(T.approval - 4, 0, 100); }
    if (id === 'hearthmoor' && s.gov) { const t = Math.min(s.village.granary || 0, 6); s.village.granary -= t; if (t) what.push(t + ' grain from the granary'); }
    const mine = Object.values(s.biz).filter(b => (b.town || 'hearthmoor') === id && b.owner === 'player' && !b.closed);
    if (mine.length) { const t = Math.round(12 * (1 - guard)); spend(s, t); took += t; what.push(t + 'c of your stock'); }
    if (id === 'hearthmoor') for (const sh of s.shops) { const t = Math.min(sh.goods, 3); sh.goods -= t; if (t) what.push(t + ' goods from your ' + TRADES[sh.trade].name.toLowerCase()); }
    const folk = living(s).filter(p => townOf(p) === id && !p.kid && p.purse > 10);
    for (let k = 0; k < 3 && folk.length; k++) { const p = folk[Math.floor(rand(s) * folk.length)], t = Math.round(p.purse * 0.3); p.purse -= t; p.mood = clamp(p.mood - 12, 0, 100); plog(s, p, 'Robbed by bandits.'); }
    if (rand(s) < 0.12 - guard * 0.1 && folk.length) { const p = folk[Math.floor(rand(s) * folk.length)]; dies(s, p, 'killed by bandits'); what.push(p.name + ' was killed'); }
    B[id] = Math.max(0, B[id] - 30); B.lastRaid = { town: id, day: s.day };
    if (s.realm.regions[id] && regionLord(s, id) !== 'player') { const l = regionLord(s, id); if (l && s.people[l] && l !== s.realm.king) s.people[l].rep = Math.max(0, (s.people[l].rep || 0) - 3); }
    realmLog(s, 'Bandits raid ' + name + (what.length ? ': ' + what.join(', ') + '.' : '.') + ' More patrols on the roads would keep them away.', 'bad');
  }
  // the roads between towns are the bandits' hunting ground, worst at night
  function roadAmbush(s, a, b, mins) {
    if (!s.bandits) return null;
    const lvl = Math.max(s.bandits[a] || 0, s.bandits[b] || 0), h = hourOf(s), night = h >= 20 || h < 5;
    const chance = clamp((lvl - 20) / 300 * (night ? 2 : 1) * (s.player.riding ? 0.5 : 1) * Math.min(2, mins / 60), 0, 0.5);
    if (rand(s) >= chance) return null;
    const lost = Math.round(Math.min(Math.max(0, s.coins) * 0.15, 80)), inv = s.player.inv; spend(s, lost);
    const goods = Object.keys(inv).filter(g => inv[g]).map(g => { const n = Math.ceil(inv[g] / 2); inv[g] -= n; return n + ' ' + g; });
    const text = 'Bandits waylay you on the road' + (night ? ' in the dark' : '') + ' and take ' + lost + 'c' + (goods.length ? ' and ' + goods.join(', ') : '') + '.';
    event(s, text, 'bad'); return text;
  }
  // a day at court
  /* ---------- petitions to the crown: the few decisions only a ruler makes ---------- */
  // Most of the realm runs itself. Now and then something comes that only the crown can answer: a town in a hard winter,
  // a lord who defies the crown's court, a noble accused by a commoner, the guilds asking for relief. Each has a real cost
  // either way, and unanswered ones answer themselves after six days.
  function petitionsDay(s) {
    const R = s.realm; if (!isRuler(s)) return;
    R.petitions = (R.petitions || []).filter(q => { if (s.day < q.until) return true; answerPetition(s, q, -1); return false; });
    if (R.petitions.length >= 2 || rand(s) > 0.11) return;
    const kinds = [], winter = seasonOf(s) === 'winter' || calendar(s).month === 0;
    const hungryTown = Object.keys(TOWNS).filter(t => !TOWNS[t].foreign).map(t => ({ t, n: living(s).filter(p => townOf(p) === t && !p.kid && p.hungry).length })).sort((a, b) => b.n - a.n)[0];
    if (hungryTown && hungryTown.n >= (winter ? 3 : 6)) kinds.push('relief');
    const lords = Object.keys(R.regions).map(id => ({ id, l: regionLord(s, id) })).filter(x => x.l && x.l !== 'player' && s.people[x.l] && (s.people[x.l].opinion || 0) < 45);
    if (lords.length) kinds.push('defiance');
    const nobles = living(s).filter(p => p.noble && p.status === 'here' && !p.held && s.courts && s.courts[townOf(p)]);
    if (nobles.length) kinds.push('noble');
    if (R.tariff > 1 || winter || seasonOf(s) === 'autumn') kinds.push('guilds');
    // the same kind of petition does not come twice within fifteen days
    R.lastPet = R.lastPet || {}; const fresh = kinds.filter(x => !(R.lastPet[x] != null && s.day - R.lastPet[x] < 15)); if (!fresh.length) return;
    const k = fresh[Math.floor(rand(s) * fresh.length)]; R.lastPet[k] = s.day; const id = (R.nextPetition = (R.nextPetition || 0) + 1), base = { id, kind: k, day: s.day, until: s.day + 6 };
    if (k === 'relief') { const t = hungryTown.t; R.petitions.push(Object.assign(base, { town: t, cost: 60 + hungryTown.n * 4, text: 'The people of ' + REGIONS[t].replace(/^the /, '') + ' are going hungry: ' + hungryTown.n + ' grown folk had no bread last night. Their council asks the crown for grain.' })); }
    else if (k === 'defiance') { const x = lords[Math.floor(rand(s) * lords.length)], L = s.people[x.l]; R.petitions.push(Object.assign(base, { lord: x.l, region: x.id, text: L.name + ', who holds ' + REGIONS[x.id] + ', has set free a man your judges sent to his gaol, and says the crown’s court has no business in his lands.' })); }
    else if (k === 'noble') {
      const N = nobles[Math.floor(rand(s) * nobles.length)], C = s.courts.crownmere, vict = townFolk(s, townOf(N)).filter(p => !p.kid && !p.noble && p.status === 'here')[0]; if (!vict) return;
      const guilty = rand(s) < 0.65, c = newCase(s, 'assault', { accused: N.id, accuser: vict.id, victim: vict.id, value: 20, where: C.name, truth: guilty ? 'guilty' : 'lie', what: vict.name + ' says ' + N.name + ' had them beaten for blocking the road', claim: vict.name + ' says ' + N.name + '’s men beat them on their master’s word.' }, C);
      c.hidden = evidencePool(s, c); c.requested = true; c.delegated = false;
      realmLog(s, 'A commoner of ' + REGIONS[townOf(N)] + ' accuses ' + N.name + ', a noble, of assault. Nobles answer to the crown\u2019s court in Crownmere.', 'info'); return;
    }
    else R.petitions.push(Object.assign(base, { text: 'The guilds of Alderwyn ask the crown to lower the tariff' + (winter ? ' through the winter, while trade is thin' : '') + '. They say the roads are emptying of merchants.' }));
    realmLog(s, 'A petition to the crown: ' + R.petitions[R.petitions.length - 1].text, 'info');
  }
  const PETITION_CHOICES = {
    relief: q => ['Send ' + q.cost + 'c of grain from the treasury', 'Let the town see to its own'],
    defiance: q => ['Summon the lord and fine him 80c', 'Let it pass, this once'],
    guilds: q => ['Lower the tariff by a quarter', 'Keep the tariff']
  };
  // choice -1 means no answer came in time: it counts as the second choice, and a little worse for the silence
  function answerPetition(s, q, choice) {
    const R = s.realm, quiet = choice === -1, c = quiet ? 1 : choice;
    if (q.kind === 'relief') {
      const folk = living(s).filter(p => townOf(p) === q.town && !p.kid);
      if (c === 0) { R.treasury -= q.cost; folk.forEach(p => { if (p.hungry) { p.ate = (p.ate || 0) + 6; p.hungry = false; } p.opinion = clamp((p.opinion || 0) + 4, -100, 100); }); const T = s.towns && s.towns[q.town]; if (T) T.approval = clamp((T.approval || 50) + 6, 0, 100); realmLog(s, 'Crown grain reaches ' + REGIONS[q.town] + '. The town will remember it.', 'good'); }
      else { folk.forEach(p => p.opinion = clamp((p.opinion || 0) - (quiet ? 4 : 3), -100, 100)); const T = s.towns && s.towns[q.town]; if (T) T.approval = clamp((T.approval || 50) - 4, 0, 100); realmLog(s, quiet ? 'No answer comes from the crown, and ' + REGIONS[q.town] + ' goes hungry.' : 'The crown tells ' + REGIONS[q.town] + ' to see to its own.', 'bad'); }
    } else if (q.kind === 'defiance') {
      const L = s.people[q.lord], others = Object.keys(R.regions).map(id => regionLord(s, id)).filter(l => l && l !== 'player' && l !== q.lord && s.people[l]).map(l => s.people[l]);
      if (c === 0) { R.treasury += 80; if (L) { L.opinion = clamp((L.opinion || 0) - 25, -100, 100); L.purse -= 80; } others.forEach(o => o.opinion = clamp((o.opinion || 0) + 3, -100, 100)); R.favour = clamp(R.favour + 2, 0, 100); realmLog(s, (L ? L.name : 'The lord') + ' is summoned to the Great Hall and fined. The other lords take note.', 'info'); }
      else { if (L) L.opinion = clamp((L.opinion || 0) + 5, -100, 100); others.forEach(o => o.opinion = clamp((o.opinion || 0) - (quiet ? 6 : 4), -100, 100)); R.favour = clamp(R.favour - 2, 0, 100); realmLog(s, (L ? L.name : 'The lord') + '’s defiance goes unanswered. Other lords wonder what else they can get away with.', 'bad'); }
    } else if (q.kind === 'guilds') {
      const owners = Object.values(s.biz).filter(b => !b.closed && b.owner !== 'player' && !(TOWNS[b.town] && TOWNS[b.town].foreign)).map(b => s.people[b.owner]).filter(Boolean);
      if (c === 0) { R.tariff = Math.max(0.5, R.tariff - 0.25); owners.forEach(o => o.opinion = clamp((o.opinion || 0) + 4, -100, 100)); realmLog(s, 'The crown lowers the tariff to ' + R.tariff + '×. The guilds are pleased; the treasury will feel it.', 'good'); }
      else { owners.forEach(o => o.opinion = clamp((o.opinion || 0) - (quiet ? 3 : 2), -100, 100)); realmLog(s, quiet ? 'The guilds’ petition goes unanswered.' : 'The crown keeps the tariff. The guilds grumble.', 'info'); }
    }
  }
  function realmDay(s) {
    const R = s.realm; if (!R) return;
    setupFigures(s);
    banditDay(s); contractDay(s); promiseDay(s); goodRuleDay(s); treasuryWatch(s); petitionsDay(s);
    if (s.day % 7 === 3) figuresWeek(s);
    { const m = (R.figures || []).find(f => f.kind === 'merchant'); if (m && m.ally) { const n = Object.values(s.biz).filter(b => b.owner === m.pid).length; if (n) { earn(s, n * 2); s.stats.partner = (s.stats.partner || 0) + n * 2; } } }
    // the old king's standing drifts; hard times and raids wear it down
    R.kingSupport = clamp(R.kingSupport + (58 - R.kingSupport) * 0.03 + (rand(s) - 0.55) * 3 - (s.bandits && s.bandits.lastRaid && s.bandits.lastRaid.day === s.day ? 1.5 : 0), 5, 95);
    R.favour = clamp(R.favour - 0.15, 0, 100);
    // NPC lords: lands pass to a grown child with the crown's recognition, or back to the crown
    for (const id in R.regions) {
      const g = R.regions[id]; if (g.lord === 'office' || g.lord === 'crown' || g.lord === 'player') continue;
      const L0 = s.people[g.lord]; if (L0 && L0.status !== 'dead' && L0.status !== 'left') continue;
      const heir = L0 && living(s).find(c => (c.parents || []).includes(L0.id) && !c.kid && c.age >= 16);
      if (heir) { g.lord = heir.id; heir.noble = id; heir.home = 'seat:' + id; heir.retired = true; if (heir.job) loseJob(s, heir, 'Inherited the lordship of ' + REGIONS[id] + '.'); realmLog(s, heir.name + ' inherits ' + REGIONS[id] + ', and the crown recognises the claim.', 'story'); }
      else { g.lord = null; vacantSeat(s, id); }
    }
    for (const id in R.regions) if (R.regions[id].lord === null) vacantSeat(s, id);
    // the council: dead councillors are replaced by the crown
    for (const k in COUNCIL) { const c = R.council[k]; if (c !== 'player' && (!s.people[c] || s.people[c].status === 'dead')) { R.council[k] = noble(s, { name: nameForNoble(s), age: 45 + Math.floor(rand(s) * 15), town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[k] + '.' }).id; realmLog(s, 'A new ' + COUNCIL[k] + ' is named at court.', 'info'); } }
    // the old king dies, or the realm needs a new ruler
    const K = s.people[R.king];
    if (R.crown === 'king' && (!K || K.status === 'dead')) succession(s, 'King ' + (K ? K.name.split(' ')[0] : 'Aldwin') + ' has died');
    // your offices pay
    for (const k of yourSeats(s)) { earn(s, 8); s.stats.salaries = (s.stats.salaries || 0) - 8; }
    for (const id of yourLordships(s)) if (id !== 'hearthmoor' && id !== 'crownmere') { const g = R.regions[id], inc = Math.round(18 * g.tax * marketOf(s, id)) - g.patrol * 4 - g.garrison * 6 - g.roads * 3; if (inc >= 0) earn(s, inc); else spend(s, -inc); s.stats.lands = (s.stats.lands || 0) + inc; }
    // ruling: the treasury, the army, and the realm's mood
    if (isRuler(s)) {
      const inc = Math.round(Object.keys(R.regions).reduce((t, id) => t + 16 * R.taxRate * marketOf(s, id), 0) + 20 * R.tariff + (R.laws.forestLaw ? 10 : 0));
      const out = Math.round(R.levies * 0.25 + 60 + (R.laws.marketPeace ? 6 : 0) + Object.keys(COUNCIL).length * 8);
      R.treasury += inc - out; R.lastIncome = inc; R.lastSpend = out;
      R.debtDays = R.treasury < 0 ? R.debtDays + 1 : 0;
      if (R.debtDays === 5) realmLog(s, 'The treasury is in debt. The lords grumble, and the army goes unpaid.', 'bad');
      if (R.debtDays > 5) R.levies = Math.max(0, R.levies - 10);
    }
    const sup = computeSupport(s);
    // a rival claimant rises against a weak ruler
    if (isRuler(s)) {
      R.lowDays = sup < 30 ? R.lowDays + 1 : 0;
      if (!R.rival && sup < 42 && rand(s) < 0.08) { R.rival = { name: R.prince && s.people[R.prince] && s.people[R.prince].status === 'here' ? s.people[R.prince].name : nameForNoble(s), strength: 60, since: s.day }; realmLog(s, R.rival.name + ' claims the crown of Alderwyn and gathers men. Raise your levies, win back support, or pay them off.', 'bad'); }
      if (R.rival) { R.rival.strength = clamp(R.rival.strength + (50 - sup) / 10 + 1, 0, 400); if (R.rival.strength < 10) { realmLog(s, R.rival.name + '’s claim collapses; their men drift home.', 'good'); R.rival = null; } }
      if (R.rival && R.rival.strength > R.levies + sup * 2) fallFromThrone(s, R.rival.name + '’s army takes Crownmere');
      else if (R.lowDays >= 6) fallFromThrone(s, 'the lords and the court abandon you');
    }
  }
  function nameForNoble(s) { const F = ['Hugh', 'Walter', 'Cecily', 'Geoffrey', 'Matilda', 'Roger', 'Eleanor', 'Baldwin', 'Joan', 'Simon'], L = ['Vane', 'Ashworth', 'Grayle', 'Monfort', 'Thorne', 'Beaumont', 'Corbet', 'Lacy']; return F[Math.floor(rand(s) * F.length)] + ' ' + L[Math.floor(rand(s) * L.length)]; }
  function vacantSeat(s, id) {
    const R = s.realm, g = R.regions[id]; if (g.lord) return;
    if (R.favour >= 50 && totalDeeds(s) >= 1 && !R.offer && !R.exile) { R.offer = { kind: 'lordship', region: id, day: s.day, fee: Math.round((LORDSHIP_FEE[id] || 400) * 0.4) }; g.lord = null; realmLog(s, 'The lordship of ' + REGIONS[id] + ' stands empty. The King offers it to you, for a fee of 150c and your oath. Answer at the castle or on the Realm page.', 'story'); return; }
    if (R.offer && R.offer.region === id && s.day - R.offer.day < 5) return;
    const n = noble(s, { name: nameForNoble(s), age: 40 + Math.floor(rand(s) * 15), town: id === 'hearthmoor' ? undefined : id, home: 'seat:' + id, why: 'Granted ' + REGIONS[id] + ' by the crown.' });
    n.noble = id; g.lord = n.id; if (R.offer && R.offer.region === id) R.offer = null;
    realmLog(s, 'The crown grants ' + REGIONS[id] + ' to ' + n.name + '.', 'info');
  }
  function succession(s, why) {
    const R = s.realm, sup = computeSupport(s), canYou = yourLordships(s).length > 0 && yourSeats(s).length > 0 && !R.exile;
    const pr = R.prince && s.people[R.prince];
    if (canYou && sup >= 55) return crownYou(s, why + ', and the council chooses you to succeed him');
    if (pr && pr.status === 'here') { R.king = pr.id; R.crown = 'king'; R.kingSupport = 50; R.prince = null; realmLog(s, why + '. ' + pr.name + ' is crowned King of Alderwyn.', 'story'); return; }
    const n = noble(s, { name: nameForNoble(s), age: 45, town: 'crownmere', home: 'seat:crownmere', why: 'Crowned by the council.' }); R.king = n.id; R.kingSupport = 45; realmLog(s, why + '. The council crowns ' + n.name + '.', 'story');
  }
  function crownYou(s, why) {
    const R = s.realm, K = s.people[R.king];
    if (K && K.status === 'here') { K.retired = true; plog(s, K, 'Gave up the crown to ' + s.name + '.'); }
    R.crown = 'player'; R.rival = null; R.lowDays = 0; R.debtDays = 0; R.crowned = s.day; R.exile = null; s.rec.crowned = (s.rec.crowned || 0) + 1;
    realmLog(s, why + '. You are crowned ' + (you(s).sex === 'f' ? 'Queen' : 'King') + ' of Alderwyn in the Great Hall of the Realm. The treasury, the laws and the army are yours to command.', 'story');
  }
  function fallFromThrone(s, why) {
    const R = s.realm;
    R.crown = 'king'; const pr = R.prince && s.people[R.prince];
    if (R.rival && R.rival.name) { const n = (pr && pr.name === R.rival.name) ? pr : noble(s, { name: R.rival.name, age: 40, town: 'crownmere', home: 'seat:crownmere', why: 'Took the crown of Alderwyn.' }); R.king = n.id; if (n === pr) R.prince = null; }
    else if (pr && pr.status === 'here') { R.king = pr.id; R.prince = null; }
    else R.king = noble(s, { name: nameForNoble(s), age: 45, town: 'crownmere', home: 'seat:crownmere', why: 'Crowned after the fall.' }).id;
    R.kingSupport = 55; R.rival = null; R.lowDays = 0;
    // exile: stripped of lordships and seats, part of your wealth seized
    for (const id of yourLordships(s)) { if (R.regions[id].lord === 'office') { s.offices.lord = null; replaceLord(s, 'the old ruler fell'); } else if (R.regions[id].lord === 'player') { R.regions[id].lord = null; } }
    for (const k of yourSeats(s)) R.council[k] = noble(s, { name: nameForNoble(s), age: 50, town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[k] + ' by the new king.' }).id;
    const seized = Math.round(Math.max(0, s.coins) * 0.5); spend(s, seized);
    R.favour = 0; R.exile = { since: s.day, why, seized, allies: [], fund: 0 }; R.embezzled = 0;
    if (s.player.seat) { s.player.seat = null; bringFamily(s, 'Fled the seat with ' + s.name + '.'); }
    realmLog(s, 'You have lost the crown: ' + why + '. You flee into exile, stripped of your lordships and council seats, and ' + seized + 'c is seized. To come back you will need sworn allies, a war chest, the towns behind you, and the new ruler\u2019s failings laid bare.', 'bad');
  }
  /* ================= power earned by deeds (Stage V) =================
     Contracts from the lords and towns, promises to keep, regions governed well, and three people of
     influence with aims of their own. Gifts and feasts still help, but less each time. */
  const REGION_GOODS = { hearthmoor: 'grain', greenhaven: 'grain', oakbridge: 'wood', crownmere: 'grain', ironcrest: 'wood', eastwatch: 'wood' };
  function deedsIn(s, id) { const R = s.realm; return (R.deeds && R.deeds[id]) || 0; }
  const totalDeeds = s => s.realm && s.realm.deeds ? Object.values(s.realm.deeds).reduce((a, b) => a + b, 0) : 0;
  function addDeed(s, id, text) { const R = s.realm; R.deeds = R.deeds || {}; R.deeds[id] = (R.deeds[id] || 0) + 1; realmLog(s, text, 'good'); }
  // repeated gifts and feasts count for less: each one in the last fortnight halves the next
  function diminish(s, key) { const R = s.realm; R.patron = R.patron || {}; const recent = (R.patron[key] || []).filter(d => s.day - d < 14); R.patron[key] = recent.concat([s.day]); return Math.pow(0.5, recent.length); }
  function alliesOf(s) {
    const R = s.realm, out = [];
    for (const id in R.regions) { const l = regionLord(s, id); if (l && l !== 'player' && s.people[l] && l !== R.king && (s.people[l].opinion || 0) >= 40) out.push(s.people[l].name); }
    for (const f of R.figures || []) if (f.ally && s.people[f.pid] && s.people[f.pid].status !== 'dead' && !out.includes(s.people[f.pid].name)) out.push(s.people[f.pid].name);
    return out;
  }
  // contracts: the realm's lords and towns ask for things to be done
  function contractDay(s) {
    const R = s.realm; R.contracts = (R.contracts || []).filter(c => !c.done);
    for (const c of R.contracts) {
      if (c.taken && c.kind === 'clear' && s.bandits && (s.bandits || {})[c.region] < 20) completeContract(s, c);
      else if (s.day > c.until) {
        if (c.taken) { const l = regionLord(s, c.region), q = l && l !== 'player' && s.people[l]; if (q) q.opinion = clamp((q.opinion || 0) - 10, -100, 100); realmLog(s, 'You failed to ' + c.what + ' in time. ' + (q ? q.name + ' remembers.' : ''), 'bad'); s.rec.contractsMissed = (s.rec.contractsMissed || 0) + 1; }
        c.done = true;
      }
    }
    R.contracts = R.contracts.filter(c => !c.done);
    if (R.contracts.filter(c => !c.taken).length < 3 && rand(s) < 0.6) {
      const short = (s.shocks || []).filter(x => !x.glut && s.day - x.day <= 10 && R.regions[x.town]).slice(-1)[0], useShort = short && rand(s) < 0.6;
      const ids = Object.keys(R.regions), id = useShort ? short.town : ids[Math.floor(rand(s) * ids.length)], who = regionLord(s, id) === 'player' ? (TOWNS[id] ? TOWNS[id].name + ' council' : 'the village') : lordName(s, id);
      const k = rand(s), n0 = R.contractN = (R.contractN || 0) + 1;
      let c;
      if (k < 0.45 || useShort) { const g = useShort ? short.good : rand(s) < 0.5 ? REGION_GOODS[id] : GOODS[Math.floor(rand(s) * 3)], n = 10 + Math.floor(rand(s) * 3) * 5; c = { n: n0, kind: 'supply', region: id, good: g, qty: n, reward: Math.round(n * goodsPrice(s, id, g) * 1.7 + 10), what: 'deliver ' + n + ' ' + (g === 'wood' ? 'timber' : g === 'ore' ? 'iron ore' : g) + ' to the market in ' + REGIONS[id] }; }
      else if (k < 0.75) { const w = 10 + Math.floor(rand(s) * 3) * 5, coin = 40 + Math.floor(rand(s) * 4) * 20; c = { n: n0, kind: 'repair', region: id, good: 'wood', qty: w, cost: coin, reward: Math.round(coin * 0.5 + w * 3), what: 'repair the ' + ['bridge', 'town walls', 'mill race', 'road', 'granary'][Math.floor(rand(s) * 5)] + ' in ' + REGIONS[id] + ' (' + coin + 'c and ' + w + ' timber)' }; }
      else { c = { n: n0, kind: 'clear', region: id, reward: 90, what: 'clear the bandits from the roads of ' + REGIONS[id] + ' (danger under 20)' }; if (((s.bandits || {})[id] || 0) < 25) c = null; }
      if (c) { c.who = who; c.until = s.day + 6; c.day = s.day; R.contracts.push(c); }
    }
  }
  function completeContract(s, c) {
    const R = s.realm; c.done = true; earn(s, c.reward); s.stats.contract += c.reward; R.contractsByKind = R.contractsByKind || {}; R.contractsByKind[c.kind] = (R.contractsByKind[c.kind] || 0) + 1;
    const l = regionLord(s, c.region), q = l && l !== 'player' && s.people[l]; if (q) q.opinion = clamp((q.opinion || 0) + 15, -100, 100);
    for (const p of living(s)) if (townOf(p) === c.region && !p.kid && rand(s) < 0.35) p.opinion = clamp((p.opinion || 0) + 4, -100, 100);
    if (s.towns && s.towns[c.region]) s.towns[c.region].approval = clamp(s.towns[c.region].approval + 2, 0, 100);
    s.rec.contractsDone = (s.rec.contractsDone || 0) + 1;
    addDeed(s, c.region, 'You ' + c.what.replace(/^deliver/, 'delivered').replace(/^repair/, 'repaired').replace(/^clear/, 'cleared') + ', as ' + c.who + ' asked. ' + c.reward + 'c, and ' + (q ? q.name + '’s' : 'the town’s') + ' gratitude.');
  }
  // promises: now and then a lord asks for your word
  function promiseDay(s) {
    const R = s.realm; R.promises = R.promises || [];
    for (const pr of R.promises) {
      if (pr.state !== 'given') continue;
      const ok = ((s.bandits || {})[pr.region] || 0) < 30, q = s.people[pr.pid];
      if (!ok) { pr.state = 'broken'; R.broken = (R.broken || 0) + 1; if (q) q.opinion = clamp((q.opinion || 0) - 30, -100, 100); realmLog(s, 'You gave ' + (q ? q.name : 'a lord') + ' your word the roads of ' + REGIONS[pr.region] + ' would stay safe, and they did not. Your word counts for less now.', 'bad'); }
      else if (s.day >= pr.until) { pr.state = 'kept'; R.kept = (R.kept || 0) + 1; if (q) q.opinion = clamp((q.opinion || 0) + 25, -100, 100); addDeed(s, pr.region, 'You kept your word to ' + (q ? q.name : 'the lord') + ': the roads of ' + REGIONS[pr.region] + ' stayed safe for a week.'); }
    }
    R.promises = R.promises.filter(p => p.state === 'asked' ? s.day - p.day < 4 : s.day - p.day < 30);
    if (!R.promises.some(p => p.state === 'asked' || p.state === 'given') && rand(s) < 0.15) {
      const ids = Object.keys(R.regions).filter(id => { const l = regionLord(s, id); return l && l !== 'player' && l !== R.king && s.people[l]; });
      if (ids.length) { const id = ids[Math.floor(rand(s) * ids.length)], q = s.people[regionLord(s, id)]; R.promises.push({ region: id, pid: q.id, day: s.day, state: 'asked' }); realmLog(s, q.name + ' asks for your word that the roads of ' + REGIONS[id] + ' will stay safe for a week. Answer on the Realm page.', 'story'); }
    }
  }
  // good government: a lord whose roads are safe and whose markets thrive earns a name for it
  function goodRuleDay(s) {
    const R = s.realm; R.goodDays = R.goodDays || {};
    for (const id of yourLordships(s)) { const good = ((s.bandits || {})[id] || 0) < 30 && marketOf(s, id) >= 0.98; R.goodDays[id] = good ? (R.goodDays[id] || 0) + 1 : 0; if (R.goodDays[id] === 10) addDeed(s, id, 'Ten days of safe roads and busy markets: ' + REGIONS[id] + ' is known to be well governed.'); }
  }
  // the treasury: what a ruler takes for themself may be found out
  function treasuryWatch(s) {
    const R = s.realm; if (!(R.embezzled > 0)) return;
    const reform = (R.figures || []).find(f => f.kind === 'reformer'), keen = reform && !reform.ally ? 2 : 1;
    if (rand(s) < Math.min(0.5, R.embezzled / 2500 * keen)) {
      const owed = Math.round(R.embezzled * 1.25);
      for (const id in R.regions) { const l = regionLord(s, id); if (l && l !== 'player' && s.people[l]) s.people[l].opinion = clamp((s.people[l].opinion || 0) - 10, -100, 100); }
      R.favour = clamp(R.favour - 15, 0, 100);
      if (s.coins >= owed) { spend(s, owed); R.treasury += owed; realmLog(s, 'An inquiry finds you took ' + R.embezzled + 'c from the treasury. You must repay ' + owed + 'c, and the lords think less of you.', 'bad'); R.embezzled = 0; }
      else if (isRuler(s) && R.embezzled >= 600) { R.embezzled = 0; fallFromThrone(s, 'an inquiry proves you robbed the treasury, and the council removes you'); }
      else { realmLog(s, 'An inquiry finds you took ' + R.embezzled + 'c from the treasury and cannot repay it. The lords and the court turn against you.', 'bad'); R.favour = 0; R.embezzled = Math.round(R.embezzled * 0.5); }
    }
  }
  // three people of influence, each with an aim
  function setupFigures(s) {
    const R = s.realm; if (R.figures) return;
    const merchant = Object.values(s.people).find(p => p.name === 'Julian Marchant') || noble(s, { name: 'Julian Marchant', age: 46, town: 'eastwatch', why: 'Merchant of Eastwatch.' });
    const lord = s.people[R.regions.ironcrest.lord] || noble(s, { name: 'Gareth Stane', age: 58, town: 'ironcrest', home: 'seat:ironcrest' });
    let heir = Object.values(s.people).find(p => (p.parents || []).includes(lord.id) && p.status === 'here');
    if (!heir) { heir = newPerson(s, { name: 'Aldo Stane', age: 22, town: 'ironcrest', home: 'seat:ironcrest', purse: 80, retired: true }); heir.parents = [lord.id]; heir.log = [{ day: s.day, text: 'Heir to Ironcrest.' }]; }
    const reformer = s.people[R.council.law] || noble(s, { name: 'Ambrose Fell', age: 63, town: 'crownmere', home: 'seat:crownmere' });
    R.figures = [
      { kind: 'merchant', pid: merchant.id, aim: 'a monopoly on bread: five bakeries under his name', trade: 'bakery', progress: 0, ally: false, foe: false },
      { kind: 'lord', pid: lord.id, heirPid: heir.id, aim: 'the crown’s promise that ' + heir.name + ' will hold Ironcrest after him', progress: 0, ally: false, foe: false },
      { kind: 'reformer', pid: reformer.id, aim: 'the Fair Courts: an end to bought favour and theft from the treasury', progress: 0, ally: false, foe: false }
    ];
    R.figures.forEach(f => { s.people[f.pid].figure = f.kind; });
  }
  function figuresWeek(s) {
    const R = s.realm; setupFigures(s);
    for (const f of R.figures) {
      const q = s.people[f.pid]; if (!q || q.status === 'dead') continue;
      if (f.kind === 'merchant') {
        const mine = Object.values(s.biz).filter(b => b.owner === q.id && b.trade === f.trade).length; f.progress = mine;
        if (mine < 5) {
          const target = Object.values(s.biz).filter(b => b.trade === f.trade && !b.closed && b.owner !== 'player' && b.owner !== q.id && !b.lease).sort((a, b) => bizPrice(s, a.id) - bizPrice(s, b.id))[0];
          if (target) { const price = bizPrice(s, target.id); q.purse = Math.max(q.purse, price + 50); const old = s.people[target.owner]; q.purse -= price; if (old) { old.purse += price; if (old.job && old.job.biz === target.id) { old.job = null; plog(old ? s : s, old, 'Sold ' + empById(target.id).name + ' to ' + q.name + '.'); } } target.owner = q.id; f.progress = mine + 1; realmLog(s, q.name + ' buys ' + empById(target.id).name + ' (' + TOWNS[target.town || 'hearthmoor'].name + '). He now owns ' + f.progress + ' of the five bakeries he wants.', 'info'); }
        }
        if (f.progress >= 5 && !R.monopoly) { R.monopoly = { trade: f.trade, pid: q.id }; realmLog(s, q.name + ' controls enough bakeries to set the price of bread across Alderwyn. Bread costs more everywhere, and the guilds are uneasy.' + (f.ally ? ' As his partner, you share in it.' : ''), f.ally ? 'info' : 'bad'); }
      } else if (f.kind === 'lord') {
        if (!f.done) f.progress = Math.min(5, f.progress + 1);
        if (yourLordships(s).includes('ironcrest') || (R.lastSought === 'ironcrest' && s.day - (R.lastSoughtDay || 0) < 14)) f.foe = true;
        if (f.foe && !f.ally) { R.favour = clamp(R.favour - 3, 0, 100); if (yourLordships(s).includes('ironcrest') && s.bandits) s.bandits.ironcrest = Math.min(100, (s.bandits.ironcrest || 0) + 8); realmLog(s, q.name + ' speaks against you at court' + (yourLordships(s).includes('ironcrest') ? ', and his old men-at-arms look the other way while bandits work the Ironcrest road' : '') + '.', 'bad'); }
      } else if (f.kind === 'reformer') {
        if (!f.done) f.progress = Math.min(5, f.progress + (R.laws.fairCourts ? 0 : 1));
        if (f.foe && R.embezzled > 0) R.embezzled = Math.round(R.embezzled * 1.2);
      }
    }
  }
  // exile: the way back is won by deeds, not by waiting
  function exileReady(s) {
    const R = s.realm, E = R.exile; if (!E) return null;
    const need = { allies: (E.allies || []).length >= 3, fund: (E.fund || 0) >= 600, towns: R.support.towns >= 55, exposed: R.kingSupport < 50 };
    return need;
  }
  /* ----- how you begin: from nothing, or further up the ladder ----- */
  const STARTS = {
    normal: { name: 'From nothing', say: 'Arrive in Hearthmoor with 5 coins and work your way up.' },
    merchant: { name: 'A merchant', say: 'You know the baker\u2019s trade and own a Bread Stand in Hearthmoor, with 150 coins put by.' },
    elder: { name: 'The Elder', say: 'You are Elder of Hearthmoor, with a bakery, the council behind you and 400 coins.' },
    lord: { name: 'A lord', say: 'You are lord of Greenhaven, living at its hall, with a bakery in Hearthmoor and 1,200 coins.' },
    ruler: { name: 'The ruler', say: 'Old King Aldwin has given you the crown. You rule Alderwyn from Crownmere castle, with 2,000 coins of your own.' }
  };
  function applyStart(s, mode) {
    if (!STARTS[mode] || mode === 'normal') return;
    const v = s.village, Y = you(s), R = s.realm;
    s.trades.bakery = Math.max(s.trades.bakery || 0, LEARN_SHIFTS);
    s.coins = 60; cmd(s, 'open', 1, 'bakery');
    s.coins = { merchant: 150, elder: 400, lord: 1200, ruler: 2000 }[mode];
    s.start = mode;
    if (mode === 'elder' || mode === 'lord' || mode === 'ruler') {
      v.step = 9; v.council = true; v.landGranted = true; v.standing = 80; v.chest = Math.max(v.chest, 150);
      if (mode === 'elder') { const old = s.offices.elder && s.people[s.offices.elder]; appoint(s, 'elder', 'player'); s.rec.everElder = true; if (old) old.retired = true; if (s.gov) s.gov.approval.elder = 65; }
    }
    if (mode === 'lord' || mode === 'ruler') { Y.age = Math.max(Y.age, mode === 'ruler' ? 32 : 28); s.people[Y.pid].age = Y.age; R.favour = 55; R.deeds = { greenhaven: 1 }; }
    if (mode === 'lord') { const old = s.people[R.regions.greenhaven.lord]; if (old) { old.retired = true; old.noble = null; } R.regions.greenhaven.lord = 'player'; cmd(s, 'moveToSeat', 'greenhaven'); const st = STAGE.greenhaven; s.player.x = st.x; s.player.z = st.z; }
    if (mode === 'ruler') { R.kept = 1; crownYou(s, 'King Aldwin, old and tired, names you his successor'); s.player.seat = 'crownmere'; bringFamily(s, 'Moved into Crownmere castle.'); const st = STAGE.crownmere; s.player.x = st.x; s.player.z = st.z; }
    event(s, STARTS[mode].say, 'story');
    if (s.stats) s.stats.coinsStart = s.coins;
  }
  /* buying, renting and firing */
  /* ----- property: what it is worth, keeping it up, letting it, and selling it ----- */
  const COMFORT = [{ name: 'Bare', cost: 0 }, { name: 'Homely', cost: 80 }, { name: 'Comfortable', cost: 180 }, { name: 'Fine', cost: 360 }];
  // each town's property market drifts with its fortunes
  function marketOf(s, town) { s.market = s.market || {}; return s.market[town || 'hearthmoor'] || 1; }
  function propertyMarket(s) {
    s.market = s.market || {};
    for (const t of ['hearthmoor', 'oakbridge', 'greenhaven', 'crownmere', 'ironcrest', 'eastwatch']) {
      const T = t === 'hearthmoor' ? null : s.towns && s.towns[t], pull = T ? (T.approval - 55) / 600 + (T.chest > 300 ? 0.004 : T.chest < 0 ? -0.006 : 0) : s.gov ? (s.gov.approval.elder - 55) / 700 : 0;
      const raid = s.bandits && s.bandits.lastRaid && s.bandits.lastRaid.town === t && s.day - s.bandits.lastRaid.day < 3 ? -0.02 : 0;
      const m = s.market[t] || 1; s.market[t] = Math.round(clamp(m + pull + raid + (rand(s) - 0.5) * 0.02 + (1 - m) * 0.03, 0.7, 1.45) * 1000) / 1000;
    }
  }
  /* where a building stands sets its price: a richer town costs more, and so does the heart of town by the market */
  const LAND = { hearthmoor: 1, greenhaven: 1.1, ironcrest: 1.2, eastwatch: 1.4, oakbridge: 1.45, crownmere: 2 };
  const TOWN_R = { hearthmoor: 60, greenhaven: 60, oakbridge: 110, ironcrest: 80, eastwatch: 110, crownmere: 180 };
  function areaOf(town, x, z) {
    town = town || 'hearthmoor'; const L = LOCS[MARKET_AT[town]]; if (!L) return { k: 1, name: '' };
    const d = Math.hypot(x - L.x, z - L.z), f = Math.max(0, 1 - d / (TOWN_R[town] || 80)), k = Math.round((0.85 + 0.5 * f) * 100) / 100;
    return { k, name: f > 0.7 ? 'in the heart of town' : f > 0.4 ? 'near the market' : f > 0.15 ? 'a quiet street' : 'on the edge of town' };
  }
  const placeFactor = (town, x, z) => (LAND[town || 'hearthmoor'] || 1) * areaOf(town, x, z).k;
  function houseValue(s, h) { if (h.rent0 == null) h.rent0 = h.rent; /* a buyer pays for the rent the house has really been bringing in, over about two weeks, not the rent asked */ const earned = h.tenants.length ? Math.min(h.rent, h.rentAvg == null ? h.rent0 : h.rentAvg) : h.rent0, fair = Math.min(earned, Math.max(1, h.rent0) * 1.25), lived = h.tenants.length || (s.player && s.player.house === h.id) ? 1 : 0.9; return Math.round((40 + fair * 45) * lived * placeFactor(h.town, h.x, h.z) * marketOf(s, h.town) * (1 + 0.22 * (h.comfort || 0)) * (1 - Math.min(0.4, (h.wear || 0) / 160))); }
  function propertyDay(s) {
    for (const h of s.houses) { if (h.rent0 == null) h.rent0 = h.rent; if (h.tenants.length) h.rentAvg = Math.round(((h.rentAvg == null ? h.rent0 : h.rentAvg) * 13 + (h.taken || 0)) / 14 * 100) / 100; h.taken = 0; }
    propertyMarket(s);
    for (const h of s.houses) if (h.owner === 'player') h.wear = Math.min(100, (h.wear || 0) + 0.4);
    // let businesses: the tenant pays you each day, or falls behind
    for (const id in s.biz) {
      const b = s.biz[id]; if (!b.lease) continue;
      const q = s.people[b.lease.pid];
      if (!q || q.status !== 'here' || b.owner !== 'player') { endLease(s, b, 'The lease on ' + empById(id).name + ' has ended.'); continue; }
      if (b.lease.until && s.day >= b.lease.until) {
        if (b.lease.renew && (b.lease.behind || 0) < 2) { b.lease.until = s.day + (b.lease.term || 30); event(s, 'The lease on ' + empById(id).name + ' runs on for another ' + (b.lease.term || 30) + ' days, until day ' + b.lease.until + '.', 'info'); }
        else { endLease(s, b, 'The lease on ' + empById(id).name + ' is up. ' + q.name + ' hands back the keys.'); continue; }
      }
      const pay = Math.max(0, Math.min(b.lease.rent, q.purse));
      q.purse -= pay; earn(s, pay); s.stats.rent += pay; s.rec.rentCollected += pay;
      if (pay < b.lease.rent) { b.lease.behind = (b.lease.behind || 0) + 1; if (b.lease.behind >= 4) endLease(s, b, q.name + ' could not keep up the rent on ' + empById(id).name + ' and has handed back the keys.'); } else b.lease.behind = 0;
    }
    // buyers come looking at what you have put up for sale
    s.offers = (s.offers || []).filter(o => s.day - o.day < 4);
    const listed = s.houses.filter(h => h.owner === 'player' && h.forSale).map(h => ({ kind: 'house', id: h.id, ask: h.forSale, town: h.town || 'hearthmoor', name: h.name }))
      .concat(Object.values(s.biz).filter(b => b.owner === 'player' && b.forSale).map(b => ({ kind: 'biz', id: b.id, ask: b.forSale, town: b.town || 'hearthmoor', name: empById(b.id).name })));
    for (const L of listed) {
      if (s.offers.some(o => o.kind === L.kind && o.id === L.id && s.day - o.day < 2)) continue;
      const fair = L.kind === 'house' ? houseValue(s, houseById(s, L.id)) : bizPrice(s, L.id), greed = L.ask / Math.max(1, fair);
      if (rand(s) > clamp(1.25 - greed * 0.75, 0.05, 0.8)) continue;
      const buyers = living(s).filter(p => !p.kid && p.age >= 20 && townOf(p) === L.town && p.purse >= fair * 0.7 + 30 && (p.opinion || 0) > -40 && !(p.job && p.job.type === 'office'));
      const any = buyers.length ? buyers : living(s).filter(p => !p.kid && p.purse >= fair * 0.7 + 30 && (p.opinion || 0) > -40 && !(p.job && p.job.type === 'office'));
      if (!any.length) continue;
      const q = any[Math.floor(rand(s) * any.length)], amount = Math.round(Math.min(q.purse - 30, L.ask, fair * (0.82 + rand(s) * 0.26))); if (amount < fair * 0.6) continue;
      s.offers.push({ n: (s.offerN = (s.offerN || 0) + 1), kind: L.kind, id: L.id, pid: q.id, amount, day: s.day });
      event(s, q.name + ' offers ' + amount + 'c for ' + L.name + ' (you asked ' + L.ask + 'c). See the Property page.', 'coin');
    }
  }
  const leaseRent = (offer, term) => Math.max(4, offer + (term === 14 ? 1 : term === 60 ? -1 : 0));
  const leaseBreakable = (s, b) => !b.lease || !b.lease.until || s.day >= b.lease.until || (b.lease.behind || 0) >= 2;
  function endLease(s, b, why) { const q = b.lease && s.people[b.lease.pid]; if (q && q.job && q.job.type === 'biz' && q.job.biz === b.id) { q.job = null; plog(s, q, why); } b.lease = null; event(s, why, 'info'); }
  function leaseCandidates(s, id) {
    const b = s.biz[id], town = b.town || 'hearthmoor';
    return living(s).filter(p => !p.kid && p.age >= 20 && townOf(p) === town && p.purse >= 20 && !(p.job && (p.job.type === 'office' || p.job.type === 'manage' || (p.job.type === 'biz' && p.job.role === 'owner'))) && p.home !== 'you')
      .map(p => ({ pid: p.id, name: p.name, offer: Math.max(4, Math.round(BIZ_BASE[b.trade] * 0.3 * (0.8 + (p.skill || 1) * 0.3))), skill: p.skill || 1 })).sort((a, c) => c.offer - a.offer).slice(0, 4);
  }
  function bizPrice(s, id) { const b = s.biz[id]; return Math.round((b.closed ? 100 : 150 + 25 * Math.max(0, avg(b.profits))) * (b.trade === 'estate' ? 3 : b.trade === 'mill' && b.town === 'greenhaven' ? 1.5 : 1) * marketOf(s, b.town) * (b.disrepair ? 0.85 : 1) * (() => { const e = empById(id); return e && e.x != null ? (1 + ((LAND[b.town || 'hearthmoor'] || 1) - 1) * 0.9) * areaOf(b.town, e.x, e.z).k : 1; })()); }
  function housePrice(s, h) { return houseValue(s, h); }
  function sellerWilling(s, ownerPid) { const o = s.people[ownerPid]; return !o || o.opinion > -40; }

  /* offices change hands */
  function appoint(s, office, holder) {
    if (holder && holder !== 'player' && s.people[holder] && s.people[holder].held && s.justice) release(s, holder, 'Released to take up the office of ' + OFFICES[office].title + '.');
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
  const REGENCY_BLOCK = new Set(['court', 'propose', 'apply', 'seekLordship', 'seekSeat', 'claimCrown', 'undermineKing', 'acceptLordship', 'buyBiz', 'buyHouse', 'listForSale', 'acceptOffer', 'leaseBiz', 'moveIn', 'hireManager', 'nameHeir', 'handOver']);
  /* ======================= LAW AND ORDER (Hearthmoor first) =======================
     A small named watch who live in the village and draw a wage from the village chest; a watch house behind
     the Village Hall with a few cells; cases that come from real circumstances (hunger, grudges, a hand in the
     chest) with a hidden truth that accusations, witnesses and investigation only partly reveal; hearings with
     honest and dishonest choices; and the people who know what you did. The Elder of Hearthmoor holds the
     village's justice; the council can be left to hear routine cases; the Lord Justice and the crown hear appeals. */
  const DUTIES = { market: 'Market patrol', homes: 'Round the houses', hall: 'Watch house and hall', road: 'The east road', cells: 'Guarding the cells', yours: 'Guarding your property' };
  const J_WAGE = 5, J_KIT = 10, J_DETAIN_MAX = 3, J_HEAR_BY = 1;
  const CRIME = { theft: 'Theft', assault: 'Assault', corruption: 'Corruption', order: 'Held on order', smuggling: 'Smuggling', poaching: 'Poaching', fraud: 'Fraud', hoarding: 'Hoarding' };
  function setupJustice(s) {
    if (s.justice || !s.people || !s.gov) return s.justice;
    const J = s.justice = { id: 'hearthmoor', name: 'Hearthmoor', place: 'the watch house cells', authority: 'Elder of Hearthmoor', watch: [], cells: 2, bunks: 3, condition: 90, cases: [], prisoners: [], closed: [], secrets: [], nextCase: 1, nextSecret: 1, delegate: 'none', fear: 0, deterUntil: 0, log: [], unpaid: 0, wrongful: 0 };
    // the Village Watchman leads; one more villager stands the watch with them
    const cap = s.offices.watch && s.people[s.offices.watch];
    const cands = guardCandidates(s).filter(p => !cap || p.id !== cap.id), n = watchTarget(s, 'hearthmoor');
    cands.slice(0, n).forEach((p, i) => enlist(s, p, ['market', 'homes', 'road'][i % 3], true));
    return J;
  }
  const isHeld = p => !!(p && p.held);
  function guardCandidates(s) {
    return villagers(s).filter(p => !p.kid && !p.retired && p.age >= 18 && p.age <= 55 && p.status === 'here' && !isHeld(p) && !isHousehold(p) && !(p.job && (p.job.type === 'office' || p.job.type === 'watch' || p.job.role === 'owner' || p.job.type === 'manage')) && !(s.you && s.you.pid === p.id) && p.home !== 'you')
      .sort((a, b) => (b.skill || 1) - (a.skill || 1) + ((b.opinion || 0) - (a.opinion || 0)) / 200).slice(0, 5);
  }
  function enlist(s, p, duty, free) {
    const J = s.justice;
    if (p.job) loseJob(s, p, 'Left their work to join the village watch.');
    p.job = { type: 'watch', role: 'guard' };
    J.watch.push({ pid: p.id, duty: duty || 'market', wage: J_WAGE, morale: 65, unpaid: 0, honest: Math.round((0.3 + rand(s) * 0.7) * 100) / 100, since: s.day });
    plog(s, p, 'Joined the village watch at ' + J_WAGE + 'c a day.');
    if (!free) payKit(s);
  }
  // a guard's kit (a jerkin, a cudgel, a lantern) is bought from the village smith
  function payKit(s) {
    const v = s.village; v.chest -= J_KIT;
    const sm = s.shops.find(x => x.trade === 'smithy');
    if (sm) { earn(s, J_KIT); s.stats.shops[sm.id] && (s.stats.shops[sm.id].revenue += J_KIT); return 'your smithy'; }
    const b = Object.values(s.biz).find(x => !x.town && x.trade === 'smithy' && !x.closed), o = b && s.people[b.owner];
    if (o) o.purse += J_KIT;
    return b ? empById(b.id).name : 'Ashford';
  }
  const guardOf = (s, pid) => s.justice && s.justice.watch.find(g => g.pid === pid);
  function watchPeople(s) { const J = s.justice; const out = J.watch.map(g => ({ g, p: s.people[g.pid] })).filter(x => x.p && x.p.status === 'here'); const cap = s.offices.watch && s.people[s.offices.watch]; return { guards: out, captain: cap && cap.status === 'here' ? cap : null }; }
  // how well each part of the village is watched, 0..1
  function coverage(s) {
    const J = s.justice, c = { market: 0, homes: 0, hall: 0, road: 0, cells: 0, yours: 0 };
    if (!J) return c;
    for (const { g, p } of watchPeople(s).guards) { if (isHeld(p)) continue; const k = Math.min(1.3, p.skill || 1) * (g.morale < 30 ? 0.6 : 1); c[g.duty] = (c[g.duty] || 0) + k; }
    const cap = watchPeople(s).captain; if (cap) c.hall += 0.6;
    const need = { market: 1, homes: 1, hall: 0.5, road: 1, cells: Math.max(0.5, J.prisoners.length * 0.5), yours: 1 };
    for (const k in c) c[k] = Math.min(1, c[k] / need[k]);
    return c;
  }
  function jlog(s, text, kind, C) { const J = C || s.justice; J.log.unshift({ day: s.day, text }); if (J.log.length > 30) J.log.length = 30; event(s, text, kind || 'info'); }
  const youJudge = s => s.offices.elder === 'player' && !(s.you && s.you.regent);
  const youHearAppeals = s => !!(s.realm && (s.realm.council.law === 'player' || s.realm.crown === 'player'));

  /* ---------- cases from real circumstances ---------- */
  function pickBy(s, arr, w) { const t = arr.reduce((a, x) => a + w(x), 0); if (t <= 0) return null; let r = rand(s) * t; for (const x of arr) { r -= w(x); if (r <= 0) return x; } return arr[arr.length - 1]; }
  function newCase(s, kind, o, C) {
    const J = s.justice; C = C || J;
    const c = Object.assign({ id: J.nextCase++, kind, day: s.day, status: 'open', evidence: [], hidden: [], witnesses: [], investigating: 0, held: false, deadline: null, authority: C.authority, court: C.id }, o);
    c.evidence.push({ text: o.claim, w: 1, by: o.accuser });
    C.cases.push(c);
    return c;
  }
  // a pool of evidence that an investigation can turn up, drawn from what really happened
  function evidencePool(s, c) {
    const A = s.people[c.accused], acc = c.accuser && s.people[c.accuser], an = A ? A.name.split(' ')[0] : 'the accused', xn = acc ? acc.name.split(' ')[0] : 'the accuser';
    const pool = [];
    if (c.truth === 'guilty') {
      if (c.kind === 'theft') pool.push({ text: an + ' was seen near ' + c.where + ' that evening.', w: 2 }, { text: an + ' paid off ' + Math.max(2, Math.round(c.value / 2)) + 'c of debts the next morning, coin no one knew they had.', w: 2 }, { text: 'A neighbour heard ' + an + ' boasting at the well.', w: 1 });
      if (c.kind === 'assault') pool.push({ text: an + '’s knuckles were cut and bruised the next day.', w: 2 }, { text: 'Two drinkers saw ' + an + ' and the victim quarrelling before it happened.', w: 2 });
      if (c.kind === 'corruption') pool.push({ text: 'The chest book is ' + c.value + 'c short in the weeks ' + an + ' kept it.', w: 3 }, { text: an + ' bought a new cloak and a pig this month on an officer’s pay.', w: 1 });
      if (c.kind === 'smuggling') { pool.push({ text: 'Bales of ' + (c.good || 'cloth') + ' in ' + an + '\u2019s store carry no customs seal.', w: 3 }, { text: 'A boatman says ' + an + ' landed cargo at night below the harbour wall.', w: 2 }); if (c.guard && s.people[c.guard]) pool.push({ text: 'The watchman ' + s.people[c.guard].name + ' was paid to look the other way.', w: 1 }); }
      if (c.kind === 'poaching') { pool.push({ text: 'Snares and a deer hide were found behind ' + an + '\u2019s house.', w: 3 }); pool.push(c.organiser && s.people[c.organiser] ? { text: s.people[c.organiser].name + ' buys the venison and pays the hunters.', w: 1 } : { text: an + '\u2019s family has been short of food all winter.', w: 0 }); }
      if (c.kind === 'fraud') pool.push({ text: 'The tallies and the ledger do not agree: ' + c.value + 'c is unaccounted for.', w: 3 }, { text: an + ' has been spending freely this month.', w: 1 });
      if (c.kind === 'hoarding') pool.push({ text: an + ' bought far more ' + (c.good || 'grain') + ' than any business needs, just as the price rose.', w: 3 }, { text: 'A clerk heard ' + an + ' say they would sell when the town was desperate.', w: 2 });
    } else {
      if (c.kind === 'theft') pool.push({ text: an + ' was at work all that evening; three people say so.', w: -3 }, { text: 'The latch on ' + c.where + ' was forced from inside, not from the street.', w: -1 });
      if (c.kind === 'assault') pool.push({ text: an + ' was at home with family; the neighbours heard them all evening.', w: -3 });
      if (c.kind === 'corruption') pool.push({ text: 'The chest book balances to the coin.', w: -3 });
      if (c.kind === 'smuggling') pool.push({ text: 'The bales carry the customs seal after all; the clerk had misfiled them.', w: -3 });
      if (c.kind === 'poaching') pool.push({ text: an + ' was snaring rabbits on common land, not in the King\u2019s forest.', w: -3 });
      if (c.kind === 'fraud') pool.push({ text: c.excuse || 'Floods held up the goods on the road; they came the following week.', w: -3 });
      if (c.kind === 'hoarding') pool.push({ text: an + ' lays in stock every autumn for the winter; the cellar books for years past show the same.', w: -3 });
      if (c.truth === 'lie') pool.push({ text: xn + ' owes ' + an + ' money and has been heard cursing them.', w: -2 });
      else pool.push({ text: 'The description given fits half the village.', w: -1 });
    }
    return pool;
  }
  function crimeDay(s) {
    const J = s.justice, v = s.village, cov = coverage(s), vil = villagers(s).filter(p => !p.kid && p.status === 'here' && !isHeld(p));
    if (vil.length < 6) return;
    const deter = s.day < J.deterUntil ? 0.6 : 1, poor = vil.filter(p => p.hungry || p.purse < 6).length;
    // theft: hunger and empty purses drive it; patrols around the market and the houses deter it
    const pTheft = 0.16 * deter * seasonFx(s).theft * (1 + poor / 6) * (1 - 0.55 * (cov.market + cov.homes) / 2);
    if (rand(s) < pTheft) {
      const thief = pickBy(s, vil.filter(p => !isHousehold(p) && !(p.job && p.job.type === 'watch')), p => (p.hungry ? 3 : 0) + (p.purse < 6 ? 2 : 0) + (p.mood < 35 ? 1 : 0) + 0.2);
      const sy = s.shops.filter(x => x.goods >= 2), shopsYou = sy.length && rand(s) < 0.35 * (1 - cov.yours) ? sy[Math.floor(rand(s) * sy.length)] : null;
      const victim = shopsYou ? null : pickBy(s, vil.filter(p => p !== thief && p.purse > 15), p => Math.min(4, p.purse / 30));
      if (thief && (shopsYou || victim)) {
        let value, where, accuser;
        if (shopsYou) { const n = Math.min(shopsYou.goods, 2 + Math.floor(rand(s) * 3)); value = n * shopsYou.price; shopsYou.goods -= n; where = 'your ' + TRADES[shopsYou.trade].name.toLowerCase(); accuser = 'player'; thief.purse += value; }
        else { value = Math.min(victim.purse - 5, 5 + Math.floor(rand(s) * 15)); victim.purse -= value; thief.purse += value; where = (houseById(s, victim.home) || { name: victim.name.split(' ')[0] + '’s home' }).name; accuser = victim.id; }
        // who gets the blame: often the thief, sometimes the wrong person, now and then someone the victim hates
        const r = rand(s), others = vil.filter(p => p !== thief && p.id !== accuser && !isHousehold(p));
        let accused = thief, truth = 'guilty';
        if (r > 0.62 && others.length) { const vic = s.people[accuser]; const foe = vic && others.slice().sort((a, b) => (a.opinion || 0) - (b.opinion || 0))[0]; if (r > 0.85 && foe && accuser !== 'player') { accused = foe; truth = 'lie'; } else { accused = others[Math.floor(rand(s) * others.length)]; truth = 'mistaken'; } }
        const c = newCase(s, 'theft', { accused: accused.id, accuser, victim: accuser, value, where, truth, thief: thief.id, what: value + 'c' + (shopsYou ? ' of goods' : '') + ' taken from ' + where, claim: (accuser === 'player' ? 'Your worker' : s.people[accuser].name.split(' ')[0]) + ' says ' + accused.name + ' took ' + value + 'c' + (shopsYou ? ' worth of goods' : '') + ' from ' + where + '.' });
        c.hidden = evidencePool(s, c); addWitness(s, c, vil);
        jlog(s, 'Theft reported: ' + c.what + '. ' + accused.name + ' is accused.', 'bad');
      }
    }
    if (s.realm && s.realm.laws.forestLaw && rand(s) < 0.08 * (1 + poor / 4)) poaching(s, J, vil);
    // assault: bad tempers in a hungry village, a brawl after the tavern
    const pAssault = 0.06 * deter * (1 - 0.5 * cov.market);
    if (rand(s) < pAssault) {
      const hot = pickBy(s, vil.filter(p => !(p.job && p.job.type === 'watch')), p => (p.mood < 35 ? 3 : 0.3)), vic = hot && pickBy(s, vil.filter(p => p !== hot), () => 1);
      if (hot && vic) {
        const others = vil.filter(p => p !== hot && p !== vic), r = rand(s); let accused = hot, truth = 'guilty';
        if (r > 0.75 && others.length) { accused = others[Math.floor(rand(s) * others.length)]; truth = r > 0.92 ? 'lie' : 'mistaken'; }
        vic.mood = clamp(vic.mood - 15, 0, 100);
        const c = newCase(s, 'assault', { accused: accused.id, accuser: vic.id, victim: vic.id, value: 6, where: 'the square', truth, what: vic.name + ' was beaten in the square after dark', claim: vic.name.split(' ')[0] + ' says ' + accused.name + ' struck them.' });
        c.hidden = evidencePool(s, c); addWitness(s, c, vil);
        jlog(s, 'Assault reported: ' + vic.name + ' was beaten. ' + accused.name + ' is accused.', 'bad');
      }
    }
    // corruption: an officer's hand in the village chest, or a rival's smear
    const officers = ['keeper', 'watch'].map(k => s.offices[k]).filter(id => id && id !== 'player' && s.people[id] && s.people[id].status === 'here').map(id => s.people[id]);
    if (officers.length && rand(s) < 0.03) {
      const o = officers[Math.floor(rand(s) * officers.length)], guilty = rand(s) < 0.6, value = 6 + Math.floor(rand(s) * 14);
      if (guilty) { v.chest -= value; o.purse += value; }
      const acc = s.gov.council.map(id => s.people[id]).filter(q => q && q.status === 'here' && q !== o)[0];
      const c = newCase(s, 'corruption', { accused: o.id, accuser: acc ? acc.id : null, victim: 'chest', value, where: 'the village chest', truth: guilty ? 'guilty' : 'lie', what: value + 'c missing from the village chest', claim: (acc ? acc.name : 'A councillor') + ' says ' + o.name + ' has been taking from the chest.' });
      c.hidden = evidencePool(s, c);
      jlog(s, 'Corruption alleged: ' + o.name + ' is accused of taking ' + value + 'c from the village chest.', 'bad');
    }
  }
  function addWitness(s, c, vil) {
    const w = vil.filter(p => p.id !== c.accused && p.id !== c.accuser && p.id !== c.thief)[Math.floor(rand(s) * vil.length)];
    if (!w || rand(s) < 0.4) return;
    const honest = rand(s) < 0.75, A = s.people[c.accused], an = A.name.split(' ')[0];
    const sawIt = c.truth === 'guilty' ? honest : !honest;
    c.witnesses.push({ pid: w.id, says: sawIt ? w.name.split(' ')[0] + ' saw ' + an + ' there.' : w.name.split(' ')[0] + ' saw someone else, not ' + an + '.', w: sawIt ? 2 : -2, honest });
  }
  // the weight of what is known: positive points to guilt
  const caseWeight = c => c.evidence.reduce((a, e) => a + e.w, 0) + c.witnesses.filter(w => !w.leaned).reduce((a, w) => a + (w.shown ? w.w : 0), 0) + c.witnesses.filter(w => w.leaned).reduce((a, w) => a + w.leaned, 0);

  /* ---------- daily: wages, investigations, deadlines, prisoners, rumours ---------- */
  function justiceDay(s) {
    const J = setupJustice(s); if (!J) return;
    const v = s.village;
    // wages from the village chest, not your purse
    let wages = 0;
    // an Elder who is not you will not run up wages the chest cannot meet: one man stands down until it can
    if (!youJudge(s) && J.watch.length > 1 && v.chest < J.watch.reduce((x, g) => x + g.wage, 0) * 2) { const g = J.watch[J.watch.length - 1], p = s.people[g.pid]; J.watch.pop(); if (p) { p.job = null; plog(s, p, 'Stood down from the watch until the village chest can pay.'); jlog(s, 'The village chest is low, so the Elder stands ' + p.name + ' down from the watch for now.', 'info'); } }
    for (const g of J.watch.slice()) {
      const p = s.people[g.pid];
      if (!p || p.status !== 'here' || !p.job || p.job.type !== 'watch') { J.watch = J.watch.filter(x => x !== g); continue; }
      if (v.chest >= g.wage) { v.chest -= g.wage; p.purse += g.wage; wages += g.wage; g.unpaid = 0; g.morale = clamp(g.morale + (g.wage >= J_WAGE ? 2 : -3), 0, 100); }
      else { g.unpaid++; g.morale = clamp(g.morale - 8, 0, 100); if (g.unpaid === 2) jlog(s, 'The village chest cannot pay the watch. ' + p.name + ' goes unpaid.', 'bad'); }
      if (g.unpaid >= 6 || g.morale <= 5) { J.watch = J.watch.filter(x => x !== g); p.job = null; plog(s, p, 'Left the watch: ' + (g.unpaid >= 6 ? 'six days without pay.' : 'sick of it.')); jlog(s, p.name + ' has left the watch' + (g.unpaid >= 6 ? ' after six days without pay.' : '.'), 'bad'); }
    }
    // the watch house: prisoners cost bread, the place wears
    const feed = J.prisoners.length; v.chest -= feed; J.condition = clamp(J.condition - 0.6 - feed * 0.4, 0, 100);
    J.today = { wages, feed };
    crimeDay(s); bribeOffers(s);
    // an Elder who is not you keeps the watch at the size the village needs
    if (!youJudge(s) && J.watch.length < Math.min(J.bunks, watchTarget(s, 'hearthmoor')) && v.chest > 60 && rand(s) < 0.3) { const c0 = guardCandidates(s)[0]; if (c0) { enlist(s, c0, ['market', 'homes', 'road'][J.watch.length % 3]); jlog(s, 'The Elder takes ' + c0.name + ' onto the watch.'); } }
    const cov = coverage(s), judge = youJudge(s);
    // investigations: a guard asks questions, and the truth comes out bit by bit
    for (const c of J.cases) {
      if (c.status !== 'open') continue;
      if (c.investigating > 0) {
        const inv = watchPeople(s), sk = Math.max(0.5, (inv.captain ? 1.1 : 0) + inv.guards.filter(x => x.g.duty === 'hall' && !isHeld(x.p)).length * 0.6 + 0.4);
        if (c.hidden.length && rand(s) < 0.45 * sk) { const e = c.hidden.splice(Math.floor(rand(s) * c.hidden.length), 1)[0]; c.evidence.push(e); }
        c.witnesses.forEach(w => { if (!w.shown && rand(s) < 0.5) w.shown = true; });
        c.investigating--;
      }
      // a held suspect must be heard in time, or let go; the council hears a held case it has been given on the day
      { const routine0 = c.kind !== 'corruption' && c.value < 15; const del0 = !judge || J.delegate === 'all' || (J.delegate === 'minor' && routine0); if (c.held && del0 && s.day >= c.deadline) { councilHears(s, c); continue; } }
      if (c.held && s.day > c.deadline) { release(s, c.accused, 'Held past the hearing day without a hearing, so the watch had to let them go.'); c.held = false; jlog(s, 'No hearing was held for ' + s.people[c.accused].name + ' in time: they walk free.', 'info'); }
      // routine cases go to the council when you have handed them over, or when you are not the judge
      const routine = c.kind !== 'corruption' && c.value < 15 && !(s.people[c.accused] && s.people[c.accused].job && s.people[c.accused].job.type === 'office');
      const delegated = !judge || J.delegate === 'all' || (J.delegate === 'minor' && routine);
      c.delegated = delegated;
      // the watch looks into routine cases on its own; the council hears them after a few days
      if ((delegated || s.day - c.day >= 2) && !c.investigating && !c.asked && (watchPeople(s).captain || watchPeople(s).guards.length)) { c.investigating = 3; c.asked = true; }
      if ((delegated && s.day - c.day >= 4) || (s.day - c.day >= 7)) { if (!delegated) jlog(s, 'You left the ' + CRIME[c.kind].toLowerCase() + ' case against ' + (s.people[c.accused] || {}).name + ' a week unheard, so the council heard it.', 'info'); councilHears(s, c); continue; }
      if (s.day - c.day > 12) { c.status = 'closed'; c.outcome = 'Left unheard and dropped.'; J.closed.unshift(c); }
    }
    J.cases = J.cases.filter(c => c.status === 'open');
    // prisoners: sentences end, poor cells let people slip out
    for (const pr of J.prisoners.slice()) {
      const p = s.people[pr.pid];
      if (!p || p.status !== 'here') { J.prisoners = J.prisoners.filter(x => x !== pr); continue; }
      if (pr.until != null && s.day >= pr.until) { release(s, pr.pid, pr.sentence ? 'Served their time in the watch house.' : 'Released.'); continue; }
      if (J.condition < 40 && rand(s) < 0.08 * (1 - cov.cells)) { release(s, pr.pid, 'Slipped out of the rotten cell.'); jlog(s, p.name + ' has escaped from the watch house. The cell needs mending.', 'bad'); }
    }
    // fines owed are paid off a little at a time, or worked off
    for (const C2 of allCourts(s)) for (const c of C2.closed.slice(0, 20)) if (c.workLeft > 0) { const p = s.people[c.accused]; if (!p || p.status !== 'here' || p.held) continue; c.workLeft--; chestOf(s, C2).chest += 3; p.mood = clamp(p.mood - 2, 0, 100); if (!c.workLeft) plog(s, p, 'Finished their days of work for the ' + (C2.id === 'hearthmoor' ? 'village' : 'town') + '.'); }
    for (const c of J.closed.slice(0, 20)) if (c.fineOwed > 0) {
      const p = s.people[c.accused]; if (!p || p.status !== 'here') { c.fineOwed = 0; continue; }
      const pay = Math.min(c.fineOwed, Math.max(0, Math.min(3, p.purse - 4)));
      if (pay > 0) { p.purse -= pay; c.fineOwed -= pay; if (c.fineTo === 'you') { earn(s, pay); s.stats.fines = (s.stats.fines || 0) + pay; } else v.chest += pay; }
      else { c.workDays = (c.workDays || 0) + 1; const w = Math.min(c.fineOwed, 3); c.fineOwed -= w; v.chest += 0; plog(s, p, 'Worked a day for the village to pay off a fine.'); }
    }
    // poor security makes people demand action
    if (s.day % 5 === 0) { const open = J.cases.length, worry = (1 - (cov.market + cov.homes) / 2) * 3 + open; if (worry > 4 && s.gov) { approve(s, 'elder', -2); jlog(s, 'Villagers grumble at the moot: ' + open + ' cases unheard and too few on the watch.', 'bad'); } }
    secretsDay(s);
    J.fear = Math.max(0, J.fear - 0.5);
  }
  const courtOf = (s, c) => (c && c.court && c.court !== 'hearthmoor' && s.courts && s.courts[c.court]) || s.justice;
  const allCourts = s => [s.justice].concat(s.courts ? Object.values(s.courts) : []).filter(Boolean);
  function hold(s, pid, c, why, until, C0) {
    const J = C0 || courtOf(s, c), p = s.people[pid];
    p.held = { caseId: c ? c.id : null, since: s.day, why };
    const ag = bodyOf(s, p); if (ag) s.agents = s.agents.filter(x => x !== ag);
    J.prisoners.push({ pid, caseId: c ? c.id : null, court: J.id, reason: why, authority: c ? c.authority : J.authority, since: s.day, until: until != null ? until : null, sentence: false, place: J.place });
    plog(s, p, 'Locked in the watch house: ' + why);
    for (const q of living(s)) if ((q.parents || []).includes(pid) || q.spouse === pid || (p.parents || []).includes(q.id)) q.mood = clamp(q.mood - 12, 0, 100);
  }
  function release(s, pid, why) {
    const p = s.people[pid]; if (!p) return;
    allCourts(s).forEach(J => { J.prisoners = J.prisoners.filter(x => x.pid !== pid); });
    if (!p.held) return; p.held = null;
    plog(s, p, why || 'Released.');
    if (p.status === 'here' && villagers(s).includes(p)) addBody(s, p, P.hall);
  }
  function cellsFree(s, C) { const J = C || s.justice; return J.cells - J.prisoners.length; }

  /* ---------- hearings: the council's way, and yours ---------- */
  // the council hears by the weight of evidence, leaning a little towards the well-off
  function councilHears(s, c) {
    const A = s.people[c.accused], w = caseWeight(c) + (A && A.purse > 80 ? -1 : 0);
    const K = c.kind;
    if (w >= 3) decide(s, c, 'guilty', K === 'poaching' ? (c.organiser ? { fine: 8, organiser: true } : { work: 2 }) : K === 'fraud' ? { restitution: true, fine: 6 } : K === 'hoarding' ? { fine: 20 } : { restitution: true, fine: K === 'corruption' ? 10 : 4, days: K === 'assault' ? 1 : 0, work: K === 'theft' ? 2 : 0 }, 'the council');
    else decide(s, c, 'dismiss', {}, 'the council');
  }
  // the decision itself, and what it does to people
  function decide(s, c, verdict, pen, by) {
    const J = courtOf(s, c), A = s.people[c.accused], vic = c.victim && c.victim !== 'chest' && c.victim !== 'player' ? s.people[c.victim] : null;
    const w = caseWeight(c), fam = living(s).filter(q => q.spouse === c.accused || (q.parents || []).includes(c.accused) || (A && (A.parents || []).includes(q.id)));
    c.status = 'closed'; c.decidedBy = by; c.weight = w; c.verdict = verdict; J.cases = J.cases.filter(x => x !== c);
    if (c.held && verdict === 'dismiss') release(s, c.accused, 'Released: the case was dismissed.');
    c.held = false;
    if (c.kind === 'hoarding' && verdict !== 'dismiss') { const T = s.towns && s.towns[J.id]; if (T && T.hoard && T.hoard.pid === c.accused) { s.goods[J.id][T.hoard.good] += T.hoard.qty; T.hoard = null; } }
    if (verdict === 'negotiate') {
      c.outcome = (A ? A.name : 'They') + ' agree to put the stock back on sale, and no charge is brought.'; if (A) A.opinion = clamp((A.opinion || 0) + 5, -100, 100);
      J.closed.unshift(c); jlog(s, 'Hoarding: ' + c.outcome, 'info', J); return;
    }
    if (verdict === 'mercy') {
      // found guilty, and pardoned openly for a stated reason: lawful mercy, judged by the town on the reason and the record
      const why = MERCY[pen.why] ? pen.why : 'favour', ok = mercyFits(s, c, why), rec = A ? (A.record || 0) : 0;
      if (why === 'repaid' && ok && A) { const pay = Math.min(c.value, Math.max(0, A.purse)); A.purse -= pay; if (vic) vic.purse += pay; else if (c.victim === 'chest') chestOf(s, J).chest += pay; else if (c.victim === 'crown' && s.realm) s.realm.treasury += pay; else if (c.victim === 'player') { earn(s, pay); s.stats.restitution = (s.stats.restitution || 0) + pay; } }
      c.outcome = 'Found guilty by ' + by + ', and pardoned: ' + MERCY[why].said + '.'; c.mercy = why;
      if (A) A.record = rec + 1;
      if (c.held) release(s, c.accused, 'Pardoned at the hearing.'); c.held = false;
      if (A) A.opinion = clamp((A.opinion || 0) + (why === 'favour' ? 25 : 15), -100, 100);
      if (vic) vic.opinion = clamp((vic.opinion || 0) - (why === 'reconciled' && ok ? 0 : why === 'favour' ? 12 : 6), -100, 100);
      // how the town takes it: a true reason for a small wrong is respected; a reason that does not fit, a repeat offender or
      // open favour for a friend costs you
      const harm = c.kind === 'assault' || c.value > 40, fair = ok && !(harm && rec >= 1) && why !== 'favour';
      const d = why === 'favour' ? -4 : !ok ? -5 : fair ? 2 : -2;
      if (by === 'you') { if (J.id === 'hearthmoor') approve(s, 'elder', d); else { const T = s.towns && s.towns[J.id]; if (T) T.approval = clamp((T.approval || 50) + d, 0, 100); } }
      J.closed.unshift(c); if (J.closed.length > 30) J.closed.length = 30;
      jlog(s, CRIME[c.kind] + ' case against ' + (A ? A.name : 'someone') + ': ' + c.outcome + (why === 'favour' ? ' Everyone knows it was a favour.' : !ok ? ' People know the reason is not true.' : fair ? ' People think it fair.' : ' It is ' + (rec >= 1 ? 'not their first time' : 'a serious wrong') + ', and some think mercy too soft.'), 'info', J); return;
    }
    if (verdict === 'dismiss') {
      c.outcome = 'Dismissed by ' + by + '.';
      if (A) { A.opinion = clamp((A.opinion || 0) + (by === 'you' ? 6 : 2), -100, 100); }
      if (vic && c.truth === 'guilty') vic.opinion = clamp((vic.opinion || 0) - (by === 'you' ? 8 : 3), -100, 100);
    } else {
      const parts = [];
      if (pen.restitution && A && c.value) { const pay = Math.min(c.value, Math.max(0, A.purse)); A.purse -= pay; if (vic) vic.purse += pay; else if (c.victim === 'chest') chestOf(s, J).chest += pay; else if (c.victim === 'crown' && s.realm) s.realm.treasury += pay; else if (c.victim === 'player') { earn(s, pay); s.stats.restitution = (s.stats.restitution || 0) + pay; } parts.push('repay ' + pay + 'c' + (pay < c.value ? ' (all they had)' : '')); }
      if (pen.fine && A) { const f = Math.round(pen.fine), now = Math.min(f, Math.max(0, A.purse - 2)); A.purse -= now; c.fineTo = pen.fineTo === 'you' ? 'you' : 'chest'; if (c.fineTo === 'you') { earn(s, now); s.stats.fines = (s.stats.fines || 0) + now; } else s.village.chest += now; c.fineOwed = f - now; parts.push('a fine of ' + f + 'c' + (c.fineOwed ? ' (' + c.fineOwed + 'c to be paid off or worked off)' : '')); }
      if (pen.work && A) { const wd = clamp(Math.round(pen.work), 1, 10); c.workLeft = wd; parts.push(wd + (wd === 1 ? ' day' : ' days') + ' of work for the ' + (J.id === 'hearthmoor' ? 'village' : 'town')); }
      if (pen.days && A) { const d = clamp(Math.round(pen.days), 1, maxDays(J)); if (!isHeld(A) && cellsFree(s, J) <= 0) parts.push('no cell free, so no time inside'); else { if (!isHeld(A)) hold(s, A.id, c, 'serving ' + d + (d === 1 ? ' day' : ' days') + ' for ' + CRIME[c.kind].toLowerCase(), s.day + d, J); const pr = J.prisoners.find(x => x.pid === A.id); if (pr) { pr.until = s.day + d; pr.sentence = true; pr.reason = 'serving ' + d + (d === 1 ? ' day' : ' days') + ' for ' + CRIME[c.kind].toLowerCase(); } parts.push(d + (d === 1 ? ' day' : ' days') + ' in the cells'); } }
      else if (c.held) release(s, c.accused, 'Released after the hearing.');
      c.outcome = 'Found guilty by ' + by + (parts.length ? ': ' + parts.join(', ') : ': a warning') + '.';
      if (A) { A.opinion = clamp((A.opinion || 0) - (by === 'you' ? 15 : 5), -100, 100); A.mood = clamp(A.mood - 10, 0, 100); A.rep = Math.max(0, (A.rep || 0) - 10); A.record = (A.record || 0) + 1; }
      fam.forEach(q => q.opinion = clamp((q.opinion || 0) - (by === 'you' ? 6 : 2), -100, 100));
      if (vic) vic.opinion = clamp((vic.opinion || 0) + (by === 'you' ? 6 : 2), -100, 100);
      if (c.truth !== 'guilty' && c.witnesses.some(x => x.leaned > 0)) s.justice.secrets.filter(x => x.kind === 'threat' && x.caseId === c.id).forEach(x => { x.weight += 2; x.text += ', and an innocent person was convicted on it'; });
      if (c.truth === 'guilty') J.deterUntil = Math.max(J.deterUntil || 0, s.day + 8);
      else { J.wrongful++; c.wrongful = true; if (A) { A.grudge = (A.grudge || 0) + 1; } }
    }
    J.closed.unshift(c); if (J.closed.length > 30) J.closed.length = 30;
    if (pen.confiscate && A && verdict === 'guilty') confiscate(s, c, A, pen.confiscate);
    if (verdict === 'guilty') guiltyExtras(s, c, A, pen, by, J);
    if (by === 'you' && ((verdict === 'guilty' && w >= 3) || (verdict === 'dismiss' && w < 3))) s.rec.fairVerdicts = (s.rec.fairVerdicts || 0) + 1;
    if (by === 'you' && s.gov && J.id === 'hearthmoor') approve(s, 'elder', verdict === 'guilty' ? (w >= 3 ? 2 : w <= 0 ? -3 : 0) : (w >= 4 ? -3 : 1));
    jlog(s, CRIME[c.kind] + ' case against ' + (A ? A.name : 'someone') + ': ' + c.outcome, 'info', J);
  }

  // what follows a guilty verdict in the newer crimes: cargo seized, the organiser charged, a thieving manager let go
  function guiltyExtras(s, c, A, pen, by, J) {
    if (c.kind === 'smuggling' && pen.seize) {
      const v = Math.round(c.value * 1.5);
      if (pen.seize === 'you') { earn(s, v); s.stats.seized = (s.stats.seized || 0) + v; secret(s, 'seized', 'you kept ' + v + 'c of seized ' + (c.good || 'cargo') + ' instead of handing it to ' + J.name, [c.accused, c.guard].concat(s.gov ? s.gov.council.slice(0, 1) : []), 1 + Math.floor(v / 40), J.id, c.id); c.outcome = c.outcome.replace(/\.$/, ', and the cargo is seized (' + v + 'c, to you).'); }
      else { const ch = chestOf(s, J); if (ch) ch.chest = (ch.chest || 0) + v; c.outcome = c.outcome.replace(/\.$/, ', and the cargo is seized for the ' + (J.id === 'hearthmoor' ? 'village' : 'town') + ' chest (' + v + 'c).'); }
    }
    if (c.kind === 'smuggling' && c.guard && s.people[c.guard] && caseWeight(c) >= 3) { const g = s.people[c.guard]; if (g.job && g.job.what === TOWN_WATCH_JOB[J.id]) { g.job = null; plog(s, g, 'Dismissed from the guard for taking a smuggler\u2019s coin.'); jlog(s, g.name + ' is dismissed from the guard for looking the other way.', 'info', J); } }
    if (c.kind === 'poaching' && pen.organiser && c.organiser && s.people[c.organiser]) {
      const O = s.people[c.organiser], k = newCase(s, 'poaching', { accused: O.id, accuser: null, victim: 'crown', value: c.value * 2, where: 'the King\u2019s forest', truth: 'guilty', what: 'paying hunters to take the King\u2019s deer', claim: (A ? A.name : 'The hunter') + ' names ' + O.name + ' as the one who paid for the deer.' }, J);
      k.hidden = evidencePool(s, k); k.evidence.push({ text: (A ? A.name : 'The hunter') + ' testifies against ' + O.name + '.', w: 2 }); c.outcome = c.outcome.replace(/\.$/, '; ' + O.name + ' is charged as the organiser.');
    }
    if (c.kind === 'fraud' && c.victim === 'player' && A) {
      for (const sh of s.shops || []) if (sh.manager && sh.manager.pid === A.id) { releaseManager(s, sh.manager, 'Dismissed for skimming the takings.'); sh.manager = null; c.outcome = c.outcome.replace(/\.$/, ', and dismissed as manager.'); }
      for (const b of Object.values(s.biz || {})) if (b.manager && b.manager.pid === A.id) { releaseManager(s, b.manager, 'Dismissed for skimming the takings.'); b.manager = null; c.outcome = c.outcome.replace(/\.$/, ', and dismissed as manager.'); }
    }
  }

  // the reasons a judge can give for mercy, and whether each one is true of this case
  const MERCY = {
    hardship: { name: 'Hardship', said: 'they acted out of hunger and need' },
    first: { name: 'First offence', said: 'it is their first offence' },
    repaid: { name: 'They repay it', said: 'they have repaid what was taken' },
    cooperated: { name: 'They cooperated', said: 'they named those behind it' },
    reconciled: { name: 'Made peace', said: 'they have made peace with the one they wronged' },
    favour: { name: 'As a favour', said: 'as a favour from the bench' }
  };
  function mercyFits(s, c, why) {
    const A = s.people[c.accused]; if (!A) return false;
    const vic = c.victim && s.people[c.victim];
    if (why === 'hardship') return !!(A.hungry || A.purse < 20) && (c.kind === 'theft' || c.kind === 'poaching');
    if (why === 'first') return !(A.record > 0);
    if (why === 'repaid') return c.value > 0 && A.purse >= c.value && c.victim !== 'crown';
    if (why === 'cooperated') return !!(c.organiser || c.guard);
    if (why === 'reconciled') return !!vic && (c.kind === 'assault' || c.kind === 'theft') && (vic.opinion || 0) > -20 && (A.opinion || 0) > -20;
    return true;
  }
  const mercyReasons = (s, c) => Object.keys(MERCY).filter(k => k === 'favour' || mercyFits(s, c, k)).map(k => ({ key: k, name: MERCY[k].name }));

  /* ---------- what you did, and who knows it ---------- */
  // how bad an abuse is: what it did, how much it took, and whether you have done it before
  function secret(s, kind, text, knownBy, weight, where, caseId) {
    const J = s.justice, ids = Array.from(new Set(knownBy.filter(id => id && id !== 'player')));
    const prior = Math.min(2, J.secrets.filter(x => x.kind === kind).length);
    // what each person who knows has to gain or lose by speaking
    const prim = ids[0], P0 = s.people[prim], council = new Set(s.gov ? s.gov.council : []);
    const roleOf = id => { const q = s.people[id]; if (id === prim) return kind === 'bribe' ? 'beneficiary' : 'victim'; if (q && P0 && (q.spouse === prim || (q.parents || []).includes(prim) || (P0.parents || []).includes(id))) return 'family'; if (council.has(id)) return 'official'; return 'witness'; };
    const sources = ids.map(id => ({ pid: id, role: roleOf(id) }));
    const k = { id: J.nextSecret++, kind, text, day: s.day, sources, heard: [], knownBy: ids.slice(), weight: (weight || 1) + prior, exposed: false, demanded: false, where: where || 'hearthmoor', caseId: caseId || null };
    J.secrets.push(k); J.fear = clamp(J.fear + 4 * (weight || 1), 0, 100);
    return k;
  }
  function secretsDay(s) {
    const J = s.justice, g = s.gov, council = new Set(g ? g.council : []);
    for (const k of J.secrets) {
      if (k.exposed || k.buried) continue;
      // each person who knows has their own reasons: a victim wants it known, a family member less so, a witness
      // fears for their place, and whoever profited keeps quiet unless they turn on you. Fear shuts mouths; rumour
      // spreads it further, but hearsay is not evidence.
      if (!k.sources) { k.sources = k.knownBy.map(id => ({ pid: id, role: 'witness' })); k.heard = []; }
      for (const src of k.sources) {
        const p = s.people[src.pid]; if (!p || p.status !== 'here' || hushed(s, k, src.pid)) continue;
        // frightened people who will not speak in public may still whisper to someone who can use it
        if (J.fear >= 40 && src.role !== 'beneficiary' && !k.leaked && rand(s) < 0.006 * J.fear / 40) leak(s, k, p);
        if (rand(s) < talkChance(s, p, src.role)) { const t = villagers(s).filter(q => !q.kid && !k.knownBy.includes(q.id)); const q = t[Math.floor(rand(s) * t.length)]; if (q) { k.heard.push(q.id); k.knownBy.push(q.id); } }
      }
      for (const id of k.heard.slice()) { const p = s.people[id]; if (p && rand(s) < 0.03) { const t = villagers(s).filter(q => !q.kid && !k.knownBy.includes(q.id)); const q = t[Math.floor(rand(s) * t.length)]; if (q) { k.heard.push(q.id); k.knownBy.push(q.id); } } }
      // someone who knows may ask a price for keeping quiet
      if (!k.demanded && rand(s) < 0.04) { const who = (k.sources || []).filter(x => x.role !== 'victim').map(x => s.people[x.pid]).find(p => p && p.status === 'here' && p.opinion < 20 && !council.has(p.id)); if (who) { k.demanded = { pid: who.id, amount: 15 + Math.floor(rand(s) * 25), day: s.day }; jlog(s, who.name + ' knows what happened (' + k.text + ') and wants ' + k.demanded.amount + 'c to keep quiet.', 'bad'); } }
      // bought silence wears off: when it does, they may come back for more
      if (k.demanded && k.demanded.paid && k.demanded.until && s.day >= k.demanded.until && rand(s) < 0.15) { const q = s.people[k.demanded.pid]; if (q && q.status === 'here') { const amt = Math.round(k.demanded.amount * 1.5); k.demanded = { pid: q.id, amount: amt, day: s.day, again: (k.demanded.again || 0) + 1 }; jlog(s, q.name + ' comes back about ' + k.text + '. The price of silence is now ' + amt + 'c.', 'bad'); } }
      if (k.demanded && k.demanded.day && s.day - k.demanded.day > 3 && !k.demanded.paid) { k.knownBy.push(...villagers(s).filter(q => !q.kid).slice(0, 3).map(q => q.id)); k.demanded.day = null; }
      // rumour reaching the council starts an inquiry only if someone who saw it is willing to say so
      const willing = witnessesFor(s, k), onCouncil = k.knownBy.filter(id => council.has(id)).length;
      if (k.where && k.where !== 'hearthmoor') { if (willing.length && k.knownBy.length >= 8) { k.exposed = true; royalInquiry(s, k); } continue; }
      if (willing.length && (onCouncil >= 1 || k.knownBy.length >= 10)) { k.exposed = true; openInquiry(s, k); }
    }
    if (J.inquiry && s.day >= J.inquiry.day) closeInquiry(s);
  }
  // hush money buys about twenty days of silence, not forever
  const HUSH_DAYS = 20;
  function hushed(s, k, pid) { const v = (k.paid || {})[pid]; return v === true ? s.day < (k.demanded && k.demanded.until || 0) : typeof v === 'number' && s.day < v; }
  function leak(s, k, p) {
    k.leaked = true; const R = s.realm;
    if (R) { R.favour = clamp(R.favour - Math.min(6, 2 * k.weight), 0, 100); realmLog(s, 'Word reaches the court, by way of ' + p.name + ', that ' + k.text + '. Your rivals make use of it.', 'bad'); }
    k.knownBy.push(...villagers(s).filter(q => !q.kid && !k.knownBy.includes(q.id)).slice(0, 2).map(q => q.id));
    jlog(s, p.name + ' would not speak up, but has whispered what they know (' + k.text + ') to people who can use it.', 'bad');
  }
  function talkChance(s, p, role) {
    const fear = s.justice.fear, likes = (p.opinion || 0) > 40;
    const base = { victim: 0.1, family: 0.07, witness: 0.035 + (p.honest > 0.7 ? 0.03 : 0), official: 0.05, beneficiary: (p.opinion || 0) < -30 ? 0.03 : 0 }[role] || 0.03;
    // fear quiets people in public but never fully: it can cut what they say by at most 70%
    return Math.max(0, base * Math.max(0.3, 1 - fear / 120) + (p.grudge ? 0.04 : 0) - (likes ? 0.04 : 0));
  }
  // who would stand up and say it: those who saw it themselves, are not too afraid, and are not bought or loyal
  function witnessesFor(s, k) {
    return (k.sources || []).filter(src => { const p = s.people[src.pid]; if (!p || p.status !== 'here' || hushed(s, k, src.pid) || src.role === 'beneficiary') return false; return ((p.opinion || 0) < 25 || src.role === 'victim') && s.justice.fear < 70 + (src.role === 'victim' ? 20 : 0); });
  }
  function openInquiry(s, k) {
    const J = s.justice; if (J.inquiry) { J.inquiry.charges.push(k.id); return; }
    J.inquiry = { day: s.day + 3, charges: [k.id], opened: s.day, you: s.offices.elder === 'player' };
    approve(s, 'elder', -6); approve(s, 'you', -4);
    jlog(s, 'The council opens an inquiry into the Elder: ' + k.text + '. It sits in three days.', 'bad');
  }
  function closeInquiry(s) {
    const J = s.justice, I = J.inquiry; J.inquiry = null;
    const ks = I.charges.map(id => J.secrets.find(x => x.id === id)).filter(Boolean), weight = ks.reduce((a, k) => a + k.weight, 0);
    // an inquiry weighs testimony, not gossip: each person who saw it and will say so counts, rumour barely at all
    const testify = new Set(ks.flatMap(k => witnessesFor(s, k).map(x => x.pid))).size, heard = new Set(ks.flatMap(k => k.heard || [])).size;
    const defence = (s.gov.approval.elder || 50) / 20 + J.fear / 30;
    const score = weight * 1.5 + testify * 2 + Math.min(1, heard / 8) - defence;
    let out;
    if (s.offices.elder !== 'player' && !I.you) out = 'The inquiry finds against the old Elder. It is noted in the village book.';
    else if (s.offices.elder !== 'player') { if (score >= 3) { const fine = 10 * weight; spend(s, fine); s.stats.fines = (s.stats.fines || 0) - fine; s.village.chest += fine; addStanding(s, -10, 'the inquiry finds you abused your office while Elder.'); out = 'Though you are no longer Elder, the inquiry finds you abused the office, and you must repay ' + fine + 'c to the chest.'; } else out = 'The inquiry into your time as Elder finds nothing it can prove.'; }
    else if (score >= 6) { const fine = 20 * weight; spend(s, fine); s.stats.fines = (s.stats.fines || 0) - fine; s.village.chest += fine; s.offices.elder = null; addStanding(s, -15, 'the inquiry finds you abused your office.'); out = 'The inquiry finds you abused the office of Elder. You are removed, and must repay ' + fine + 'c to the chest.'; s.rec.removedForAbuse = (s.rec.removedForAbuse || 0) + 1; }
    else if (score >= 3) { const fine = 10 * weight; spend(s, fine); s.stats.fines = (s.stats.fines || 0) - fine; s.village.chest += fine; approve(s, 'elder', -8); out = 'The inquiry finds against you. You keep your office but must repay ' + fine + 'c to the chest, and the moot will remember.'; }
    else { approve(s, 'elder', 3); out = 'The inquiry finds nothing it can prove. Some on the council are not satisfied.'; }
    J.lastInquiry = { day: s.day, out };
    jlog(s, out, score >= 3 ? 'bad' : 'info');
  }

  /* ---------- commands ---------- */
  function justiceCmd(s, name, a, b, c) {
    const J = setupJustice(s); if (!J) return fail('There is no village watch yet.');
    setupCourts(s);
    const v = s.village, judge = youJudge(s), cs = () => { for (const C of allCourts(s)) { const k = C.cases.find(x => x.id === a); if (k) return k; } return null; };
    // for a case, the judge is whoever holds that court: the Elder here, the lord in a town, the crown in Crownmere
    const needCourt = k => canJudge(s, courtOf(s, k)) || tradeJudge(s, k) ? null : fail(courtOf(s, k).id === 'hearthmoor' ? 'Only the Elder of Hearthmoor can do that here.' : 'That is for ' + courtOf(s, k).authority + ' to decide.');
    const needJudge = () => judge ? null : fail('Only the Elder of Hearthmoor ' + (s.offices.elder === 'player' ? 'of age ' : '') + 'can do that here.');
    switch (name) {
      case 'jRecruit': { if (needJudge()) return needJudge(); const p = s.people[a]; if (!p || !guardCandidates(s).includes(p)) return fail('They cannot join the watch.'); if (J.watch.length >= J.bunks) return fail('The watch house sleeps ' + J.bunks + ' guards. Build more bunks first.'); if (v.chest < J_KIT) return fail('The chest needs ' + J_KIT + 'c for their kit.'); const from = p.job ? occupation(s, p) : null; const kit = (enlist(s, p, b || 'market'), 'the smith'); jlog(s, p.name + ' joins the village watch' + (from ? ', leaving work as ' + from.toLowerCase() : '') + '. Their kit cost the chest ' + J_KIT + 'c.'); return ok(); }
      case 'jDismiss': { if (needJudge()) return needJudge(); const g = guardOf(s, a), p = s.people[a]; if (!g) return fail('Not on the watch.'); J.watch = J.watch.filter(x => x !== g); if (p) { p.job = null; plog(s, p, 'Dismissed from the watch.'); p.opinion = clamp((p.opinion || 0) - 10, -100, 100); } return ok(); }
      case 'jDuty': { if (needJudge()) return needJudge(); const g = guardOf(s, a); if (!g || !DUTIES[b]) return fail('No such duty.'); if (b === 'yours' && !s.shops.length && !s.houses.some(h => h.owner === 'player')) return fail('You have no property here to guard.'); g.duty = b; return ok(); }
      case 'jWage': { if (needJudge()) return needJudge(); const g = guardOf(s, a); if (!g) return fail('Not on the watch.'); g.wage = clamp(Math.round(b), 2, 15); return ok(); }
      case 'jDelegate': { if (needJudge()) return needJudge(); if (!['none', 'minor', 'all'].includes(a)) return fail('Unknown.'); J.delegate = a; return ok(); }
      case 'jBuild': {
        if (needJudge()) return needJudge();
        const cost = a === 'cell' ? 120 : a === 'bunks' ? 80 : Math.round((100 - J.condition) * 0.8);
        if (a === 'cell' && J.cells >= 4) return fail('The watch house has room for four cells at most.');
        if (a === 'bunks' && J.bunks >= 5) return fail('There is room for five guards at most.');
        if (a === 'repair' && cost < 4) return fail('It is in good repair.');
        if (v.chest < cost) return fail('The village chest needs ' + cost + 'c for that.');
        v.chest -= cost; if (a === 'cell') J.cells++; else if (a === 'bunks') J.bunks = 5; else J.condition = 100;
        jlog(s, a === 'cell' ? 'A new cell is built at the watch house (' + J.cells + ' now).' : a === 'bunks' ? 'More bunks at the watch house: room for five guards.' : 'The watch house is mended.'); return ok();
      }
      case 'jInvestigate': { const k = cs(); if (!k) return fail('No such case.'); const CI = courtOf(s, k); if (CI.id !== 'hearthmoor') { if (needCourt(k)) return needCourt(k); if (k.investigating > 0) return fail('The guard is already on it.'); k.investigating = 3; jlog(s, 'The guard of ' + CI.name + ' starts asking questions.', 'info', CI); return ok(); } if (!judge && !v.council) return fail('Only the Elder can order an investigation; a councillor can ask for one.'); if (k.investigating > 0) return fail('The watch is already on it.'); const free = watchPeople(s); if (!free.captain && !free.guards.some(x => !isHeld(x.p))) return fail('There is no one on the watch to ask questions.'); k.investigating = judge ? 3 : 2; jlog(s, 'The watch starts asking questions about the ' + CRIME[k.kind].toLowerCase() + ' case' + (judge ? '.' : ', at a councillor’s request.')); return ok(); }
      case 'jArrest': {
        const k = cs(); if (!k) return fail('No such case.'); if (needCourt(k)) return needCourt(k); if (k.held) return fail('Already held.'); const CA = courtOf(s, k);
        const A = s.people[k.accused]; if (!A || A.status !== 'here') return fail('They are not here to arrest.');
        if (cellsFree(s, CA) <= 0) return fail('Every cell is full (' + CA.cells + '). Hear a case, release someone, or build another cell.');
        if (CA.id === 'hearthmoor') { const ws = watchPeople(s); if (!ws.captain && !ws.guards.length) return fail('There is no one on the watch to make the arrest.'); }
        k.held = true; k.deadline = s.day + J_HEAR_BY; hold(s, A.id, k, 'held on suspicion of ' + CRIME[k.kind].toLowerCase() + ', to be heard by day ' + k.deadline, k.deadline, CA);
        const lawful = caseWeight(k) >= 2; if (!lawful) J.fear = clamp(J.fear + 3, 0, 100);
        jlog(s, A.name + ' is arrested and held in ' + CA.place + ' until a hearing, by day ' + k.deadline + '.', 'info', CA); return ok();
      }
      case 'jRelease': { const p = s.people[a]; if (!p || !p.held) return fail('They are not held.'); const CR = allCourts(s).find(C => C.prisoners.some(x => x.pid === a)) || J; if (!canJudge(s, CR)) return fail('That is for ' + CR.authority + ' to decide.'); const k = CR.cases.find(x => x.id === p.held.caseId); if (k) k.held = false; release(s, a, 'Released by ' + CR.authority + ' pending a hearing.'); return ok(); }
      case 'jHear': {
        const k = cs(); if (!k) return fail('No such case.'); if (needCourt(k)) return needCourt(k); const CH = courtOf(s, k);
        const pen = b || {}, w = caseWeight(k), A = s.people[k.accused];
        if (pen.days > maxDays(CH)) return fail((CH.id === 'hearthmoor' ? 'The Elder' : 'This court') + ' can order ' + maxDays(CH) + ' days at most' + (CH.id === 'hearthmoor' ? '; more is for the lord\u2019s court.' : '.'));
        if (c === 'guilty' && pen.fine > maxFine(CH)) return fail('This court can fine ' + maxFine(CH) + 'c at most.');
        if (pen.confiscate && CH.id === 'hearthmoor') return fail('The Elder cannot take property; that is for a lord or the crown.');
        if (pen.confiscate === 'take') secret(s, 'seized', 'you took ' + (A ? A.name : 'someone') + '\u2019s property for yourself', [k.accused, k.accuser].concat(living(s).filter(q => q.spouse === k.accused || (q.parents || []).includes(k.accused)).map(q => q.id)), 3, CH.id, k.id);
        // judging against the evidence is an abuse, and someone always notices
        if (c === 'guilty' && (w <= 0 || k.kind === 'order')) secret(s, 'unjust', 'you knowingly convicted ' + (A ? A.name : 'someone') + ' with nothing against them', [k.accused, k.accuser].concat(living(s).filter(q => q.spouse === k.accused || (q.parents || []).includes(k.accused)).map(q => q.id)), 3, CH.id, k.id);
        if (c === 'dismiss' && w >= 4) secret(s, 'shielded', 'you let ' + (A ? A.name : 'someone') + ' go though the evidence was clear', [k.accuser].concat(watchPeople(s).guards.slice(0, 1).map(x => x.p.id)), 1 + (k.value >= 25 ? 1 : 0), CH.id, k.id);
        if (c === 'guilty' && pen.fineTo === 'you' && pen.fine) secret(s, 'pocketed', 'you kept a ' + pen.fine + 'c fine for yourself', [k.accused].concat(watchPeople(s).guards.slice(0, 1).map(x => x.p.id)), 1 + Math.floor(pen.fine / 30), CH.id, k.id);
        if (c === 'negotiate' && k.kind !== 'hoarding') return fail('There is nothing to negotiate in this case.');
        if (pen.seize && k.kind !== 'smuggling') return fail('There is no cargo to seize.');
        decide(s, k, ['guilty', 'mercy', 'negotiate'].includes(c) ? c : 'dismiss', pen, 'you');
        return ok();
      }
      case 'jBribe': {
        const k = cs(); if (!k || !k.bribe) return fail('No one is offering.'); if (needCourt(k)) return needCourt(k);
        const br = s.people[k.bribe.pid]; if (!br) { k.bribe = null; return fail('They have gone.'); }
        if (!b) { k.bribe.refused = true; br.opinion = clamp((br.opinion || 0) - 10, -100, 100); approve(s, 'elder', 1); jlog(s, 'You turn away ' + br.name + '’s purse.'); return ok(); }
        const amt = Math.min(k.bribe.amount, Math.max(0, br.purse)); br.purse -= amt; earn(s, amt); s.stats.bribes = (s.stats.bribes || 0) + amt;
        secret(s, 'bribe', 'you took ' + amt + 'c from ' + br.name + ' over the ' + CRIME[k.kind].toLowerCase() + ' case', [br.id].concat(k.bribe.wants === 'dismiss' && k.accuser && k.accuser !== 'player' ? [k.accuser] : []), 1 + Math.floor(amt / 30), courtOf(s, k).id, k.id);
        const want = k.bribe.wants; k.bribe = null;
        decide(s, k, want === 'convict' ? 'guilty' : 'dismiss', want === 'convict' ? { restitution: true, fine: 5 } : {}, 'you');
        return ok();
      }
      case 'jLean': {
        const k = cs(); if (!k) return fail('No such case.'); if (needCourt(k)) return needCourt(k); const w = k.witnesses.find(x => x.pid === b); if (!w) return fail('No such witness.');
        const p = s.people[b]; const scared = rand(s) < 0.45 + J.fear / 200 - (p.opinion > 30 ? 0.1 : 0);
        if (scared) { w.leaned = c === 'guilty' ? 3 : -3; w.shown = true; w.says = p.name.split(' ')[0] + ' now says something quite different.'; p.opinion = clamp((p.opinion || 0) - 15, -100, 100); secret(s, 'threat', 'you frightened ' + p.name + ' into changing their story', [p.id], 1, courtOf(s, k).id, k.id); jlog(s, p.name + ' changes their story.'); }
        else { p.opinion = clamp((p.opinion || 0) - 25, -100, 100); const sec = secret(s, 'threat', 'you tried to frighten ' + p.name + ' off their evidence', [p.id].concat(s.gov.council.slice(0, 1)), 1); jlog(s, p.name + ' will not be frightened, and goes straight to the council.', 'bad'); }
        return ok();
      }
      case 'jArrestOnWord': {
        if (needJudge()) return needJudge(); const p = s.people[a]; if (!p || p.status !== 'here' || !villagers(s).includes(p)) return fail('They are not in Hearthmoor.'); if (isHeld(p)) return fail('Already held.'); if (p.kid) return fail('Not a child.');
        if (cellsFree(s) <= 0) return fail('Every cell is full.');
        const ws = watchPeople(s), gd = ws.guards.filter(x => !isHeld(x.p)).map(x => ({ x, loyal: (x.p.opinion || 0) / 100, h: x.g.honest })).sort((m, n) => (n.loyal - n.h) - (m.loyal - m.h))[0];
        if (!gd && !ws.captain) return fail('There is no one on the watch to send.');
        const gp = gd ? gd.x.p : ws.captain, honest = gd ? gd.h : 0.6, loyal = (gp.opinion || 0) / 100;
        // an order with no case behind it: a loyal or frightened guard obeys, an honest one may refuse and say so
        if (honest - loyal - J.fear / 150 > 0.35 && rand(s) < 0.7) { secret(s, 'order', 'you ordered ' + p.name + '’s arrest with no charge, and ' + gp.name + ' refused', [gp.id, p.id].concat(rand(s) < 0.5 ? s.gov.council.slice(0, 1) : []), 1); gp.opinion = clamp((gp.opinion || 0) - 10, -100, 100); jlog(s, gp.name + ' refuses to arrest ' + p.name + ' without a charge.', 'bad'); return ok('refused'); }
        const k = newCase(s, 'order', { accused: p.id, accuser: 'player', victim: null, value: 0, where: 'the village', truth: 'none', what: 'held on the Elder’s word', claim: 'The Elder orders ' + p.name + ' held.' });
        k.held = true; k.deadline = s.day + J_HEAR_BY; hold(s, p.id, k, 'held on the Elder’s order, with no charge', k.deadline);
        p.opinion = clamp((p.opinion || 0) - 40, -100, 100); p.grudge = (p.grudge || 0) + 1;
        secret(s, 'order', 'you had ' + p.name + ' locked up with no charge', [p.id, gp.id].concat(living(s).filter(q => q.spouse === p.id || (q.parents || []).includes(p.id)).map(q => q.id)), 2);
        jlog(s, gp.name + ' arrests ' + p.name + ' on your word.', 'info'); return ok();
      }
      case 'jHush': {
        const k = J.secrets.find(x => x.id === a); if (!k || !k.demanded || k.demanded.paid) return fail('No one is asking.');
        const q = s.people[k.demanded.pid];
        if (b) { if (s.coins < k.demanded.amount) return fail('You need ' + k.demanded.amount + 'c.'); spend(s, k.demanded.amount); s.stats.hush = (s.stats.hush || 0) + k.demanded.amount; if (q) q.purse += k.demanded.amount; k.demanded.paid = true; k.demanded.until = s.day + HUSH_DAYS; k.paid = Object.assign(k.paid || {}, { [k.demanded.pid]: s.day + HUSH_DAYS }); jlog(s, 'You pay ' + (q ? q.name : 'them') + ' to keep quiet.'); }
        else { k.demanded.day = s.day - 3; jlog(s, 'You refuse to pay. ' + (q ? q.name : 'They') + ' will talk.', 'bad'); }
        return ok();
      }
      case 'jPetition': {
        // a councillor may ask the council to free someone held without good reason
        const p = s.people[a]; if (!v.council) return fail('Only a councillor can petition the council.'); if (!p || !p.held) return fail('They are not held.');
        const k = J.cases.find(x => x.id === p.held.caseId); const w = k ? caseWeight(k) : 0;
        if (w >= 3) return fail('The council will not release them: the evidence against them is strong.');
        if (k) k.held = false; release(s, a, 'Released on a councillor’s petition.'); p.opinion = clamp((p.opinion || 0) + 15, -100, 100); jlog(s, 'On your petition the council frees ' + p.name + '.'); return ok();
      }
      case 'jOverturn': {
        if (!youHearAppeals(s)) return fail('Only the Lord Justice or the crown hears appeals.');
        let k = null; for (const C of allCourts(s)) { k = C.closed.find(x => x.id === a); if (k) break; } if (!k || k.verdict !== 'guilty' || k.overturned) return fail('No such conviction.');
        k.overturned = true; const A = s.people[k.accused]; if (A && A.held && A.held.caseId === k.id) release(s, A.id, 'Freed on appeal.');
        const comp = 10; const CO = courtOf(s, k); if (CO.id === 'hearthmoor') s.village.chest -= comp; else if (s.towns && s.towns[CO.id]) s.towns[CO.id].chest -= comp; if (A) { A.purse += comp; A.opinion = clamp((A.opinion || 0) + 20, -100, 100); A.grudge = Math.max(0, (A.grudge || 0) - 1); }
        if (k.wrongful) J.wrongful = Math.max(0, J.wrongful - 1);
        jlog(s, 'On appeal, the conviction of ' + (A ? A.name : 'someone') + ' is overturned. The village chest pays them ' + comp + 'c for the wrong.'); return ok();
      }
      case 'jPardon': {
        if (!youHearAppeals(s)) return fail('Only the Lord Justice or the crown can pardon.');
        const p = s.people[a]; if (!p || !p.held) return fail('They are not held.');
        allCourts(s).forEach(C => C.cases.forEach(x => { if (x.id === p.held.caseId) x.held = false; })); release(s, a, 'Pardoned.'); p.opinion = clamp((p.opinion || 0) + 20, -100, 100); jlog(s, p.name + ' is pardoned and walks free.'); return ok();
      }
    }
    return fail('Unknown.');
  }
  // bribes are offered by people with something to lose and coin to spend
  function bribeOffers(s) {
    const J = s.justice; if (!J) return;
    for (const c of allCourts(s).filter(C => canJudge(s, C)).flatMap(C => C.cases)) {
      if (c.bribe || c.bribeTried || c.delegated) continue;
      const A = s.people[c.accused], acc = c.accuser && c.accuser !== 'player' && s.people[c.accuser];
      if (A && c.truth === 'guilty' && A.purse > 25 && rand(s) < 0.35) c.bribe = { pid: A.id, amount: Math.min(A.purse - 5, 15 + Math.floor(rand(s) * 20)), wants: 'dismiss' };
      else if (acc && c.truth === 'lie' && acc.purse > 25 && rand(s) < 0.35) c.bribe = { pid: acc.id, amount: Math.min(acc.purse - 5, 15 + Math.floor(rand(s) * 20)), wants: 'convict' };
      c.bribeTried = true;
      if (c.bribe) jlog(s, s.people[c.bribe.pid].name + ' comes to you privately about the ' + CRIME[c.kind].toLowerCase() + ' case, with ' + c.bribe.amount + 'c in a cloth.', 'info');
    }
  }

  /* ======================= COURTS OF THE TOWNS, AND THE CROWN'S HAND =======================
     Every town has a guard captain who answers to its lord, and a gaol fitted to its size inside a building it
     already has (the keep, the castle, the moot hall). The captain's men handle the ordinary run of cases; the
     serious ones (big thefts, violence, corruption) come to the lord, and in Crownmere to the crown. Above them:
     the Master of Trade watches the markets, the Lord Treasurer the town chests, the Marshal commands soldiers
     (kept apart from the watch), the Lord Justice reviews detentions and misconduct, and the crown appoints,
     dismisses and pardons. Authority follows jurisdiction: an office here gives no orders there. */
  const JAIL = {
    greenhaven: [2, 'the cell under the Moot Hall'], ironcrest: [4, 'the cells at Stane Keep'], oakbridge: [5, 'the gaol at Oakbridge Keep'],
    eastwatch: [6, 'the gaol at Eastwatch Castle'], crownmere: [14, 'the King’s Prison at Crownmere Castle']
  };
  function setupCourts(s) {
    if (!s.towns || !s.realm || !s.people) return null;
    s.courts = s.courts || {};
    for (const id in JAIL) {
      if (!s.towns[id]) continue;
      if (!s.courts[id]) s.courts[id] = { id, name: REGIONS[id] === 'the Crown Lands' ? 'Crownmere' : REGIONS[id], place: JAIL[id][1], authority: id === 'crownmere' ? 'the crown' : 'the lord of ' + REGIONS[id], cells: JAIL[id][0], baseCells: JAIL[id][0], condition: 90, cases: [], prisoners: [], closed: [], log: [], captain: null, misconduct: [] };
      const C = s.courts[id], cap = C.captain && s.people[C.captain];
      if (!cap || cap.status !== 'here' || !(cap.job && cap.job.what === TOWN_WATCH_JOB[id])) { const w = townFolk(s, id).filter(p => p.job && p.job.type === 'commons' && p.job.what === TOWN_WATCH_JOB[id]).sort((a, b) => (b.skill || 1) - (a.skill || 1))[0]; C.captain = w ? w.id : null; }
    }
    return s.courts;
  }
  // the Master of Trade hears market abuses, smuggling and contract fraud wherever they happen
  const TRADE_CASES = ['hoarding', 'smuggling', 'fraud'];
  const tradeJudge = (s, c) => !!(c && TRADE_CASES.includes(c.kind) && s.realm && s.realm.council.trade === 'player');
  const canJudge = (s, C) => !C ? false : C.id === 'hearthmoor' ? youJudge(s) : C.id === 'crownmere' ? isRuler(s) : !!(s.realm && regionLord(s, C.id) === 'player');
  const maxDays = C => C.id === 'hearthmoor' ? J_DETAIN_MAX : C.id === 'crownmere' ? 20 : 10;
  const maxFine = C => C.id === 'hearthmoor' ? 40 : C.id === 'crownmere' ? 200 : 100;
  const chestOf = (s, C) => C.id === 'hearthmoor' ? s.village : s.towns[C.id];
  // property taken as a penalty: lawfully it goes to the town and is sold; taken for yourself, it is theft
  function confiscate(s, c, A, mode) {
    const C = courtOf(s, c), T = chestOf(s, C), b = A.job && A.job.role === 'owner' && s.biz[A.job.biz], h = s.houses.find(x => x.owner === A.id && !x.tenants.includes(A.id)) || null;
    const what = b || h; if (!what) { c.outcome += ' They owned nothing to take.'; return; }
    const name = b ? empById(b.id).name : h.name, worth = b ? bizPrice(s, b.id) : houseValue(s, h);
    // the law may take what was lost or gained by the crime, and the court's largest fine, no more
    const cap = (c.value || 0) * 2 + maxFine(C);
    if (mode === 'lawful' && worth > cap) { c.outcome += ' ' + name + ' (worth ' + worth + 'c) is more than the law allows for this offence (' + cap + 'c), so it is not taken.'; return; }
    if (mode === 'take') { const k0 = s.justice.secrets.find(x => x.kind === 'seized' && x.caseId === c.id); if (k0) { k0.weight += Math.floor(worth / 300); k0.text += ' (' + name + ', worth ' + worth + 'c)'; } }
    if (mode === 'take') {
      if (b) { if (A.job) loseJob(s, A, 'Their business was taken by ' + s.name + '.'); b.owner = 'player'; b.staff = b.staff.filter(x => x.pid !== A.id); } else { h.owner = 'player'; }
      c.outcome += ' You took ' + name + ' for yourself.';
      for (const q of living(s)) if (townOf(q) === C.id && q.job && q.job.role === 'owner') q.opinion = clamp((q.opinion || 0) - 12, -100, 100);   // every owner in town takes note
      s.justice.fear = clamp(s.justice.fear + 10, 0, 100);
    } else {
      const sale = Math.round(worth * 0.6);
      if (b) { if (A.job) loseJob(s, A, name + ' was forfeit to the town.'); b.closed = true; b.closedOn = s.day; b.owner = null; b.staff.slice().forEach(st => { const w = s.people[st.pid]; if (w) loseJob(s, w, name + ' was forfeit and closed.'); }); b.staff = []; }
      else h.owner = C.id === 'hearthmoor' ? 'office:lord' : 'town:' + C.id;
      T.chest += sale; c.outcome += ' ' + name + ' is forfeit to the town and sold for ' + sale + 'c into its chest.';
      for (const q of living(s)) if (townOf(q) === C.id && q.job && q.job.role === 'owner') q.opinion = clamp((q.opinion || 0) - 4, -100, 100);
    }
  }
  function townCrime(s, C) {
    const id = C.id, T = s.towns[id], folk = townFolk(s, id).filter(p => !p.kid && p.status === 'here' && !p.held);
    if (folk.length < 10) return;
    const cov = clamp((T.watchN || 0) / Math.max(1, T.watchWant || 2), 0, 1.5), deter = s.day < (C.deterUntil || 0) ? 0.6 : 1;
    if (rand(s) > Math.min(0.45, folk.length / 1500) * (1.3 - 0.5 * cov) * deter) return;
    const k = rand(s), poor = p => (p.hungry ? 3 : 0) + (p.purse < 6 ? 2 : 0) + 0.3;
    const R = s.realm, port = { eastwatch: 1, crownmere: 0.5, oakbridge: 0.3 }[id] || 0;
    // high tariffs make smuggling pay; Forest Law makes hunting a crime
    if (port && rand(s) < 0.25 * port * (R ? R.tariff : 1)) { townSmuggling(s, C, folk); return; }
    if (R && R.laws.forestLaw && (id === 'greenhaven' || id === 'ironcrest') && rand(s) < 0.35) { poaching(s, C, folk); return; }
    if (k < 0.55) {
      const thief = pickBy(s, folk, poor), victim = pickBy(s, folk.filter(p => p !== thief && p.purse > 25), p => Math.min(5, p.purse / 50));
      if (!thief || !victim) return;
      const value = Math.max(5, Math.min(victim.purse - 5, 12 + Math.floor(rand(s) * 50))); victim.purse -= value; thief.purse += value;
      const r = rand(s); let accused = thief, truth = 'guilty'; const other = folk.filter(p => p !== thief && p !== victim);
      if (r > 0.7 && other.length) { accused = other[Math.floor(rand(s) * other.length)]; truth = r > 0.9 ? 'lie' : 'mistaken'; }
      const c = newCase(s, 'theft', { accused: accused.id, accuser: victim.id, victim: victim.id, value, where: victim.name.split(' ')[0] + '’s house', truth, thief: thief.id, what: value + 'c taken from ' + victim.name + ' in ' + C.name, claim: victim.name + ' says ' + accused.name + ' robbed them of ' + value + 'c.' }, C);
      c.hidden = evidencePool(s, c); addWitness(s, c, folk);
    } else if (k < 0.85) {
      const hot = pickBy(s, folk, p => p.mood < 35 ? 3 : 0.3), vic = hot && pickBy(s, folk.filter(p => p !== hot), () => 1); if (!hot || !vic) return;
      const r = rand(s), other = folk.filter(p => p !== hot && p !== vic); let accused = hot, truth = 'guilty'; if (r > 0.8 && other.length) { accused = other[Math.floor(rand(s) * other.length)]; truth = 'mistaken'; }
      const c = newCase(s, 'assault', { accused: accused.id, accuser: vic.id, victim: vic.id, value: 20, where: 'the street', truth, what: vic.name + ' was badly beaten in ' + C.name, claim: vic.name.split(' ')[0] + ' says ' + accused.name + ' attacked them.' }, C);
      c.hidden = evidencePool(s, c); addWitness(s, c, folk);
    } else {
      const off = [T.mayor].concat(T.council || []).map(x => s.people[x]).filter(p => p && p.status === 'here'); if (!off.length) return;
      const o = off[Math.floor(rand(s) * off.length)], guilty = rand(s) < 0.55, value = 20 + Math.floor(rand(s) * 40);
      if (guilty) { T.chest -= value; o.purse += value; }
      const acc = off.find(p => p !== o);
      const c = newCase(s, 'corruption', { accused: o.id, accuser: acc ? acc.id : null, victim: 'chest', value, where: 'the town chest', truth: guilty ? 'guilty' : 'lie', what: value + 'c missing from the chest of ' + C.name, claim: (acc ? acc.name : 'A guildsman') + ' says ' + o.name + ' has been taking from the town chest.' }, C);
      c.hidden = evidencePool(s, c);
    }
  }
  function bringsToYou(s, C, c) {
    const mode = C.delegate || (C.id === 'crownmere' ? 'sensitive' : 'serious'), A = s.people[c.accused];
    const sensitive = c.kind === 'corruption' || c.kind === 'smuggling' || c.kind === 'hoarding' || (A && (A.noble || (A.job && A.job.type === 'office') || (s.towns[C.id] && (s.towns[C.id].mayor === A.id || (s.towns[C.id].council || []).includes(A.id))))) || c.value >= 60;
    if (mode === 'none') return false; if (mode === 'sensitive') return sensitive;
    return sensitive || c.value >= 25 || c.kind === 'assault' || c.kind === 'fraud';
  }
  // the captain and the steward hear what is left to them, by the evidence; a royal judge in Crownmere
  function localHears(s, C, c) {
    const T = s.towns[C.id], w = caseWeight(c), A = s.people[c.accused], by = C.id === 'crownmere' ? 'the royal judges' : 'the captain and the steward';
    if (c.kind === 'hoarding') { if (w >= 3) decide(s, c, 'guilty', { fine: 40 }, by); else decide(s, c, 'negotiate', {}, by); return; }
    // punishment follows the harm: small thefts and a hungry poacher work it off; smuggled cargo is seized; the organiser is charged
    const K = c.kind, pen = K === 'smuggling' ? { fine: Math.round(c.value / 2), seize: 'chest' } : K === 'poaching' ? (c.organiser ? { fine: 10, organiser: true } : A && A.hungry ? { work: 2 } : { fine: 8 }) : K === 'fraud' ? { restitution: true, fine: 15, days: c.value >= 30 ? 2 : 0 } : { restitution: true, fine: K === 'corruption' ? 30 : c.value >= 30 ? 15 : 6, days: K === 'assault' ? 2 : K === 'corruption' ? 3 : 0, work: K === 'theft' ? (c.value >= 30 ? 3 : 2) : 0 };
    if (w >= 3) decide(s, c, 'guilty', pen, by);
    else decide(s, c, 'dismiss', {}, by);
    if (w >= 3 && c.kind === 'corruption' && A && T && T.mayor === A.id) { const nx = (T.council || []).map(x => s.people[x]).find(p => p && p.status === 'here' && p !== A); if (nx) { T.mayor = nx.id; jlog(s, A.name + ' is removed as ' + T.title + ' of ' + C.name + '. ' + nx.name + ' takes their place.', 'info', C); } }
  }
  // what becomes of captured bandits. Hanging quiets the roads they were taken on, and frightens the towns nearby;
  // the rest of the realm hears of it, but its own roads are another matter
  function sentenceBandits(s, m, fate, by) {
    const R = s.realm, n = m.n, from = m.region, rn = REGIONS[from] || 'the roads', who = by === 'you' ? '' : ' (' + by + ')';
    if (fate === 'press') { R.pressed = (R.pressed || []).concat({ n, day: s.day, region: from }); realmLog(s, n + ' captured bandits are pressed into the garrisons' + who + '. Whether they stay is another matter.', 'info'); }
    else if (fate === 'prison') { R.banditPrison = (R.banditPrison || []).concat({ n, until: s.day + 20, region: from }); realmLog(s, n + ' bandits taken in ' + rn + ' go to the castle dungeon for twenty days' + who + ', at 1c a day each from the treasury.', 'info'); }
    else if (fate === 'work') { const g = R.regions[from]; if (g) g.roads = Math.min(3, (g.roads || 0) + 1); R.workGang = (R.workGang || []).concat({ n, until: s.day + 15, region: from }); realmLog(s, n + ' bandits are set to mend the roads of ' + rn + ' under guard' + who + '.', 'info'); }
    else if (fate === 'pardon') { R.parolees = (R.parolees || []).concat({ n, day: s.day, region: from }); const T = s.towns && s.towns[from]; if (T) T.approval = clamp((T.approval || 50) + 2, 0, 100); realmLog(s, n + ' bandits are pardoned on their oath to keep the peace' + who + '.', 'info'); }
    else {
      const bad = s.bandits && (s.bandits[from] || 0);
      if (s.bandits && typeof s.bandits[from] === 'number') s.bandits[from] = Math.max(0, s.bandits[from] - Math.min(8, n * 2));
      // where the roads were truly dangerous the court approves; where they were not, it looks like cruelty
      R.favour = clamp(R.favour + (bad > 40 ? 1 : -1), 0, 100);
      const T = s.towns && s.towns[from]; if (T) T.approval = clamp((T.approval || 50) - 2, 0, 100);
      realmLog(s, n + ' bandits are hanged at the crossroads of ' + rn + who + '. Those roads go quiet for a while; the town nearby shivers.', 'info');
    }
  }
  function townSmuggling(s, C, folk) {
    const R = s.realm, owners = folk.filter(p => p.job && (p.job.role === 'owner' || (p.job.what || '').includes('dock'))), A = owners[Math.floor(rand(s) * owners.length)]; if (!A) return;
    const guilty = rand(s) < 0.7, good = ['cloth', 'wine', 'salt', 'spice'][Math.floor(rand(s) * 4)], value = Math.round((20 + rand(s) * 50) * (R ? R.tariff : 1));
    if (guilty) { A.purse += value; if (R) R.treasury -= value; }
    const guard = rand(s) < 0.3 ? folk.find(p => p.job && p.job.what === TOWN_WATCH_JOB[C.id]) : null;
    const c = newCase(s, 'smuggling', { accused: A.id, accuser: null, victim: 'crown', value, good, guard: guard ? guard.id : null, where: 'the harbour', truth: guilty ? 'guilty' : 'mistaken', what: good + ' landed in ' + C.name + ' without paying ' + value + 'c in duty', claim: 'The customs clerks say ' + A.name + ' brought in ' + good + ' without paying the duty.' }, C);
    c.hidden = evidencePool(s, c);
  }
  function poaching(s, C, folk) {
    const hunter = pickBy(s, folk.filter(p => !p.job || p.job.type === 'commons'), p => (p.hungry ? 4 : 0.5)); if (!hunter) return;
    const rich = folk.filter(p => p.job && p.job.role === 'owner' && p.purse > 100), org = rand(s) < 0.35 && rich.length ? rich[Math.floor(rand(s) * rich.length)] : null, guilty = rand(s) < 0.8;
    const value = org ? 25 + Math.floor(rand(s) * 20) : 6 + Math.floor(rand(s) * 10);
    if (guilty) { hunter.ate = (hunter.ate || 0) + 4; hunter.purse += org ? 6 : 0; if (org) org.purse += value; }
    const c = newCase(s, 'poaching', { accused: hunter.id, accuser: null, victim: 'crown', value, organiser: guilty && org ? org.id : null, where: 'the King’s forest', truth: guilty ? 'guilty' : 'mistaken', what: 'deer taken from the King’s forest near ' + C.name, claim: 'The forester says ' + hunter.name + ' has been taking the King’s deer.' }, C);
    c.hidden = evidencePool(s, c);
  }
  function courtsDay(s) {
    setupCourts(s); if (!s.courts) return;
    for (const C of Object.values(s.courts)) {
      const T = s.towns[C.id]; if (!T) continue;
      townCrime(s, C);
      const mine = canJudge(s, C);
      for (const c of C.cases.slice()) {
        if (c.status !== 'open') continue;
        if (c.investigating > 0) { if (c.hidden.length && rand(s) < 0.5) c.evidence.push(c.hidden.splice(Math.floor(rand(s) * c.hidden.length), 1)[0]); c.witnesses.forEach(w => { if (!w.shown && rand(s) < 0.5) w.shown = true; }); c.investigating--; }
        // which cases reach you: as lord, the serious ones (unless you hand them all over); as the crown, only the sensitive ones
        c.delegated = !((mine && bringsToYou(s, C, c)) || tradeJudge(s, c)) && !c.requested;
        if (c.held && c.delegated && s.day >= c.deadline) { localHears(s, C, c); continue; }
        if (c.held && s.day > c.deadline) { release(s, c.accused, 'Held past the hearing day without a hearing, and let go.'); c.held = false; }
        if (!c.asked && (c.delegated || s.day - c.day >= 2)) { c.investigating = 3; c.asked = true; }
        if ((c.delegated && s.day - c.day >= 4) || s.day - c.day >= 8) { localHears(s, C, c); }
      }
      C.cases = C.cases.filter(c => c.status === 'open');
      for (const pr of C.prisoners.slice()) { const p = s.people[pr.pid]; if (!p || p.status !== 'here') { C.prisoners = C.prisoners.filter(x => x !== pr); continue; } if (pr.until != null && s.day >= pr.until) release(s, pr.pid, pr.sentence ? 'Served their time in ' + C.place + '.' : 'Released.'); else if (C.condition < 35 && rand(s) < 0.06) { release(s, pr.pid, 'Escaped from ' + C.place + '.'); jlog(s, p.name + ' has escaped from ' + C.place + '.', 'bad', C); } }
      T.chest -= C.prisoners.length; C.condition = clamp(C.condition - 0.4 - C.prisoners.length * 0.1, 0, 100);
      // a mayor with a hand in the chest, which only an audit will find
      const m = T.mayor && s.people[T.mayor];
      if (m && m.status === 'here') { if (m.honest == null) m.honest = Math.round(rand(s) * 100) / 100; if (m.honest < 0.35 && T.chest > 80 && rand(s) < 0.04) { const x = 5 + Math.floor(rand(s) * 20); T.chest -= x; m.purse += x; T.skims = (T.skims || []).concat({ pid: m.id, amount: x, day: s.day }).slice(-20); } }
      // a merchant cornering a good, which only the Master of Trade will look into
      if (!T.hoard && rand(s) < (seasonOf(s) === 'autumn' ? 0.02 : 0.01) && s.goods && s.goods[C.id]) { const owners = townFolk(s, C.id).filter(p => p.job && p.job.role === 'owner' && p.purse > 150); const o = owners[Math.floor(rand(s) * owners.length)]; if (o) { const g = GOODS[Math.floor(rand(s) * GOODS.length)], q = Math.min(Math.round(s.goods[C.id][g] * 0.4), 60); if (q > 5) { s.goods[C.id][g] -= q; T.hoard = { pid: o.id, good: g, qty: q, day: s.day, deliberate: rand(s) < (seasonOf(s) === 'autumn' ? 0.45 : 0.7) }; } } }
      if (T.hoard && s.day - T.hoard.day > 25 && !(s.courts[C.id] && s.courts[C.id].cases.some(x => x.kind === 'hoarding' && x.accused === T.hoard.pid))) { s.goods[C.id][T.hoard.good] += T.hoard.qty; T.hoard = null; }
    }
    // soldiers back from the roads bring prisoners of their own
    // captured bandits have a hearing too: if the Marshal has not sentenced them in three days, the royal judges do
    const R = s.realm; if (R && R.military) { for (const m of R.military.filter(m => m.day == null || s.day - m.day >= 3)) sentenceBandits(s, m, R.treasury >= m.n * 20 ? 'prison' : 'work', 'the royal judges'); R.military = R.military.filter(m => m.day != null && s.day - m.day < 3); }
    if (R && s.bandits) {
      // what became of the bandits you sentenced
      (R.pressed || []).forEach(x => { if (!x.done && s.day - x.day >= 8) { x.done = true; const gone = Math.round(x.n * (0.2 + rand(s) * 0.3)), stay = x.n - gone; if (gone) s.bandits[x.region] = (s.bandits[x.region] || 0) + gone * 4; if (stay >= 3) { const g = R.regions[x.region]; if (g) g.garrison = Math.min(3, g.garrison + 1); } realmLog(s, gone ? gone + ' of the pressed bandits have deserted' + (stay >= 3 ? '; the rest strengthen the garrison.' : '.') : 'The pressed bandits have settled into the garrison.', gone ? 'bad' : 'good'); } });
      (R.parolees || []).forEach(x => { if (!x.done && s.day - x.day >= 6) { x.done = true; const back = Math.round(x.n * (0.15 + rand(s) * 0.35)); if (back) { s.bandits[x.region] = (s.bandits[x.region] || 0) + back * 5; realmLog(s, back + ' of the pardoned bandits are back on the roads of ' + REGIONS[x.region] + '.', 'bad'); } else realmLog(s, 'The pardoned bandits have kept their oath.', 'good'); } });
      (R.banditPrison || []).forEach(x => { if (s.day < x.until) R.treasury -= x.n; });
      R.banditPrison = (R.banditPrison || []).filter(x => s.day < x.until); R.pressed = (R.pressed || []).filter(x => !x.done); R.parolees = (R.parolees || []).filter(x => !x.done); R.workGang = (R.workGang || []).filter(x => s.day < x.until);
    }
  }
  // abuses out in the regions reach the crown's ears in the end
  function royalInquiry(s, k) {
    const R = s.realm; if (!R) return;
    if (!witnessesFor(s, k).length) { jlog(s, 'Rumours about you reach the court, but no one will swear to them.', 'info'); return; }
    const fine = 40 * k.weight; spend(s, fine); s.stats.fines = (s.stats.fines || 0) - fine; R.treasury += fine; R.favour = clamp(R.favour - 8 * k.weight, 0, 100);
    for (const id in R.regions) { const l = regionLord(s, id), q = l && l !== 'player' && s.people[l]; if (q) q.opinion = clamp((q.opinion || 0) - 8 * k.weight, -100, 100); }
    let out = 'Word reaches the crown that ' + k.text + '. You pay ' + fine + 'c into the treasury and your favour at court falls.';
    const held = yourLordships(s).find(id => id === k.where);
    if (held && k.weight >= 3 && R.favour < 40 && !isRuler(s)) { const g = R.regions[held]; if (g.lord === 'office') s.offices.lord = null; else g.lord = null; vacantSeat(s, held); out += ' The King strips you of ' + REGIONS[held] + '.'; }
    s.justice.lastInquiry = { day: s.day, out }; jlog(s, out, 'bad');
  }
  // the crown's hand: the council offices and the throne
  function xCmd(s, name, a, b, c) {
    setupCourts(s); const R = s.realm; if (!R || !s.courts) return fail('Not yet.');
    const seat = k => R.council[k] === 'player' || isRuler(s), C = s.courts[a];
    switch (name) {
      case 'xCell': { if (!C || !canJudge(s, C)) return fail('That gaol is not yours to build.'); const T = s.towns[a]; if (C.cells >= C.baseCells + 4) return fail('There is no room for more cells.'); if (T.chest < 150) return fail('The town chest needs 150c.'); T.chest -= 150; C.cells++; jlog(s, 'A new cell at ' + C.place + ' (' + C.cells + ' now).', 'info', C); return ok(); }
      case 'xMend': { if (!C || !canJudge(s, C)) return fail('Not yours.'); const T = s.towns[a], cost = Math.round((100 - C.condition) * 1.2); if (cost < 4) return fail('It is in good repair.'); if (T.chest < cost) return fail('The town chest needs ' + cost + 'c.'); T.chest -= cost; C.condition = 100; return ok(); }
      case 'xCaptain': { if (!C || !canJudge(s, C)) return fail('Only the lord appoints the captain.'); const p = s.people[b]; if (!p || !(p.job && p.job.what === TOWN_WATCH_JOB[a])) return fail('Choose one of the town’s watchmen.'); C.captain = p.id; p.opinion = clamp((p.opinion || 0) + 10, -100, 100); plog(s, p, 'Made captain of the guard by ' + s.name + '.'); jlog(s, p.name + ' is now captain of the guard in ' + C.name + '.', 'info', C); return ok(); }
      case 'xGuard': {
        // the lord sets how big the town's guard is: more men cost the town chest more, and the town feels safer
        if (!C || !canJudge(s, C)) return fail('Only the lord funds the guard.'); const T = s.towns[a]; T.watchMul = clamp(Math.round(b * 4) / 4, 0.75, 1.5); return ok();
      }
      case 'xDelegate': { if (!C || !canJudge(s, C)) return fail('Not your court.'); if (!['serious', 'sensitive', 'none'].includes(b)) return fail('Unknown.'); C.delegate = b; return ok(); }
      case 'xRequest': { for (const C2 of Object.values(s.courts)) { const k = C2.cases.find(x => x.id === a); if (k) { if (!canJudge(s, C2) && !tradeJudge(s, k)) return fail('That case is not for you.'); k.requested = true; k.delegated = false; return ok(); } } return fail('No such case.'); }
      case 'xFund': { if (!C || !canJudge(s, C)) return fail('Not your town.'); const n = Math.round(b); if (!(n > 0) || s.coins < n) return fail('You do not have ' + n + 'c.'); spend(s, n); s.towns[a].chest += n; s.stats.given = (s.stats.given || 0) + n; jlog(s, 'You give ' + n + 'c from your own purse to the chest of ' + C.name + '.', 'info', C); return ok(); }
      case 'xAudit': {
        if (!seat('treasury')) return fail('Only the Lord Treasurer or the crown audits the town chests.');
        if (R.lastAudit != null && s.day - R.lastAudit < 7) return fail('The clerks are still at the last audit (one a week).');
        R.lastAudit = s.day; const found = [];
        for (const id in s.towns) { const T = s.towns[id]; if (TOWNS[id] && TOWNS[id].foreign) continue; if (!T.skims || !T.skims.length) continue; if (rand(s) < 0.75) { const tot = T.skims.reduce((x, y) => x + y.amount, 0), m = s.people[T.skims[0].pid]; const back = Math.min(tot, m ? Math.max(0, m.purse) : 0); if (m) m.purse -= back; T.chest += back; T.skims = []; found.push(REGIONS[id] + ': ' + tot + 'c taken by ' + (m ? m.name : 'its mayor') + ', ' + back + 'c recovered');
          const Cx = s.courts[id]; if (Cx && m) { const k = newCase(s, 'corruption', { accused: m.id, accuser: null, victim: 'chest', value: tot, where: 'the town chest', truth: 'guilty', what: tot + 'c missing from the chest of ' + Cx.name, claim: 'The Lord Treasurer’s audit finds ' + tot + 'c gone from the chest of ' + Cx.name + ' while ' + m.name + ' held it.' }, Cx); k.evidence.push({ text: 'The audit books show the sums, day by day.', w: 3 }); } } }
        if (R.embezzled && !isRuler(s)) found.push('the royal treasury is short');
        realmLog(s, found.length ? 'Your audit finds: ' + found.join('; ') + '.' : 'Your audit finds every chest in order.', found.length ? 'good' : 'info'); if (found.length) R.favour = clamp(R.favour + 3, 0, 100); return ok();
      }
      case 'xMarket': {
        if (!seat('trade')) return fail('Only the Master of Trade or the crown looks into the markets.');
        if (R.lastMarket != null && s.day - R.lastMarket < 5) return fail('Your men are still at the last inquiry.');
        R.lastMarket = s.day; const hits = [];
        // finding a hoard opens a case: laying in stock for winter is lawful, cornering a market to starve a town is not
        for (const id in s.towns) { const T = s.towns[id], Cx = s.courts[id]; if (T.hoard && !T.hoard.cased && Cx && rand(s) < 0.8) { const o = s.people[T.hoard.pid]; if (!o) continue; T.hoard.cased = true;
          const k = newCase(s, 'hoarding', { accused: o.id, accuser: null, victim: 'town', value: Math.round(T.hoard.qty * goodsPrice(s, id, T.hoard.good)), good: T.hoard.good, where: REGIONS[id] + '\u2019s market', truth: T.hoard.deliberate ? 'guilty' : 'lawful', what: o.name + ' holds ' + T.hoard.qty + ' ' + T.hoard.good + ' off the market in ' + Cx.name, claim: 'Your clerks find ' + T.hoard.qty + ' ' + T.hoard.good + ' in ' + o.name + '\u2019s stores while the price climbs.' }, Cx);
          k.hidden = evidencePool(s, k); k.investigating = 2; hits.push(o.name + ' holding ' + T.hoard.qty + ' ' + T.hoard.good + ' in ' + REGIONS[id]); } }
        if (R.monopoly) hits.push(s.people[R.monopoly.pid].name + '’s grip on the bakeries can be broken with the charter');
        realmLog(s, hits.length ? 'Your market inquiry finds: ' + hits.join('; ') + '. The cases are yours to hear.' : 'Your market inquiry finds the markets honest.', hits.length ? 'good' : 'info'); return ok();
      }
      case 'xSoldiers': {
        if (!seat('war')) return fail('Only the Marshal or the crown commands soldiers.');
        const g = R.regions[a]; if (!g || !s.bandits || s.bandits[a] == null) return fail('No such region.');
        if (R.treasury < 50) return fail('The treasury needs 50c to send soldiers.');
        if ((R.soldiersOut || {})[a] && s.day - R.soldiersOut[a] < 3) return fail('The soldiers are still out on those roads.');
        R.treasury -= 50; R.soldiersOut = Object.assign(R.soldiersOut || {}, { [a]: s.day });
        const before = s.bandits[a]; s.bandits[a] = Math.max(0, before - 35); const caught = Math.max(0, Math.round(before / 15));
        if (caught) R.military = (R.military || []).concat({ n: caught, region: a, day: s.day });
        realmLog(s, 'Soldiers sweep the roads of ' + REGIONS[a] + (caught ? ' and bring back ' + caught + ' bandits to the castle' : '') + '. The town watch is left to its own work.', 'good'); return ok();
      }
      case 'xMartial': {
        if (!seat('war')) return fail('Only the Marshal tries military prisoners.');
        const M = R.military || []; if (!M.length) return fail('There are no military prisoners.');
        if (!['hang', 'press', 'prison', 'work', 'pardon'].includes(b)) return fail('Unknown sentence.');
        R.military = []; for (const m of M) sentenceBandits(s, m, b, 'you');
        return ok();
      }
      case 'xReview': {
        if (!seat('law')) return fail('Only the Lord Justice or the crown reviews detentions.');
        let freed = 0;
        for (const C2 of allCourts(s)) for (const pr of C2.prisoners.slice()) { const k = C2.cases.find(x => x.id === pr.caseId); const noCase = !k && !pr.sentence, order = k && k.kind === 'order'; if (noCase || order || (k && k.held && s.day > k.deadline)) { if (k) k.held = false; release(s, pr.pid, 'Freed by the Lord Justice’s review: held without lawful cause.'); freed++; } }
        realmLog(s, freed ? 'Your review frees ' + freed + ' held without lawful cause.' : 'Your review finds every prisoner lawfully held.', 'info'); if (freed) R.favour = clamp(R.favour + 2, 0, 100); return ok();
      }
      case 'xMisconduct': {
        if (!seat('law')) return fail('Only the Lord Justice or the crown investigates officials.');
        if (R.lastMisconduct != null && s.day - R.lastMisconduct < 5) return fail('Your inquiry is still sitting.');
        R.lastMisconduct = s.day; const found = [];
        for (const id in s.towns) { const T = s.towns[id], m = s.people[T.mayor]; if (TOWNS[id] && TOWNS[id].foreign) continue; if (T.skims && T.skims.length && m && rand(s) < 0.5) { const nx = (T.council || []).map(x => s.people[x]).find(p => p && p.status === 'here' && p !== m); if (nx) { T.mayor = nx.id; m.opinion = clamp((m.opinion || 0) - 40, -100, 100); found.push(m.name + ', removed as ' + T.title + ' of ' + REGIONS[id]); T.skims = []; } } }
        for (const C2 of Object.values(s.courts)) { const cap = s.people[C2.captain]; if (cap && cap.honest == null) cap.honest = rand(s); if (cap && cap.honest < 0.2 && rand(s) < 0.6) { C2.captain = null; found.push(cap.name + ', a captain who sold favours, dismissed in ' + C2.name); cap.honest = 0.5; } }
        realmLog(s, found.length ? 'Your inquiry into the king’s officers finds: ' + found.join('; ') + '.' : 'Your inquiry finds the officers honest.', found.length ? 'good' : 'info'); return ok();
      }
      case 'xDismiss': {
        // the crown dismisses a councillor and names another
        if (!isRuler(s)) return fail('Only the crown appoints and dismisses its council.');
        if (!COUNCIL[a] || !R.council[a] || R.council[a] === 'player') return fail('No one to dismiss.');
        const old = s.people[R.council[a]]; const nw = noble(s, { name: nameForNoble(s), age: 40 + Math.floor(rand(s) * 15), town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[a] + ' by ' + s.name + '.' });
        R.council[a] = nw.id; if (old) { old.opinion = clamp((old.opinion || 0) - 40, -100, 100); plog(s, old, 'Dismissed as ' + COUNCIL[a] + ' by ' + s.name + '.'); }
        for (const id in R.regions) { const l = regionLord(s, id), q = l && l !== 'player' && s.people[l]; if (q) q.opinion = clamp((q.opinion || 0) - 3, -100, 100); }
        realmLog(s, 'You dismiss ' + (old ? old.name : 'the old councillor') + ' and name ' + nw.name + ' ' + COUNCIL[a] + '.', 'info'); return ok();
      }
      case 'xDismissLord': {
        if (!isRuler(s)) return fail('Only the crown takes a lordship away.');
        const g = R.regions[a]; if (!g || a === 'crownmere') return fail('No such region.'); const l = regionLord(s, a); if (!l || l === 'player') return fail('No lord to dismiss.');
        const old = s.people[l]; if (g.lord === 'office') s.offices.lord = null; else g.lord = null; vacantSeat(s, a);
        if (old) { old.opinion = clamp((old.opinion || 0) - 60, -100, 100); plog(s, old, 'Stripped of ' + REGIONS[a] + ' by ' + s.name + '.'); }
        for (const id in R.regions) { const l2 = regionLord(s, id), q = l2 && l2 !== 'player' && s.people[l2]; if (q && q !== old) q.opinion = clamp((q.opinion || 0) - 10, -100, 100); }
        realmLog(s, 'You take ' + REGIONS[a] + ' from ' + (old ? old.name : 'its lord') + '. The other lords look to their own lands.', 'info'); return ok();
      }
    }
    return fail('Unknown.');
  }

  // every command's effect on your purse is noted, so the books can name each coin that is not a day's trade
  function cmd(s, name, a, b, c) {
    const k0 = s.coins, n0 = s.stats ? trackedNet(s) : 0, r = cmd0(s, name, a, b, c), d = s.coins - k0 - (s.stats ? trackedNet(s) - n0 : 0);
    if (d && s.stats) { const f = s.stats.flows = s.stats.flows || {}; f[name] = (f[name] || 0) + d; }
    return r;
  }
  function cmd0(s, name, a, b, c) {
    const p = s.player;
    if (s.you && s.you.regent && REGENCY_BLOCK.has(name)) return fail('You are still a child. ' + s.you.regent.name.charAt(0).toUpperCase() + s.you.regent.name.slice(1) + ' acts for you until you are 16.');
    const shop = typeof a === 'number' ? shopById(s, a) : null;
    if (/^j[A-Z]/.test(name)) return justiceCmd(s, name, a, b, c);
    if (/^x[A-Z]/.test(name)) return xCmd(s, name, a, b, c);
    switch (name) {
      case 'walk': walkTo(s, a); return ok();
      case 'goto': {
        const L = LOCS[a];
        if (!L) return fail('Unknown place');
        if (L.plot != null) { const sh = shopOnPlot(s, L.plot); walkTo(s, sh ? plotPt(sh, 'serve') : { x: L.x, z: L.z + 2.6 }); return ok(); }
        if (L.emp) { walkTo(s, empById(L.emp).spot); return ok(); }
        if (a === 'market') { walkTo(s, P.market); return ok(); }
        if (a === 'home') { walkTo(s, P.home); return ok(); }
        if (a === 'myhome') { const H = yourHouse(s); if (H) { walkTo(s, doorOf(H)); return ok(); } }
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
        const mt = marketHere(s); if (!mt) return fail('Go to a market first: the Trading Post, or a town\u2019s market square.');
        if (!GOODS.includes(a)) return fail('They do not trade that.');
        const n = b || 1;
        if (name === 'buy') {
          const cost = buyPrice(s, mt, a, n);
          if (s.goods[mt][a] < n) return fail('The market has only ' + s.goods[mt][a] + ' ' + a + '.');
          if (s.coins < cost) return fail('You need ' + cost + 'c for that.');
          if (carried(s) + n > CARRY) return fail('You can carry ' + CARRY + ' items at most.');
          spend(s, cost); s.stats.marketBuys += cost; p.inv[a] += n; s.goods[mt][a] -= n;
          return ok('Bought ' + n + ' ' + a + ' for ' + cost + 'c.');
        }
        if (p.inv[a] < n || n <= 0) return fail('You have only ' + p.inv[a] + ' ' + a + '.');
        p.inv[a] -= n; const got = sellPrice(s, mt, a, n); s.goods[mt][a] += n; earn(s, got); s.stats.rawSales += got; s.rec.rawSales += got;
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
      case 'hireHand': {
        if (!shop) return fail('No such shop.');
        if (!shop.worker) return fail('Hire a worker to run it first.');
        shop.hands = shop.hands || [];
        if (shop.hands.length >= handRoom(shop)) return fail(handRoom(shop) ? 'There is no room for more hands in a ' + tierOf(shop).name + '.' : 'A ' + tierOf(shop).name + ' has room for one worker only. Upgrade it to take on hands.');
        const ap = s.applicants[b]; if (!ap) return fail('That applicant has gone.');
        const wage = clamp(Math.round(c || ap.ask), 1, 40);
        let wp = ap.pid && s.people ? s.people[ap.pid] : null;
        if (!wp && s.people) { wp = newPerson(s, { name: ap.name, age: 18 + Math.floor(rand(s) * 20), purse: 10, skill: (ap.skill - 0.7) / 0.6 }); const h = vacancy(s, 4); if (h) moveIn(s, wp, h); }
        shop.hands.push({ pid: wp ? wp.id : null, name: ap.name, skill: ap.skill, ask: ap.ask, wage, mood: 60, since: s.day });
        s.applicants.splice(b, 1); s.rec.workersHired++;
        if (wp) { wp.job = { type: 'shop', shop: shop.id, hand: true }; plog(s, wp, 'Taken on as a hand by ' + s.name + ' at ' + wage + 'c a day.'); wp.opinion = clamp(wp.opinion + 12, -100, 100); const ag = bodyOf(s, wp); if (ag) s.agents = s.agents.filter(x => x !== ag); }
        event(s, ap.name + ' joins your ' + TRADES[shop.trade].name.toLowerCase() + ' as a hand at ' + wage + 'c a day.', 'info');
        return ok();
      }
      case 'fireHand': {
        if (!shop || !shop.hands) return fail('No such hand.');
        const h = shop.hands[b]; if (!h) return fail('No such hand.');
        shop.hands.splice(b, 1); s.rec.staffFired++;
        const hp = h.pid && s.people && s.people[h.pid]; if (hp) { hp.job = null; hp.opinion = clamp(hp.opinion - 20, -100, 100); plog(s, hp, 'Let go as a hand by ' + s.name + '.'); }
        event(s, 'You let ' + h.name + ' go.', 'info'); return ok();
      }
      case 'setHandWage': {
        if (!shop || !shop.hands || !shop.hands[b]) return fail('No such hand.');
        shop.hands[b].wage = clamp(Math.round(c), 1, 40); return ok();
      }
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
        const cost0 = v.broken && v.broken[a] ? Math.round(pr.cost / 2) : pr.cost;
        if (elder ? v.chest - cost0 < CHEST_FLOOR : v.chest < cost0) return fail(elder ? 'Even borrowing, the chest cannot go below ' + CHEST_FLOOR + 'c.' : 'The chest holds ' + v.chest + 'c; this needs ' + pr.cost + 'c. You can add your own coin, or the Elder can borrow.');
        v.chest -= cost0; v.projects[a] = s.day; s.rec.projectsFunded++; if (v.broken) delete v.broken[a];
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
        for (const n in o.favor) { const k = firstName(n); v.favor[k] = clamp((v.favor[k] || 0) + o.favor[n], -2, 2); }
        v.dispute = null; v.disputeDay = s.day + 3; s.rec.disputesSettled++;
        addStanding(s, o.standing, 'the council rules: ' + o.label.toLowerCase() + '.');
        return ok();
      }
      case 'court': {
        // spend time with someone: once a day, and it means more the more they think of you
        const q = s.people[a], Y = you(s); if (!canCourt(s, q)) return fail('You cannot court them.');
        if (Y.lastTalk[q.id] === s.day) return fail('You have spent time with ' + q.name.split(' ')[0] + ' today.');
        const body = bodyOf(s, q); if (!body || dist(p, body) > 8) return fail('Go and find ' + q.name.split(' ')[0] + ' first.');
        Y.lastTalk[q.id] = s.day;
        const gift = b === 'gift'; if (gift) { if (s.coins < 5) return fail('A gift costs 5c.'); spend(s, 5); }
        const gain = Math.round(6 + (q.opinion || 0) * 0.08 + s.village.standing * 0.05 + (gift ? 6 : 0) + rand(s) * 5);
        Y.court[q.id] = clamp((Y.court[q.id] || 0) + gain, 0, 100); q.opinion = clamp((q.opinion || 0) + 3, -100, 100);
        return ok((gift ? 'You give ' + q.name.split(' ')[0] + ' a gift and spend time together.' : 'You spend time with ' + q.name.split(' ')[0] + '.') + ' (fondness ' + Y.court[q.id] + '/100)');
      }
      case 'propose': {
        const q = s.people[a], Y = you(s); if (!canCourt(s, q)) return fail('You cannot marry them.');
        if ((Y.court[q.id] || 0) < 60) { Y.court[q.id] = Math.max(0, (Y.court[q.id] || 0) - 15); q.opinion = clamp((q.opinion || 0) - 5, -100, 100); return fail(q.name.split(' ')[0] + ' is not ready to say yes. Spend more time together first.'); }
        if (s.coins < 20) return fail('A wedding feast costs 20c.');
        spend(s, 20); wedYou(s, q); event(s, 'You marry ' + q.name + '. The village comes to the feast.', 'story'); return ok();
      }
      case 'separate': {
        const Y = you(s), q = Y.spouse && s.people[Y.spouse]; if (!q) return fail('You are not married.');
        const share = Math.max(0, Math.floor(s.coins * 0.25)); spend(s, share); q.purse += share;
        q.spouse = null; Y.spouse = null; q.opinion = clamp((q.opinion || 0) - 70, -100, 100); q.mood = clamp(q.mood - 30, 0, 100);
        q.home = null; const h = vacancy(s, 99, townOf(q)); if (h) moveIn(s, q, h);
        plog(s, q, 'Separated from ' + s.name + ', who paid ' + share + 'c.'); addStanding(s, -8, 'the village talks about your separation.'); approveHolder(s, 'player', -4);
        for (const c of yourKids(s)) if (c.kid && c.status === 'here') c.opinion = clamp((c.opinion || 0) - 20, -100, 100);
        event(s, 'You and ' + q.name + ' separate. ' + q.name.split(' ')[0] + ' takes ' + share + 'c and moves out. The children stay with you.', 'bad');
        return ok();
      }
      case 'hoping': you(s).hoping = !!a; return ok();
      case 'nameHeir': { const q = s.people[a]; if (!q || q.status !== 'here' || q.kid) return fail('Your heir must be grown.'); if (!(q.parents || []).includes(you(s).pid) && q.id !== you(s).spouse && (q.opinion || 0) < 30) return fail(q.name + ' does not know you well enough.'); you(s).heir = q.id; return ok(q.name + ' is now your named heir.'); }
      case 'handOver': { const h = yourHeirs(s).best; if (!h || h.kid) return fail('There is no grown heir to hand over to.'); succeed(s, h, 'retire'); return ok(); }
      case 'carryOn': { if (!s.pendingDeath) return fail('Not now.'); const h = (a && s.people[a] && s.people[a].status === 'here') ? s.people[a] : yourHeirs(s).best; if (!h) return fail('There is nobody to carry on.'); if (h.kid && !s.ageRate) { h.kid = false; h.age = Math.max(h.age, 16); } succeed(s, h, 'death'); return ok(); }
      case 'beginAgain': { if (!s.pendingDeath) return fail('Not now.'); beginAgain(s, a, b); return ok(); }
      case 'ageRate': if (AGE_RATES[a] == null) return fail('Unknown pace.'); s.ageRate = AGE_RATES[a]; return ok();
      case 'works': {
        if (!s.gov || s.offices.elder !== 'player') return fail('Only the Elder sets the village works.');
        s.gov.works = clamp(Math.round(a), 0, 15); return ok();
      }
      case 'openLand': {
        const v = s.village, U = LAND_USES[a];
        if (!s.gov || s.offices.elder !== 'player') return fail('Only the Elder can open the common land.');
        if (!atLoc(s, 'hall') && !atLoc(s, 'lots')) return fail('Open the land in person, at the Village Hall or on the land itself.');
        if (!U || v.land) return fail('The common land is already spoken for.');
        if (v.chest - U.cost < CHEST_FLOOR) return fail('The chest cannot stretch to ' + U.cost + 'c.');
        startLand(s, a); approveHolder(s, 'player', 5); addStanding(s, 6, 'you opened the common land.');
        govLog(s, s.name + ', as Elder, opens the common land for ' + U.name.toLowerCase() + '. Work begins tomorrow, paid from the chest.', 'good');
        return ok();
      }
      case 'appoint': {
        if (!s.gov || s.offices.elder !== 'player') return fail('Only the Elder appoints the village officers.');
        if (!OFFICES[a] || !OFFICES[a].chestPay) return fail('No such office.');
        const q = officerCandidates(s).find(p => p.id === b); if (!q) return fail('They cannot take the post.');
        appointOfficer(s, a, q); govLog(s, s.name + ' appoints ' + q.name + ' ' + OFFICES[a].title + '.', 'info'); return ok();
      }
      case 'dismiss': {
        if (!s.gov || s.offices.elder !== 'player') return fail('Only the Elder can dismiss an officer.');
        const q = s.offices[a] && s.people[s.offices[a]]; if (!q) return fail('Nobody holds that post.');
        q.job = null; q.opinion = clamp((q.opinion || 0) - 15, -100, 100); plog(s, q, 'Dismissed as ' + OFFICES[a].title + '.'); s.offices[a] = null; return ok();
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
        (shop.hands || []).forEach(h => { const hp = h.pid && s.people && s.people[h.pid]; if (hp) { hp.job = null; plog(s, hp, 'Lost their place as a hand when ' + s.name + ' sold the shop.'); } }); shop.hands = [];
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
        if (bz.lease) return fail('It is let to ' + ((s.people[bz.lease.pid] || {}).name || 'a tenant') + ' until day ' + bz.lease.until + ': they run it and choose its staff.');
        const w = s.people[b]; if (!w) return fail('No such person.');
        loseJob(s, w, 'Let go by ' + s.name + ' from ' + empById(a).name + '.');
        w.opinion = clamp(w.opinion - 30, -100, 100); s.rec.staffFired++; approveHolder(s, 'player', -3);
        event(s, 'You let ' + w.name + ' go from ' + empById(a).name + '.', 'info');
        return ok();
      }
      case 'hireStaff': {
        const bz = s.biz && s.biz[a]; if (!bz || bz.owner !== 'player') return fail('That is not your business.');
        if (bz.lease) return fail('It is let to ' + ((s.people[bz.lease.pid] || {}).name || 'a tenant') + ' until day ' + bz.lease.until + ': they run it and choose its staff.');
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
        if (bz.lease) return fail('It is let to ' + ((s.people[bz.lease.pid] || {}).name || 'a tenant') + ' until day ' + bz.lease.until + ': they run it and choose its staff.');
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
      case 'moveIn': {
        const h = s.houses && houseById(s, a);
        if (!h || h.owner !== 'player') return fail('You can only move into a house you own.');
        if (s.player.house === h.id) return fail('You already live there.');
        if (h.tenants.length) return fail('Your tenants live there. Give them notice first, or choose an empty house.');
        const from = homeOfYou(s).name;
        s.player.house = h.id; bringFamily(s, 'Moved into ' + h.name + ' with ' + s.name + '.');
        s.people[you(s).pid] && plog(s, s.people[you(s).pid], 'Moved from ' + from + ' into ' + h.name + '.');
        event(s, 'You move into ' + h.name + '. It is your home now' + (living(s).some(p => p.home === 'you') ? ', and your family comes with you' : '') + '. Your old ' + (from === 'your hut' ? 'hut stands empty, still yours' : 'house is yours to let') + '.', 'story');
        return ok();
      }
      case 'moveToHut': {
        if (!s.player.house) return fail('You already live in your hut.');
        const h = yourHouse(s); s.player.house = null; bringFamily(s, 'Moved back to the hut with ' + s.name + '.');
        event(s, 'You move back to your hut in Hearthmoor.' + (h ? ' ' + h.name + ' stands empty: a tenant may take it.' : ''), 'info');
        return ok();
      }
      case 'improveHome': {
        const h = a === 'hut' ? null : houseById(s, a);
        if (a !== 'hut' && (!h || h.owner !== 'player')) return fail('That is not your house.');
        const lv = a === 'hut' ? (s.player.hutComfort || 0) : (h.comfort || 0); if (lv >= 3) return fail('It is as fine as it can be.');
        const c = COMFORT[lv + 1].cost; if (s.coins < c) return fail('That costs ' + c + 'c.');
        spend(s, c); s.rec.invested += c; if (h) { h.comfort = lv + 1; h.wear = 0; } else s.player.hutComfort = lv + 1;
        for (const p of living(s)) if (p.home === 'you') p.mood = clamp((p.mood || 50) + 8, 0, 100);
        event(s, (h ? h.name : 'Your hut') + ' is now ' + COMFORT[lv + 1].name.toLowerCase() + ': ' + ['', 'a rug, a settle and curtains', 'proper beds, a dresser and glass in the windows', 'a tapestry, a carved chair and a great bed'][lv + 1] + '.', 'good');
        return ok();
      }
      case 'repairHouse': {
        const h = houseById(s, a); if (!h || h.owner !== 'player') return fail('That is not your house.');
        const c = Math.round((h.wear || 0) * 0.5); if (c < 2) return fail('It is in good repair.'); if (s.coins < c) return fail('Repairs cost ' + c + 'c.');
        spend(s, c); h.wear = 0; event(s, h.name + ' is repaired for ' + c + 'c.', 'info'); return ok();
      }
      case 'listForSale': {
        // a: 'house' or 'biz', b: id, c: asking price (0 to take it off the market)
        const o = a === 'house' ? houseById(s, b) : s.biz[b];
        if (!o || o.owner !== 'player') return fail('That is not yours to sell.');
        if (a === 'house' && s.player.house === b) return fail('You live there. Move out first.');
        if (a === 'biz' && c > 0 && o.lease && !leaseBreakable(s, o)) return fail('It is let until day ' + o.lease.until + '. Sell it once the lease is up.');
        o.forSale = c > 0 ? Math.round(c) : null; if (!o.forSale) s.offers = (s.offers || []).filter(x => !(x.kind === a && x.id === b));
        event(s, o.forSale ? (a === 'house' ? o.name : empById(b).name) + ' is up for sale at ' + o.forSale + 'c. Buyers will come to you.' : 'Taken off the market.', 'info');
        return ok();
      }
      case 'acceptOffer': case 'declineOffer': {
        const i = (s.offers || []).findIndex(o => o.n === a); if (i < 0) return fail('That offer has gone.');
        const o = s.offers[i], q = s.people[o.pid]; s.offers.splice(i, 1);
        if (name === 'declineOffer') { if (q) q.opinion = clamp((q.opinion || 0) - 3, -100, 100); return ok(); }
        if (!q || q.purse < o.amount) { if (q && q.purse >= o.amount * 0.8) o.amount = q.purse; else return fail('They no longer have the money.'); }
        q.purse -= o.amount; earn(s, o.amount); s.rec.coinsEarned += 0;
        if (o.kind === 'house') { const h = houseById(s, o.id); h.owner = q.id; h.forSale = null; plog(s, q, 'Bought ' + h.name + ' from ' + s.name + ' for ' + o.amount + 'c.'); event(s, 'You sold ' + h.name + ' to ' + q.name + ' for ' + o.amount + 'c.', 'coin'); }
        else {
          const b = s.biz[o.id]; if (b.manager) releaseManager(s, b.manager, 'The business was sold.'); b.manager = null; if (b.lease) endLease(s, b, 'The business was sold.');
          if (q.job) loseJob(s, q, 'Left to run their new business.');
          b.owner = q.id; b.forSale = null; q.job = { type: 'biz', biz: o.id, role: 'owner' }; b.staff = b.staff.filter(x => x.pid !== q.id);
          plog(s, q, 'Bought ' + empById(o.id).name + ' from ' + s.name + ' for ' + o.amount + 'c.'); event(s, 'You sold ' + empById(o.id).name + ' to ' + q.name + ' for ' + o.amount + 'c.', 'coin');
        }
        s.offers = s.offers.filter(x => !(x.kind === o.kind && x.id === o.id));
        return ok();
      }
      case 'leaseBiz': {
        const termArg = b; { const b = s.biz[a]; if (!b || b.owner !== 'player') return fail('That is not your business.');
        if (b.lease) return fail('It is already let.');
        const c0 = leaseCandidates(s, a).find(x => x.pid === c); if (!c0) return fail('They cannot take it on.');
        const q = s.people[c0.pid];
        if (b.manager) { releaseManager(s, b.manager, 'The business was let to ' + q.name + '.'); b.manager = null; }
        if (q.job) loseJob(s, q, 'Left to run ' + empById(a).name + ' on a lease.');
        q.job = { type: 'biz', biz: a, role: 'owner' }; b.staff = b.staff.filter(x => x.pid !== q.id);
        const term = [14, 30, 60].includes(termArg) ? termArg : 30, rent = leaseRent(c0.offer, term);
        b.lease = { pid: q.id, rent, since: s.day, term, until: s.day + term, renew: true }; plog(s, q, 'Took a ' + term + '-day lease on ' + empById(a).name + ' from ' + s.name + ' at ' + rent + 'c a day.');
        event(s, q.name + ' takes ' + empById(a).name + ' on a ' + term + '-day lease and will pay you ' + rent + 'c a day, until day ' + b.lease.until + '. They run it and keep whatever it earns above that.', 'good');
        return ok(); }
      }
      case 'leaseRenew': { const b = s.biz[a]; if (!b || !b.lease || b.owner !== 'player') return fail('It is not let.'); b.lease.renew = !!c; return ok(); }
      case 'endLease': { const b = s.biz[a]; if (!b || !b.lease) return fail('It is not let.'); if (!leaseBreakable(s, b)) return fail('The lease runs until day ' + b.lease.until + '. You can end it early only if the rent falls 2 days behind.'); endLease(s, b, 'You take ' + empById(a).name + ' back from ' + (s.people[b.lease.pid] || {}).name + '.'); return ok(); }
      case 'giftCrown': {
        const R = s.realm; if (!R || isRuler(s)) return fail('There is no one to give it to.');
        const n = Math.round(a); if (!(n > 0) || s.coins < n) return fail('You do not have ' + n + 'c.');
        const dm = diminish(s, 'crown') * (R.laws.fairCourts ? 0.5 : 1), gain = Math.min(20, n / 15) * dm; spend(s, n); R.favour = clamp(R.favour + gain, 0, 100); s.rec.given = (s.rec.given || 0) + n;
        event(s, 'You give ' + n + 'c to the King\u2019s treasury. Your favour at court rises by ' + Math.round(gain) + ' to ' + Math.round(R.favour) + (dm < 1 ? ' (gifts count for less when they come often)' : '') + '.', 'good'); return ok();
      }
      case 'attendCourt': {
        const R = s.realm; if (!R || isRuler(s)) return fail('You are the court.');
        if (R.lastCourt === s.day) return fail('You have already attended court today.');
        if (townAt(p.x, p.z) !== 'crownmere') return fail('The court sits in Crownmere castle.');
        R.lastCourt = s.day; const g = 2 + Math.min(4, (s.village ? s.village.standing : 0) / 25) + yourLordships(s).length;
        R.favour = clamp(R.favour + g, 0, 100); event(s, 'You attend the King\u2019s court and are seen by the right people. Favour ' + Math.round(R.favour) + '.', 'info'); return ok();
      }
      case 'acceptLordship': case 'refuseLordship': {
        const R = s.realm; const o = R && R.offer; if (!o) return fail('No lordship is on offer.');
        const g = R.regions[o.region]; R.offer = null;
        if (name === 'refuseLordship') { vacantSeat(s, o.region); return ok(); }
        if (yourLordships(s).some(x => x !== 'crownmere')) { vacantSeat(s, o.region); return fail('You already hold a region; the King gives ' + REGIONS[o.region] + ' to another.'); }
        if (s.coins < o.fee) { vacantSeat(s, o.region); return fail('You could not pay the fee; the King gives it to another.'); }
        spend(s, o.fee); g.lord = 'player'; R.favour = clamp(R.favour + 5, 0, 100);
        realmLog(s, 'You swear your oath to the King and are made ' + (you(s).sex === 'f' ? 'Lady' : 'Lord') + ' of ' + REGIONS[o.region] + '. Its taxes are yours, and so are its roads, patrols and garrison.', 'story'); return ok();
      }
      case 'seekLordship': {
        // a: region. The crown grants a weak lord's lands, or Hearthmoor if you hold the village's trust
        const R = s.realm; if (!R || R.exile) return fail(R && R.exile ? 'No lord will give up lands to an exile.' : 'Not yet.');
        const g = R.regions[a]; if (!g || g.lord === 'crown') return fail('Those are the Crown Lands.');
        if (regionLord(s, a) === 'player') return fail('It is already yours.');
        { const held = yourLordships(s).filter(x => x !== 'crownmere'); if (held.length) return fail('You already hold ' + REGIONS[held[0]] + '. A lord holds one region at a time: give it up first, on the Realm page.'); }
        R.lastSought = a; R.lastSoughtDay = s.day;
        if (deedsIn(s, a) < 1) return fail('The King grants lands to those who have served them. Do something for ' + REGIONS[a] + ' first: take one of its contracts, or keep a promise to its lord.');
        if (R.favour < 55) return fail('You need more favour at court (55; you have ' + Math.round(R.favour) + ').');
        const fee = LORDSHIP_FEE[a] || 400; if (s.coins < fee) return fail('The fee for the lordship of ' + REGIONS[a] + ' is ' + fee + 'c.');
        const cur = regionLord(s, a), L0 = cur && s.people[cur], weak = !L0 || L0.status !== 'here' || (L0.rep || 0) < 45 || L0.purse < 50 || (a === 'hearthmoor' && s.gov && s.gov.approval.lord < 45);
        if (!weak) return fail(L0.name + ' holds ' + REGIONS[a] + ' firmly. A lord who is failing, or in debt, can be replaced.');
        spend(s, fee); R.favour = clamp(R.favour - 10, 0, 100);
        if (g.lord === 'office') { if (L0) { loseJob(s, L0, 'Stripped of Hearthmoor by the King, who gave it to ' + s.name + '.'); } s.offices.lord = 'player'; }
        else { if (L0) { L0.noble = null; L0.retired = true; plog(s, L0, 'Lost ' + REGIONS[a] + ' to ' + s.name + ' by the King\u2019s order.'); L0.opinion = clamp((L0.opinion || 0) - 50, -100, 100); } g.lord = 'player'; }
        realmLog(s, 'The King grants you ' + REGIONS[a] + ' in place of ' + (L0 ? L0.name : 'its absent lord') + '. You are ' + (you(s).sex === 'f' ? 'Lady' : 'Lord') + ' of ' + REGIONS[a] + '.', 'story'); return ok();
      }
      case 'regionSet': {
        // a: region, b: patrol | garrison | roads | tax, c: level
        const R = s.realm; if (!R || regionLord(s, a) !== 'player') return fail('Those are not your lands.');
        const g = R.regions[a], lim = b === 'tax' ? [0.5, 2] : [0, 3]; g[b] = clamp(b === 'tax' ? Math.round(c * 4) / 4 : Math.round(c), lim[0], lim[1]); return ok();
      }
      case 'fundPatrol': {
        const B = s.bandits; if (!B || B[a] == null) return fail('Nowhere to patrol.');
        const n = Math.round(b); if (!(n > 0) || s.coins < n) return fail('You do not have ' + n + 'c.');
        spend(s, n); B[a] = Math.max(0, B[a] - n / 3); s.rec.patrolCoin = (s.rec.patrolCoin || 0) + n;
        for (const q of living(s)) if (townOf(q) === a && rand(s) < 0.2) q.opinion = clamp((q.opinion || 0) + 2, -100, 100);
        event(s, 'You pay for armed men to ride the roads around ' + REGIONS[a] + '. The bandits pull back.', 'good'); return ok();
      }
      case 'seekSeat': {
        const R = s.realm; if (!R || R.exile) return fail('Not now.');
        if (!COUNCIL[a]) return fail('No such office.'); if (R.council[a] === 'player') return fail('You already hold it.');
        // one seat at a time: to change roads you resign first, wait, and earn the new seat on its own terms
        const held0 = Object.keys(COUNCIL).find(k => R.council[k] === 'player');
        if (held0 && COUNCIL_PATH[held0] !== COUNCIL_PATH[a]) return fail('You sit as ' + COUNCIL[held0] + ', on ' + PATH_NAME[COUNCIL_PATH[held0]] + '. Resign that seat first if you want to change roads.');
        if (!held0 && s.player.resignedSeat != null && s.day - s.player.resignedSeat < 10) return fail('You resigned from the council on day ' + s.player.resignedSeat + '. The King will not take you back for ten days.');
        { const need = seatNeeds(s, a); if (need.length) return fail('To be ' + COUNCIL[a] + ' you must first ' + need.join('; ') + '.'); }
        if (!yourLordships(s).length) return fail('Only a lord sits on the royal council.');
        if (alliesOf(s).length < 2) return fail('You need at least two allies among the lords or the people of influence (you have ' + alliesOf(s).length + ').');
        if (!yourLordships(s).some(id => deedsIn(s, id) >= 2 || ((R.goodDays || {})[id] || 0) >= 10)) return fail('Show that you govern well first: ten days of safe roads and busy markets in your lands, or two deeds done there.');
        if (R.favour < 65) return fail('You need more favour at court (65; you have ' + Math.round(R.favour) + ').');
        const old = s.people[R.council[a]]; if (old) { old.opinion = clamp((old.opinion || 0) - 30, -100, 100); plog(s, old, 'Replaced as ' + COUNCIL[a] + ' by ' + s.name + '.'); }
        // rising on your road: the lower seat passes to another
        for (const k in R.council) if (R.council[k] === 'player' && k !== a) { R.council[k] = null; realmLog(s, 'You give up the post of ' + COUNCIL[k] + ' to take a higher one.', 'info'); }
        R.council[a] = 'player'; R.favour = clamp(R.favour - 5, 0, 100);
        s.player.councilPath = COUNCIL_PATH[a]; s.player.seatsHeld = Array.from(new Set((s.player.seatsHeld || []).concat(a)));
        realmLog(s, 'The King names you ' + COUNCIL[a] + ' of Alderwyn. You sit on the royal council, on ' + PATH_NAME[COUNCIL_PATH[a]] + '.', 'story'); return ok();
      }
      case 'petition': {
        const R = s.realm; if (!R || !isRuler(s)) return fail('Only the crown answers petitions.');
        const q = (R.petitions || []).find(x => x.id === a); if (!q) return fail('That petition has been answered.');
        if (q.kind === 'relief' && b === 0 && R.treasury < q.cost) return fail('The treasury has ' + R.treasury + 'c; the grain costs ' + q.cost + 'c.');
        R.petitions = R.petitions.filter(x => x !== q); answerPetition(s, q, b === 0 ? 0 : 1); return ok();
      }
      case 'resignSeat': {
        const R = s.realm; if (!R) return fail('Not now.'); const k = Object.keys(COUNCIL).find(x => R.council[x] === 'player'); if (!k) return fail('You hold no council seat.');
        R.council[k] = noble(s, { name: nameForNoble(s), age: 45, town: 'crownmere', home: 'seat:crownmere', why: 'Named ' + COUNCIL[k] + ' when ' + s.name + ' resigned.' }).id;
        s.player.resignedSeat = s.day; s.player.councilPath = null; R.favour = clamp(R.favour - 3, 0, 100);
        realmLog(s, 'You resign as ' + COUNCIL[k] + '. Another takes the seat.', 'info'); return ok();
      }
      case 'undermineKing': {
        const R = s.realm; if (!R || isRuler(s)) return fail('Not now.'); if (!yourSeats(s).length) return fail('Only a councillor can sway the court against the King.');
        if (R.lastPlot === s.day) return fail('Once a day is enough; any more would be noticed.');
        R.lastPlot = s.day;
        if (rand(s) < 0.12) { R.favour = clamp(R.favour - 25, 0, 100); realmLog(s, 'Your whispers against the King are overheard. Your favour at court falls sharply.', 'bad'); return ok(); }
        R.kingSupport = clamp(R.kingSupport - 4 - rand(s) * 3, 5, 95); event(s, 'You quietly turn a few courtiers against the King. His standing at court is ' + Math.round(R.kingSupport) + '.', 'info'); return ok();
      }
      case 'patronage': {
        // a: 'lords' (gifts to every lord), 'guilds' (a guild feast in Crownmere), or 'town' with b: which town (a feast for its people)
        const R = s.realm; if (!R) return fail('Not yet.');
        if (a === 'lords') {
          const ls = Object.keys(R.regions).map(id => regionLord(s, id)).filter(l => l && l !== 'player' && s.people[l] && l !== R.king);
          const c = ls.length * 120; if (s.coins < c) return fail('Gifts fit for ' + ls.length + ' lords cost ' + c + 'c.');
          const dm = diminish(s, 'lords'); spend(s, c); ls.forEach(l => { const q = s.people[l]; q.opinion = clamp((q.opinion || 0) + Math.round(14 * dm), -100, 100); plog(s, q, 'Received a fine gift from ' + s.name + '.'); });
          event(s, 'You send gifts to ' + ls.length + ' lords of the realm: horses, plate and wine. They think better of you.', 'good');
        } else if (a === 'guilds') {
          const c = 300; if (s.coins < c) return fail('A guild feast costs ' + c + 'c.');
          const dm = diminish(s, 'guilds'); spend(s, c); Object.values(s.biz).filter(b => !b.closed && b.owner !== 'player').forEach(b => { const q = s.people[b.owner]; if (q) q.opinion = clamp((q.opinion || 0) + Math.round(7 * dm), -100, 100); });
          event(s, 'You hold a feast for the guild masters of every town in the Guildhall of Crownmere. The guilds speak well of you.', 'good');
        } else if (a === 'town') {
          const folk = living(s).filter(q => townOf(q) === b && !q.kid); const c = Math.max(40, Math.round(folk.length * 0.6));
          if (!folk.length) return fail('No such town.'); if (s.coins < c) return fail('A feast for ' + TOWNS[b].name + ' costs ' + c + 'c.');
          const dm = diminish(s, 'town:' + b); spend(s, c); folk.forEach(q => { q.opinion = clamp((q.opinion || 0) + Math.round(12 * dm), -100, 100); q.mood = clamp(q.mood + 6, 0, 100); });
          if (s.towns && s.towns[b]) s.towns[b].approval = clamp(s.towns[b].approval + 2, 0, 100);
          event(s, 'You lay on a feast for the people of ' + TOWNS[b].name + ': roast meat, bread and ale in the square. They will remember it.', 'good');
        } else return fail('No such thing.');
        computeSupport(s); return ok();
      }
      case 'takeContract': {
        const R = s.realm, c = R && (R.contracts || []).find(x => x.n === a); if (!c || c.done) return fail('That contract has gone.');
        if (c.taken) return fail('You already took it.'); if (R.contracts.filter(x => x.taken).length >= 2) return fail('You can hold two contracts at a time.');
        c.taken = true; c.delivered = 0; event(s, 'You agree to ' + c.what + ' by day ' + c.until + ' for ' + c.who + '.', 'info'); return ok();
      }
      case 'fulfil': {
        const R = s.realm, c = R && (R.contracts || []).find(x => x.n === a && x.taken && !x.done); if (!c) return fail('No such contract.');
        if (c.kind === 'clear') return fail('This one is done when the roads of ' + REGIONS[c.region] + ' are safe (danger under 20). Pay for patrols there.');
        if (marketHere(s) !== c.region) return fail('Bring it to the market in ' + REGIONS[c.region] + '.');
        if (c.kind === 'repair' && s.coins < c.cost) return fail('The repair needs ' + c.cost + 'c as well as the timber.');
        const n = Math.min(p.inv[c.good] || 0, c.qty - (c.delivered || 0)); if (n <= 0) return fail('You have no ' + (c.good === 'wood' ? 'timber' : c.good) + ' with you.');
        p.inv[c.good] -= n; c.delivered = (c.delivered || 0) + n;
        if (c.kind === 'supply') { setupGoods(s); s.goods[c.region][c.good] += n; }   // what you bring goes on the market's stalls and eases a shortage
        if (c.delivered < c.qty) return ok('Delivered ' + n + '. ' + (c.qty - c.delivered) + ' more to go.');
        if (c.kind === 'repair') spend(s, c.cost);
        completeContract(s, c); return ok();
      }
      case 'givePromise': case 'refusePromise': {
        const R = s.realm, pr = R && (R.promises || []).find(x => x.state === 'asked'); if (!pr) return fail('No one is asking.');
        if (name === 'refusePromise') { pr.state = 'refused'; const q = s.people[pr.pid]; if (q) q.opinion = clamp((q.opinion || 0) - 3, -100, 100); return ok(); }
        pr.state = 'given'; pr.until = s.day + 7; event(s, 'You give your word: the roads of ' + REGIONS[pr.region] + ' will stay safe (danger under 30) until day ' + pr.until + '.', 'info'); return ok();
      }
      case 'backFigure': case 'opposeFigure': {
        const R = s.realm; setupFigures(s); const f = R.figures.find(x => x.kind === a), q = f && s.people[f.pid]; if (!q || q.status === 'dead') return fail('They are gone.');
        const back = name === 'backFigure';
        if (f.kind === 'merchant') {
          if (back) { if (s.coins < 200) return fail('He wants 200c invested in his venture.'); spend(s, 200); f.ally = true; f.foe = false; q.opinion = clamp((q.opinion || 0) + 40, -100, 100); realmLog(s, 'You invest 200c with ' + q.name + '. He counts you a partner: 2c a day from each business he owns, and his voice among the guilds.', 'good'); }
          else { if (!(isRuler(s) || R.council.trade === 'player')) return fail('Only the Master of Trade or the ruler can refuse him a royal charter.'); R.monopoly = null; R.charterRefused = true; f.foe = true; f.ally = false; q.opinion = clamp((q.opinion || 0) - 60, -100, 100); realmLog(s, 'You refuse ' + q.name + ' a charter over bread. His monopoly will not stand, and he will not forget it.', 'story'); }
        } else if (f.kind === 'lord') {
          const heir = s.people[f.heirPid];
          if (back) { if (R.favour < 10) return fail('You need some favour at court to speak for his heir.'); R.favour = clamp(R.favour - 10, 0, 100); f.ally = true; f.foe = false; f.done = true; q.opinion = clamp((q.opinion || 0) + 50, -100, 100); realmLog(s, 'You speak at court for ' + (heir ? heir.name : 'his heir') + '\u2019s right to Ironcrest. ' + q.name + ' is your ally.', 'good'); }
          else { f.foe = true; f.ally = false; q.opinion = clamp((q.opinion || 0) - 40, -100, 100); realmLog(s, 'You oppose ' + q.name + '\u2019s plans for his heir. He becomes your enemy at court.', 'story'); }
        } else {
          if (back) { if ((R.embezzled || 0) > 0) return fail('He will not stand beside someone who has taken from the treasury. Repay it first.'); f.ally = true; f.foe = false; q.opinion = clamp((q.opinion || 0) + 40, -100, 100); f.progress = Math.min(5, f.progress + 2);
            if (isRuler(s) || f.progress >= 5) { R.laws.fairCourts = true; f.done = true; realmLog(s, 'The Fair Courts are proclaimed, with your backing. ' + q.name + ' is your ally.', 'good'); } else realmLog(s, 'You back ' + q.name + '\u2019s reform at court. He is your ally.', 'good'); }
          else { f.foe = true; f.ally = false; q.opinion = clamp((q.opinion || 0) - 40, -100, 100); realmLog(s, 'You oppose the Fair Courts. ' + q.name + ' will be watching the treasury closely.', 'story'); }
        }
        computeSupport(s); return ok();
      }
      case 'rallyAlly': {
        const R = s.realm, E = R && R.exile; if (!E) return fail('Only an exile needs to rally allies.');
        const q = s.people[a]; if (!q || q.status === 'dead') return fail('They are gone.'); if (E.allies.includes(a)) return fail('They are already sworn to you.');
        if ((q.opinion || 0) < 25) return fail(q.name + ' does not think well enough of you (needs 25; ' + Math.round(q.opinion || 0) + ').'); if (s.coins < 80) return fail('Winning a sworn ally costs 80c in gifts.');
        spend(s, 80); E.allies.push(a); realmLog(s, q.name + ' swears to support your return.', 'good'); return ok();
      }
      case 'warChest': { const R = s.realm, E = R && R.exile; if (!E) return fail('Not in exile.'); const n = Math.round(a); if (!(n > 0) || s.coins < n) return fail('You do not have ' + n + 'c.'); spend(s, n); E.fund = (E.fund || 0) + n; event(s, 'Your war chest holds ' + E.fund + 'c.', 'info'); return ok(); }
      case 'exposeRuler': {
        const R = s.realm, E = R && R.exile; if (!E) return fail('Not in exile.'); if (townAt(p.x, p.z) !== 'crownmere') return fail('The proof of the new ruler\u2019s failings is in Crownmere.');
        if (E.lastExpose && s.day - E.lastExpose < 3) return fail('Lie low for a few days before you try again.'); E.lastExpose = s.day;
        if (rand(s) < 0.7) { R.kingSupport = clamp(R.kingSupport - 9, 5, 95); realmLog(s, 'Your people spread proof of the new ruler\u2019s failures through the capital. Their standing falls to ' + Math.round(R.kingSupport) + '.', 'good'); }
        else { const t = Math.round(Math.max(0, s.coins) * 0.1); spend(s, t); realmLog(s, 'Your agents are caught in Crownmere. You pay ' + t + 'c to free them.', 'bad'); }
        return ok();
      }
      case 'moveToSeat': {
        const R = s.realm, id = (a && regionLord(s, a) === 'player') ? a : yourLordships(s).find(x => x !== 'crownmere') || (isRuler(s) ? 'crownmere' : null);
        if (!id) return fail('You hold no seat to move into.');
        if (s.player.seat === id) return fail('You already live there.');
        for (const q of living(s)) if (q.home === 'seat:' + id && q.id !== R.king) { q.home = null; const h = vacancy(s, 99, townOf(q)); if (h) moveIn(s, q, h); plog(s, q, 'Moved out of the seat of ' + REGIONS[id] + ' for ' + s.name + '.'); }
        s.player.seat = id; bringFamily(s, 'Moved into ' + seatName(s, id) + ' with ' + s.name + '.');
        realmLog(s, 'You move into ' + seatName(s, id) + ', the seat of ' + REGIONS[id] + '. It carries your family\u2019s name now.', 'story'); return ok();
      }
      case 'renounceLordship': {
        const R = s.realm; if (!R || regionLord(s, a) !== 'player' || a === 'crownmere') return fail('That is not yours to give up.');
        if (R.regions[a].lord === 'office') { s.offices.lord = null; replaceLord(s, s.name + ' gave the lordship back to the crown'); } else { R.regions[a].lord = null; vacantSeat(s, a); }
        if (s.player.seat === a) { s.player.seat = null; bringFamily(s, 'Left the seat of ' + REGIONS[a] + '.'); }
        realmLog(s, 'You give ' + REGIONS[a] + ' back to the crown.', 'info'); return ok();
      }
      case 'claimCrown': {
        const R = s.realm; if (!R) return fail('Not yet.'); if (isRuler(s)) return fail('The crown is already yours.');
        const sup = computeSupport(s);
        if (!R.exile && !yourLordships(s).length) return fail('You must hold a lordship first.');
        if (!R.exile && !yourSeats(s).length) return fail('You must sit on the royal council first.');
        if (R.exile) { const ex = exileReady(s); if (!(ex.allies && ex.fund && ex.towns && ex.exposed)) return fail('To come back you need three sworn allies (' + (R.exile.allies || []).length + '), a war chest of 600c (' + (R.exile.fund || 0) + 'c), the towns behind you (' + R.support.towns + ' of 55), and the new ruler\u2019s failings exposed (their standing ' + Math.round(R.kingSupport) + ', under 50).'); }
        else { if (alliesOf(s).length < 3) return fail('You need three allies to claim the crown (you have ' + alliesOf(s).length + ').'); if (!(R.kept > 0)) return fail('No one follows a claimant whose word is untested. Keep a promise to a lord first.'); }
        const need = 65;
        if (sup < need) return fail('Your support is ' + sup + '. You need ' + need + ' to claim the crown.');
        const K = s.people[R.king];
        if (K && K.status === 'here' && R.kingSupport >= (R.exile ? 50 : 45)) { R.favour = clamp(R.favour - 30, 0, 100); realmLog(s, 'You claim the crown, but the court stands by King ' + K.name.split(' ')[0] + '. The claim fails, and your favour falls.', 'bad'); return ok(); }
        crownYou(s, R.exile ? 'You return from exile with the realm behind you' : 'The lords, the guilds and the court turn to you, and the old King gives way'); return ok();
      }
      case 'rule': {
        // a: what to set, b: its value
        const R = s.realm; if (!isRuler(s)) return fail('Only the ruler can do that.');
        if (a === 'tax') R.taxRate = clamp(Math.round(b * 4) / 4, 0.5, 2);
        else if (a === 'tariff') R.tariff = clamp(Math.round(b * 4) / 4, 0, 3);
        else if (a === 'levies') R.levies = clamp(Math.round(b / 10) * 10, 0, 600);
        else if (a === 'law' && LAWS[b]) R.laws[b] = !R.laws[b];
        else if (a === 'draw') { const n = Math.min(Math.round(b), Math.max(0, R.treasury)); R.treasury -= n; earn(s, n); R.embezzled = (R.embezzled || 0) + n; R.favour = clamp(R.favour - n / 40, 0, 100); event(s, 'You take ' + n + 'c from the treasury for your own use. The court notices.', 'info'); }
        else if (a === 'give') { const n = Math.min(Math.round(b), Math.max(0, s.coins)); spend(s, n); R.treasury += n; R.embezzled = Math.max(0, (R.embezzled || 0) - n); event(s, 'You put ' + n + 'c of your own into the treasury.', 'good'); }
        else if (a === 'payRival' && R.rival) { const n = Math.round(R.rival.strength * 6); if (R.treasury < n) return fail('Buying off ' + R.rival.name + ' would cost ' + n + 'c from the treasury.'); R.treasury -= n; realmLog(s, 'You pay ' + R.rival.name + ' ' + n + 'c to give up the claim and leave the realm.', 'info'); R.rival = null; }
        else return fail('Nothing to set.');
        computeSupport(s); return ok();
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
      case 'sail': {
        // passage by ship between Eastwatch, Stormrest Isle and Dawnport; ships sail by day, and not when a winter storm is up
        const from = portHere(s); if (!from) return fail('Ships leave from the quay: the passage office in Eastwatch, or the quay in Dawnport.');
        if (!PORTS[a] || a === from) return fail('No ship goes there.');
        const h = hourOf(s); if (h < 7 || h >= 17) return fail('The last ship has sailed. The first leaves at seven in the morning.');
        if (seaRough(s)) return fail('A storm is up on the Sundering Sea. No ship will sail today.');
        const f = passageFare(from, a) + (p.horse ? 10 : 0); if (s.coins < f) return fail('The passage is ' + f + 'c' + (p.horse ? ' with your horse' : '') + '.');
        spend(s, f); s.rec.fares = (s.rec.fares || 0) + f;
        const via = (from === 'eastwatch' && a === 'dawnport') || (from === 'dawnport' && a === 'eastwatch');
        const mins = Math.round(seaDist(from, a) / SAIL_MPM) + (via ? 25 : 0), P1 = PORTS[a];
        s.player.x = P1.x + Math.sin(P1.face) * 3; s.player.z = P1.z + Math.cos(P1.face) * 3; s.player.dest = null; s.player.action = null; p.riding = false;
        s.rec.sailed = (s.rec.sailed || 0) + 1;
        if (a === 'dawnport' && !s.rec.landedValdoria) { s.rec.landedValdoria = s.day; event(s, 'You step onto the quay at Dawnport. Sandstone, red tiles, the smell of salt pans and oranges: Valdoria.', 'story'); }
        event(s, 'You sail to ' + P1.name + (via ? ' by way of Stormrest Isle' : '') + ' for ' + f + 'c. The crossing takes ' + mins + ' minutes.', 'info');
        return { ok: true, mins };
      }
      case 'journey': {
        // walk or ride the roads to another town
        if (!TOWNS[a] || !TOWNS[a].open) return fail('That road is not open yet.');
        const from = townAt(p.x, p.z) || 'hearthmoor', how = p.riding && p.horse ? 'ride' : 'walk', mins = travelTo(s, a, how);
        const ambush = roadAmbush(s, from, a, mins);
        return { ok: true, mins, how, ambush };
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
      case 'audit': {
        // a: 'shop' or 'biz', b: its id. An auditor goes through the books: 15c, once every five days
        const o = a === 'shop' ? shopById(s, b) : s.biz[b]; if (!o || !o.manager) return fail('There is no manager to audit.');
        const m = o.manager; if (m.audited != null && s.day - m.audited < 5) return fail('The books were audited on day ' + m.audited + '.');
        if (s.coins < 15) return fail('An audit costs 15c.');
        spend(s, 15); m.audited = s.day;
        const town = a === 'shop' ? 'hearthmoor' : (o.town || 'hearthmoor'), name = managedName(s, a, b);
        if (m.skim > 0 && rand(s) < 0.75) { openFraud(s, m, town, name, true, 'audit'); return ok('found'); }
        const mp = s.people[m.pid]; if (mp) mp.opinion = clamp((mp.opinion || 0) - (m.honest >= 0.3 ? 4 : 0), -100, 100);
        report(s, 'The audit of ' + name + ' finds the books in order.'); return ok('clean');
      }
      case 'hireManager': {
        // a: 'shop' or 'biz', b: its id, c: the person
        const o = a === 'shop' ? shopById(s, b) : s.biz[b];
        if (o && o.lease) return fail('It is let: the tenant runs it.');
        if (a === 'shop' && o && !(o.tier > 0)) return fail('A ' + tierOf(o).name + ' is too small for a manager. Upgrade it first.');
        if (!o || (a === 'biz' && o.owner !== 'player')) return fail('That is not your business.');
        if (o.manager) return fail('It already has a manager.');
        const cand = managerCandidates(s, a, b).find(x => x.pid === c); if (!cand) return fail('They cannot take the post.');
        const q = s.people[c];
        if (q.job && q.job.type === 'biz') { const ob = s.biz[q.job.biz]; if (ob) ob.staff = ob.staff.filter(x => x.pid !== q.id); }
        q.job = { type: 'manage', kind: a, ref: b }; q.opinion = clamp((q.opinion || 0) + 15, -100, 100);
        o.manager = { pid: q.id, name: q.name, skill: cand.skill, wage: cand.ask, budget: 10, staffTarget: a === 'biz' ? Math.max(1, o.staff.length) : 0, since: s.day, honest: charOf(q) };
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
  // saves leave out what every person has by default, and loading puts it back in the same order
  const PERSON_TEMPLATE = { id: null, name: null, age: 0, purse: 0, skill: 0, job: null, home: null, mood: 60, opinion: 0, arrears: 0, homeless: 0, status: 'here', log: null, palette: 0, ate: 0, retired: false };
  const STRIP = ['purse', 'skill', 'job', 'home', 'mood', 'opinion', 'arrears', 'homeless', 'status', 'palette', 'ate', 'retired'];
  function serialize(s) {
    if (!s.people) return JSON.stringify(s);
    const people = {};
    for (const id in s.people) { const p = s.people[id], o = {}; for (const k in p) if (!(STRIP.includes(k) && p[k] === PERSON_TEMPLATE[k])) o[k] = p[k]; people[id] = o; }
    return JSON.stringify(Object.assign({}, s, { people }));
  }
  function inflatePeople(s) { if (s.people) for (const id in s.people) { const p = Object.assign({}, PERSON_TEMPLATE, s.people[id]); if (!p.log) p.log = []; s.people[id] = p; } }
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
    inflatePeople(s);
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
    if (s.v === 9) { s.v = 10; s.ageRate = 4; event(s, 'Time now passes for everyone: people age a year every four days, marry, have children, grow old and die. Change the pace in Settings.', 'story'); }
    if (s.v === 10) { s.v = 11; setupCrownmere(s); event(s, 'The roads to the capital are open: north from Oakbridge, and north-east from Greenhaven, to Crownmere on its lake.', 'story'); }
    if (s.v === 11) { s.v = 12; giveSurnames(s); generateAncestry(s); for (const a of s.agents) if (a.pid && s.people[a.pid]) a.name = s.people[a.pid].name; event(s, 'Every family now has a surname, and a married woman\u2019s maiden name is kept, so family trees show where everyone came from.', 'info'); }
    if (s.v === 12) { s.v = 13; setupNewTown(s, 'ironcrest'); setupNewTown(s, 'eastwatch'); setupRealm(s); event(s, 'Two more roads are open: east from Oakbridge to the port of Eastwatch, and from Crownmere up into the mountains to Ironcrest. The kingdom of Alderwyn has lords, a court and a crown, and bandits on its roads.', 'story'); }
    if (s.v === 13) { s.v = 14; setupNewTown(s, 'dawnport'); setupValdoria(s); event(s, 'Ships now sail from Eastwatch across the Sundering Sea, by way of Stormrest Isle, to Dawnport in Valdoria. Anyone who can pay the passage may go.', 'story'); }
    if (!s.player || !Array.isArray(s.shops) || !Array.isArray(s.agents) || !s.rec) throw new Error('Save is missing data');
    return s;
  }

  const api = {
    DP, DP_JOBS, PORTS, ISLE, VSHORE, passageFare, seaDist, SAIL_MPM, portHere, seaRough, setupValdoria,
    REALM, RUMORS, PROJECTS, TOLLS, DISPUTES, STEPS, stepText, PETITION_CHOICES, CHAPTERS, skillPct, OFFICES, NEW_HUTS, MANOR_HOME,
    elderTitle, lordTitle, person, living, occupation, homeText, income, setupCourts, canJudge, tradeJudge, talkChance, hushed, sentenceBandits, referenceOf, charOf, MERCY, mercyReasons, mercyFits, HUSH_DAYS, maxDays, maxFine, JAIL, allCourts, courtOf, watchTarget, TOWN_WATCH_JOB, setupJustice, coverage, caseWeight, DUTIES, CRIME, guardCandidates, watchPeople, cellsFree, youJudge, youHearAppeals, J_DETAIN_MAX, J_KIT, isHeld, houseById, sellerWilling, areaOf, LAND, leaseRent, leaseBreakable, handRoom, roundQuota, seatNeeds, COUNCIL_PATH, PATH_NAME, LORDSHIP_FEE, landlordName, holderName, bizPrice, housePrice, appoint, vacancy,
    VERSION, TRADES, TRADE_KEYS, PLOTS, REL, EMPLOYERS, LOCS, P, HOMES, WORKER_HOMES, BUY, SELL, GATHER, GOALS, CARRY, GOODS, LEARN_SHIFTS, WHY,
    calendar, seasonOf, SEASON_FX, MONTHS, YEAR_DAYS, MONTH_DAYS, AGE_RATES, newGame, step, advance, cmd, rate, serialize, deserialize, hourOf, clock, hm, carried, skillLabel, dist,
    tierOf, plotPt, shopLabel, shopById, shopOnPlot, empById, learned, tradeSpeed, inShift, playerAtWork, wtpMean, recipeText, costText, goodsName,
    netWorth, propertyValue, summary, workerHours, canPay,
    relation, bloodRelation, you, yourKids, yourHeirs, inheritPreview, canCourt, familyName, AGE_RATES, heirsOf, childrenOf, dies, born, marry, LAND_USES, NEW_COTTAGES, officerCandidates, managerCandidates, managerOf, STAGE, fare, roadDist, HORSE_PRICE, HORSE_SELL, STABLING, COACH_MPM, WALK_MPM, RIDE_MPM, sexOf, ECON, TOWN_GOODS, GOODS_BASE, goodsPrice, buyPrice, sellPrice, marketHere, MARKET_AT, townDemand, sellersOf, shopShare, alliesOf, deedsIn, totalDeeds, exileReady, setupFigures, REGIONS, COUNCIL, LAWS, regionLord, lordName, isRuler, yourLordships, yourSeats, computeSupport, supportOf, setupRealm, setupNewTown, IC, EW, COMFORT, marketOf, houseValue, leaseCandidates, STARTS, applyStart, seatName, yourSeat, yourHouse, yourTown, homeOfYou, houseShape, doorOf, CM, LAKE, CM_JOBS, setupCrownmere, GH, GREEN, GH_JOBS, LAYOUT, townFolk, setupGreenhaven, OAK, OAK_JOBS, FEES, tradeName, townOf, villagers, townAt, oakFolk, HOUSES, MILL, BIZ_SITES, TOWNS, ROADS, RIVER, WAYSTATION, RUIN, OAKGATE, relocate, cityLoad, _moveTo: moveTo, _separate: separate, initGov, holdMoot, electElder, replaceLord, seize, repTarget, thriftOf, councilNames, isHousehold, govLog, INTEREST, SEIZE_AT, CHEST_FLOOR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
