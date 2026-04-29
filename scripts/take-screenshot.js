import puppeteer from 'puppeteer'

async function capture() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  
  // Navigate to local preview server
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle2' })
  
  // Ensure the dashboard data is loaded
  await page.waitForSelector('.kpi-grid', { timeout: 10000 }).catch(() => console.log('KPI grid not found, taking screenshot anyway'))
  
  // Wait a bit more for charts and animations
  await new Promise(r => setTimeout(r, 2000))
  
  // Take screenshot
  await page.screenshot({ path: 'dashboard.png', fullPage: true })
  
  await browser.close()
}

capture().catch(err => {
  console.error(err)
  process.exit(1)
})
