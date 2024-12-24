const path = require("path")
const { ScrollFile, ScrollFileSystem } = require("scroll-cli/scroll.js")

class CronRunner {
  constructor(scrollHub) {
    this.scrollHub = scrollHub
    this.interval = 1 * 60 * 1000 // 1 minute default
    this.isRunning = false
    this.runningJobs = new Set()
    this.minute = 0
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true
    this.timer = setInterval(() => this.checkCronFiles(), this.interval)
    console.log("CronRunner started")
    return this
  }

  stop() {
    if (!this.isRunning) return
    clearInterval(this.timer)
    this.isRunning = false
    console.log("CronRunner stopped")
  }

  async checkCronFiles() {
    const { rootFolder, folderCache } = this.scrollHub
    const folderNames = Object.keys(folderCache)

    console.log(`Running Cron Loop. Minute ${this.minute}`)
    this.minute++
    for (const folderName of folderNames) {
      try {
        // Skip if already running
        if (this.runningJobs.has(folderName)) continue

        const cronJsPath = path.join(rootFolder, folderName, "cron.js")
        const jsExists = await this.scrollHub.exists(cronJsPath)
        if (jsExists) {
          delete require.cache[require.resolve(cronJsPath)]
          require(cronJsPath)
        }

        const cronPath = path.join(rootFolder, folderName, "cron.scroll")
        const exists = await this.scrollHub.exists(cronPath)
        if (!exists) continue

        this.runningJobs.add(folderName)
        const file = new ScrollFile(undefined, cronPath, new ScrollFileSystem())
        await file.fuse()
        await file.scrollProgram.buildAll()
        this.runningJobs.delete(folderName)
      } catch (err) {
        console.error(`Error running cron for ${folderName}:`, err)
        this.runningJobs.delete(folderName)
      }
    }
  }
}

module.exports = { CronRunner }
