import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const OUT = 'docs/images'

const shots = [
  { name: 'projects', theme: 'light', path: '/' },
  { name: 'schema', theme: 'light', path: '/databases/db_core_prod_main/schema' },
  { name: 'migration', theme: 'dark', path: '/migrations/m_001' },
  { name: 'query-studio', theme: 'dark', path: '/databases/db_core_prod_main/query', run: true },
]

const browser = await chromium.launch()
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  // Seed an authenticated mock session + theme before the app boots.
  await ctx.addInitScript(
    ([theme]) => {
      localStorage.setItem('checkpoint.mockSession', '1')
      localStorage.setItem('checkpoint.theme', theme)
      localStorage.setItem('checkpoint.navCollapsed', '0')
    },
    [s.theme],
  )
  const page = await ctx.newPage()
  await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  if (s.run) {
    await page.getByRole('button', { name: 'Run query' }).click()
    await page.waitForTimeout(700)
    // Show the MySQL \G-style terminal view.
    await page.getByRole('button', { name: 'Vertical' }).click()
    await page.waitForTimeout(400)
  }
  await page.screenshot({ path: `${OUT}/${s.name}.jpg`, type: 'jpeg', quality: 90 })
  console.log('captured', s.name)
  await ctx.close()
}
await browser.close()
