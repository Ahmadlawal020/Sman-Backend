#!/usr/bin/env node
/**
 * Development seed for the local dashboard database.
 *
 * Replaces the test-suite fixture residue (`test-*@soroman.test`,
 * `Fixture Customer`, `Cust 1..9`) with data that actually exercises the UI:
 *
 *   - orders spread across ~90 days, so date presets, custom ranges and the
 *     per-day subtotal rows all have something to work on
 *   - the full six-status lifecycle in realistic proportion, with the matching
 *     lifecycle timestamps set so status and dates never contradict each other
 *   - real Nigerian depots, states, products and price points
 *   - drivers and trucks populated, and PFIs attached to roughly half the book
 *
 * Safety: refuses to run against anything that is not localhost.
 *
 *   node scripts/seed-dev.js            # wipe + reseed
 *   node scripts/seed-dev.js --keep     # add to what is already there
 */
require('dotenv').config()
const { Client } = require('pg')

const URL = process.env.DATABASE_URL || ''
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL)) {
  console.error('Refusing to run: DATABASE_URL is not a localhost database.')
  console.error(`  got: ${URL.replace(/(:\/\/[^:]+:)[^@]*@/, '$1****@')}`)
  process.exit(1)
}

const KEEP = process.argv.includes('--keep')

// ── Reference data ──────────────────────────────────────────────────────────

const DEPOTS = [
  ['Apapa Terminal',        'DP-APA-01', 'Apapa Wharf Road',            'Lagos',        'Lagos',   28_000_000],
  ['Tin Can Island Depot',  'DP-TCI-02', 'Tin Can Island Port',         'Lagos',        'Lagos',   22_000_000],
  ['Ibafo Depot',           'DP-IBF-03', 'Lagos-Ibadan Expressway',     'Ibafo',        'Ogun',    12_000_000],
  ['Warri Terminal',        'DP-WRI-04', 'Ekpan Industrial Layout',     'Warri',        'Delta',   18_000_000],
  ['Oghara Depot',          'DP-OGH-05', 'Oghara Refinery Road',        'Oghara',       'Delta',   14_000_000],
  ['Port Harcourt Depot',   'DP-PHC-06', 'Trans-Amadi Industrial Area', 'Port Harcourt','Rivers',  20_000_000],
  ['Calabar Terminal',      'DP-CAL-07', 'Calabar Free Trade Zone',     'Calabar',      'Cross River', 10_000_000],
  ['Koko Depot',            'DP-KOK-08', 'Koko Port Access Road',       'Koko',         'Delta',    9_000_000],
]

const PRODUCTS = [
  ['Premium Motor Spirit', 'PMS-001', 'White Product', 'Litres', 1_045],
  ['Automotive Gas Oil',   'AGO-002', 'White Product', 'Litres', 1_320],
  ['Dual Purpose Kerosene','DPK-003', 'White Product', 'Litres', 1_180],
  ['Liquefied Petroleum Gas','LPG-004','Gas',          'Kg',     1_250],
  ['Low Pour Fuel Oil',    'LPFO-005','Black Product', 'Litres',   890],
]

const COMPANIES = [
  ['Zenith Energy Ltd', 'Chukwuemeka Obi'], ['Northgate Petroleum', 'Aisha Bello'],
  ['Delta Fuels Nigeria', 'Tunde Adeyemi'], ['Rivers Oil & Gas', 'Ngozi Eze'],
  ['Sahara Bulk Traders', 'Ibrahim Musa'], ['Coastal Energy Services', 'Funmilayo Ojo'],
  ['Greenfield Filling Co', 'Emeka Nwosu'], ['Atlas Downstream', 'Hauwa Yakubu'],
  ['Meridian Petroleum', 'Segun Balogun'], ['Harbourline Fuels', 'Chiamaka Okeke'],
  ['Trans-Niger Logistics', 'Yusuf Danjuma'], ['Bluewater Energy', 'Adaeze Nnamdi'],
  ['Summit Oil Nigeria', 'Kolawole Ajayi'], ['Ranger Fuel Distribution', 'Zainab Lawal'],
  ['Eastgate Petrochemicals', 'Obiora Chukwu'], ['Lagoon Energy Partners', 'Bisi Adewale'],
  ['Crestview Fuels', 'Musa Abdullahi'], ['Pinnacle Downstream Ltd', 'Chinelo Udo'],
  ['Westbridge Oil', 'Femi Oyelaran'], ['Unity Bulk Petroleum', 'Amina Sule'],
]

const DRIVERS = [
  ['Sunday Adebayo', 'A'], ['Nasiru Garba', 'A'], ['Ekene Okafor', 'B'],
  ['Bashir Aliyu', 'A'], ['Peter Ochuko', 'A'], ['Ismail Yakubu', 'B'],
  ['Godwin Etim', 'A'], ['Suleiman Bala', 'A'], ['Chidi Anyanwu', 'B'],
  ['Rasheed Ogunleye', 'A'], ['Monday Effiong', 'A'], ['Kabiru Shehu', 'A'],
]

const TRUCK_MAKES = [
  ['MAN', 'TGS 33.400', 45_000], ['Scania', 'P410 6x4', 45_000],
  ['Mercedes-Benz', 'Actros 3340', 40_000], ['Howo', 'A7 6x4', 33_000],
  ['IVECO', 'Trakker 410', 38_000], ['DAF', 'CF 85', 45_000],
]

// Status mix, roughly matching a live book.
const STATUS_MIX = [
  ['Completed', 34], ['Released', 16], ['Loading', 10],
  ['Paid', 18], ['Pending', 17], ['Cancelled', 5],
]

// ── Helpers ─────────────────────────────────────────────────────────────────

let seed = 20260801
/** Deterministic PRNG, so reseeding produces a comparable book. */
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const phone = () => `+2348${between(10, 99)}${String(between(0, 9999999)).padStart(7, '0')}`

function weightedStatus() {
  const total = STATUS_MIX.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [status, w] of STATUS_MIX) {
    if ((r -= w) <= 0) return status
  }
  return 'Pending'
}

/** Business-hours timestamp n days back from today. */
function dayOffset(daysBack) {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(between(7, 18), between(0, 59), between(0, 59), 0)
  return d
}

const ORDER_COUNT = 2200
const DAYS_BACK = 90

async function main() {
  const db = new Client({ connectionString: URL })
  await db.connect()
  console.log('connected to', URL.replace(/(:\/\/[^:]+:)[^@]*@/, '$1****@'))

  if (!KEEP) {
    // Order matters — orders reference customers, depots, products and pfis.
    console.log('clearing existing rows (staff and admin login are preserved)…')
    await db.query(`
      TRUNCATE orders, tickets, pfis, customers, depots, products, trucks, drivers
      RESTART IDENTITY CASCADE;
    `)
  }

  // Depots
  const depotIds = []
  for (const [name, code, address, city, state, cap] of DEPOTS) {
    const { rows } = await db.query(
      `INSERT INTO depots (name, code, address, city, state, country, postcode,
         max_capacity, status, established_year, parked_trucks_count)
       VALUES ($1,$2,$3,$4,$5,'Nigeria',$6,$7,$8,$9,$10) RETURNING id`,
      [name, code, address, city, state, String(between(100001, 999999)), cap,
        rnd() > 0.85 ? 'Maintenance' : 'Active', String(between(1998, 2019)), between(0, 14)],
    )
    depotIds.push({ id: rows[0].id, state, name })
  }
  console.log(`depots:    ${depotIds.length}`)

  // Products
  const productIds = []
  for (const [name, sku, category, unit, price] of PRODUCTS) {
    const { rows } = await db.query(
      `INSERT INTO products (name, sku, category, unit, stock_level, supplier, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, sku, category, unit, between(500_000, 9_000_000), 'NNPC Retail', `${name} for bulk distribution`],
    )
    productIds.push({ id: rows[0].id, name, unit, price })
  }
  console.log(`products:  ${productIds.length}`)

  // Drivers
  const driverIds = []
  for (const [name, cls] of DRIVERS) {
    const { rows } = await db.query(
      `INSERT INTO drivers (name, email, phone, license_number, license_class,
         rating, status, safety_score, license_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [name, `${name.toLowerCase().replace(/\s+/g, '.')}@soroman.ng`, phone(),
        `NDL${between(1000000, 9999999)}`, cls, (3.5 + rnd() * 1.5).toFixed(1),
        pick(['Active', 'On Trip', 'Off Duty']), between(72, 99),
        dayOffset(-between(120, 900))],
    )
    driverIds.push(rows[0].id)
  }
  console.log(`drivers:   ${driverIds.length}`)

  // Trucks, each tied to a driver.
  for (let i = 0; i < driverIds.length; i++) {
    const [make, model, cap] = TRUCK_MAKES[i % TRUCK_MAKES.length]
    await db.query(
      `INSERT INTO trucks (plate_number, model, capacity, status, driver_ref,
         fuel_level, mileage, vin, year, make, type,
         insurance_expiry, registration_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Tanker',$11,$12)`,
      [`${pick(['LAG', 'ABJ', 'PHC', 'WRI'])}-${between(100, 999)}-${pick(['XA', 'XB', 'ZY', 'KJ'])}`,
        model, `${cap.toLocaleString()} L`,
        pick(['In Transit', 'Idle', 'Idle', 'Maintenance']), driverIds[i],
        between(15, 100), `${between(40_000, 480_000).toLocaleString()} km`,
        `VIN${between(10000000, 99999999)}`, between(2014, 2023), make,
        dayOffset(-between(30, 400)), dayOffset(-between(30, 400))],
    )
  }
  console.log(`trucks:    ${driverIds.length}`)

  // Customers
  const customerIds = []
  for (const [company, contact] of COMPANIES) {
    const deposit = between(2, 90) * 1_000_000
    const { rows } = await db.query(
      `INSERT INTO customers (name, email, phone, company_name, address, status,
         balance, deposit, created_via, phone_verified_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [contact, `${contact.split(' ')[0].toLowerCase()}@${company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        phone(), company, `${between(1, 200)} ${pick(['Trans-Amadi', 'Apapa Wharf', 'Ikeja Industrial', 'Aba Road', 'Airport Road'])}, ${pick(['Lagos', 'Port Harcourt', 'Warri', 'Abuja'])}`,
        rnd() > 0.9 ? 'Inactive' : 'Active',
        between(0, 40) * 1_000_000, deposit, pick(['desk', 'portal', 'whatsapp']),
        dayOffset(between(100, 400)), dayOffset(between(100, 400))],
    )
    customerIds.push(rows[0].id)
  }
  console.log(`customers: ${customerIds.length}`)

  // PFIs — roughly one per depot/product pairing that sees traffic.
  const pfiIds = []
  for (let i = 0; i < 14; i++) {
    const depot = pick(depotIds)
    const product = pick(productIds)
    const starting = between(1_000, 6_000) * 1_000
    const sold = Math.floor(starting * (0.15 + rnd() * 0.7))
    const { rows } = await db.query(
      `INSERT INTO pfis (pfi_number, status, description, pfi_date,
         location_id, location_name, product_id, product_name, product_unit,
         starting_qty_litres, sold_qty_litres, unit_price, total_amount,
         vessel_name, surveyor_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())
       RETURNING id`,
      [`PFI-${2026}-${String(1000 + i)}`, rnd() > 0.3 ? 'active' : 'finished',
        `${product.name} allocation at ${depot.name}`, dayOffset(between(20, 120)),
        depot.id, depot.name, product.id, product.name, product.unit,
        starting, sold, product.price, starting * product.price,
        `MT ${pick(['Adaeze', 'Sea Falcon', 'Niger Star', 'Atlantic Dawn'])}`,
        pick(['Intertek', 'SGS Nigeria', 'Bureau Veritas'])],
    )
    pfiIds.push(rows[0].id)
  }
  console.log(`pfis:      ${pfiIds.length}`)

  // Orders — the point of the exercise.
  console.log(`orders:    seeding ${ORDER_COUNT} across ${DAYS_BACK} days…`)
  const counts = {}
  for (let i = 0; i < ORDER_COUNT; i++) {
    // Weight recent days more heavily, the way a real book looks.
    const daysBack = Math.floor(Math.pow(rnd(), 1.7) * DAYS_BACK)
    const createdAt = dayOffset(daysBack)
    const depot = pick(depotIds)
    const product = pick(productIds)
    const status = weightedStatus()
    const qty = between(5, 45) * 1_000
    const unitPrice = product.price + between(-40, 60)
    const total = qty * unitPrice
    counts[status] = (counts[status] || 0) + 1

    // Lifecycle timestamps must agree with the status.
    const paid = ['Paid', 'Released', 'Loading', 'Completed'].includes(status)
    const released = ['Released', 'Loading', 'Completed'].includes(status)
    const step = (base, mins) => new Date(base.getTime() + mins * 60_000)
    const paidAt = paid ? step(createdAt, between(20, 600)) : null
    const releasedAt = released ? step(paidAt ?? createdAt, between(30, 900)) : null
    const loadingAt = ['Loading', 'Completed'].includes(status) ? step(releasedAt, between(20, 300)) : null
    const completedAt = status === 'Completed' ? step(loadingAt, between(60, 1440)) : null
    const cancelledAt = status === 'Cancelled' ? step(createdAt, between(30, 2880)) : null

    await db.query(
      `INSERT INTO orders (order_number, customer_id, state, depot_id, product_id,
         quantity, price, total_amount, delivery_type, pfi_id,
         payment_status, status, created_at, updated_at,
         payment_confirmed_at, released_at, loading_started_at, completed_at,
         cancelled_at, cancellation_reason, delivery_address,
         virtual_account_number, virtual_account_bank, virtual_account_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        `ORD-${String(createdAt.getFullYear()).slice(2)}${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(5, '0')}`,
        pick(customerIds), depot.state, depot.id, product.id,
        qty, unitPrice, total,
        rnd() > 0.45 ? 'delivery' : 'pickup',
        rnd() > 0.45 ? pick(pfiIds) : null,
        paid ? 'Paid' : 'Unpaid', status, createdAt,
        paidAt, releasedAt, loadingAt, completedAt, cancelledAt,
        status === 'Cancelled' ? pick(['Customer withdrew', 'Payment lapsed', 'Depot stock shortfall']) : null,
        rnd() > 0.45 ? `${between(1, 90)} ${pick(['Refinery Road', 'Aba Road', 'Ikorodu Road', 'Airport Road'])}, ${depot.state}` : '',
        String(between(1000000000, 9999999999)), pick(['Wema Bank', 'Providus Bank', 'Sterling Bank']),
        'Soroman Energy Ltd',
      ],
    )
  }

  const { rows: summary } = await db.query(`
    SELECT count(*)::int AS orders,
           count(DISTINCT date(created_at))::int AS days,
           min(date(created_at))::text AS first_day,
           max(date(created_at))::text AS last_day,
           count(*) FILTER (WHERE date(created_at) = current_date)::int AS today
    FROM orders`)

  console.log('\n── seeded ──')
  console.log(`orders          ${summary[0].orders}`)
  console.log(`distinct days   ${summary[0].days}  (${summary[0].first_day} .. ${summary[0].last_day})`)
  console.log(`dated today     ${summary[0].today}`)
  console.log(`status mix      ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  await db.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
