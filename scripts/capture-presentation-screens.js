import puppeteer from 'puppeteer'

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://127.0.0.1:5173/', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForSelector('.screen-nav button', { timeout: 60_000 })
  await new Promise((resolve) => setTimeout(resolve, 2_000))

  const screens = [
    ['dashboard', 0],
    ['monthly', 1],
    ['daily', 2],
    ['plan', 3],
    ['admin', 4],
  ]

  for (const [name, index] of screens) {
    await page.evaluate((buttonIndex) => {
      document.querySelectorAll('.screen-nav button')[buttonIndex]?.click()
    }, index)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await page.screenshot({
      path: `LatamFX_screen_${name}.png`,
      fullPage: false,
    })
  }
} finally {
  await browser.close()
}
