const fs = require("fs")
const readline = require("readline")
const fsp = require("fs").promises
const path = require("path")

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.stats = {} // Combined daily and folder stats
    this.totalLines = 0
    this.parsedLines = 0
    this.ipGeoMap = new Map()
  }

  async ipToGeo(ip4) {
    const { ipGeoMap } = this
    // Check if the IP exists in the in-memory map
    if (ipGeoMap.has(ip4)) return ipGeoMap.get(ip4)

    // Prepare the cache file path
    const firstPart = ip4.split(".")[0]
    const cacheDir = path.join(__dirname, "ipToGeo", firstPart)
    const cacheFile = path.join(cacheDir, `${ip4}.json`)

    try {
      // Check if the IP data exists in the cache folder
      const cachedData = await fsp.readFile(cacheFile, "utf-8")
      const geoData = JSON.parse(cachedData)

      // Store in the in-memory map and return
      ipGeoMap.set(ip4, geoData)
      return geoData
    } catch (error) {
      // If file doesn't exist or there's an error reading it, proceed to download
      if (error.code !== "ENOENT") {
        console.error(`Error reading cache file: ${error.message}`)
      }
    }

    try {
      // Download data from ip-api.com using fetch
      const response = await fetch(`http://ip-api.com/json/${ip4}`)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const geoData = await response.json()

      // Store the data in the in-memory map
      ipGeoMap.set(ip4, geoData)

      // Ensure the cache directory exists
      await fsp.mkdir(cacheDir, { recursive: true })

      // Write the data to the cache file
      await fsp.writeFile(cacheFile, JSON.stringify(geoData, null, 2))

      return geoData
    } catch (error) {
      console.error(`Error fetching or caching geo data: ${error.message}`)
      throw error
    }
  }

  parseLogEntry(entry) {
    const regex = /^(read|write) ([^ ]+) ([^ ]+) (\d+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/
    const match = entry.match(regex)
    if (match) {
      const url = match[3]
      // Extract filename from URL
      const filename = url.split("/").pop().split("?")[0]

      return {
        method: match[1] === "read" ? "GET" : "POST",
        folder: match[2],
        url: url,
        filename: filename,
        timestamp: new Date(parseInt(match[4])),
        ip: match[5],
        responseTime: match[6],
        statusCode: match[7],
        userAgent: match[8]
      }
    }
    return null
  }

  updateStats(entry) {
    if (!entry) return

    const date = entry.timestamp.toISOString().split("T")[0]
    const key = `${date}|${entry.folder}`

    if (!this.stats[key])
      this.stats[key] = {
        date,
        folder: entry.folder,
        reads: 0,
        writes: 0,
        uniqueReaders: new Set(),
        uniqueWriters: new Set(),
        pageViews: new Map() // Track views per page
      }

    const row = this.stats[key]

    if (entry.method === "GET") {
      row.reads++
      row.uniqueReaders.add(entry.ip)

      // Update page views
      if (entry.filename.endsWith(".html")) {
        const currentViews = row.pageViews.get(entry.filename) || 0
        row.pageViews.set(entry.filename, currentViews + 1)
      }
    } else if (entry.method === "POST") {
      row.writes++
      row.uniqueWriters.add(entry.ip)
    }
  }

  getTopPages(pageViews, count = 5) {
    return Array.from(pageViews.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([filename]) => filename)
  }

  finalizeStats() {
    Object.values(this.stats).forEach(stat => {
      stat.readers = stat.uniqueReaders.size
      stat.writers = stat.uniqueWriters.size

      // Get top 5 pages and store them as rank1 through rank5
      const topPages = this.getTopPages(stat.pageViews)
      for (let i = 0; i < 5; i++) {
        stat[`rank${i + 1}`] = topPages[i] || "" // Empty string if no page exists for this rank
      }

      // Clean up temporary data structures
      stat.uniqueReaders
      stat.uniqueWriters
      delete stat.pageViews
    })
  }

  async processLogFile() {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(this.inputFile)
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      })

      rl.on("line", line => {
        this.totalLines++
        const entry = this.parseLogEntry(line)
        if (entry) {
          this.parsedLines++
          this.updateStats(entry)
        } else {
          console.log(`Failed to parse line: ${line}`)
        }
      })

      rl.on("close", () => {
        console.log(`Total lines processed: ${this.totalLines}`)
        console.log(`Successfully parsed lines: ${this.parsedLines}`)
        this.finalizeStats()
        resolve()
      })

      fileStream.on("error", error => {
        reject(error)
      })
    })
  }

  get csv() {
    const csvHeader = "Date,Folder,Reads,Readers,Writes,Writers,Rank1,Rank2,Rank3,Rank4,Rank5\n"
    const csvRows = Object.values(this.stats)
      .map(({ date, folder, reads, readers, writes, writers, rank1, rank2, rank3, rank4, rank5 }) => `${date},${folder},${reads},${readers},${writes},${writers},${rank1},${rank2},${rank3},${rank4},${rank5}`)
      .join("\n")
    return csvHeader + csvRows
  }

  get csvTotal() {
    // Create a map to store daily totals
    const dailyTotals = new Map()

    // Aggregate stats by date
    Object.values(this.stats).forEach(({ date, reads, uniqueReaders, writes, uniqueWriters }) => {
      if (!dailyTotals.has(date)) {
        dailyTotals.set(date, {
          reads: 0,
          readers: new Set(),
          writes: 0,
          writers: new Set()
        })
      }

      const totals = dailyTotals.get(date)
      totals.reads += reads
      totals.writes += writes

      // For readers and writers, we need to add the counts since they're already unique per folder
      totals.readers = new Set([...totals.readers, ...uniqueReaders])
      totals.writers = new Set([...totals.writers, ...uniqueWriters])
    })

    // Convert to CSV
    const csvHeader = "Date,Reads,Readers,Writes,Writers\n"
    const csvRows = Array.from(dailyTotals.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, totals]) => `${date},${totals.reads},${totals.readers.size},${totals.writes},${totals.writers.size}`)
      .join("\n")

    return csvHeader + csvRows
  }

  getStats() {
    return this.stats
  }
}

module.exports = { Dashboard }
