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
    const regex = /^(read|write) ([^ ]+) ([^ ]+) (\d+) ([^ ]+) (.+)$/
    const match = entry.match(regex)
    if (match) {
      return {
        method: match[1] === "read" ? "GET" : "POST",
        folder: match[2],
        url: match[3],
        timestamp: new Date(parseInt(match[4])),
        ip: match[5],
        userAgent: match[6]
      }
    }
    return null
  }

  updateStats(entry) {
    if (entry) {
      const date = entry.timestamp.toISOString().split("T")[0]
      const key = `${date}|${entry.folder}`

      if (!this.stats[key]) {
        this.stats[key] = {
          date,
          folder: entry.folder,
          reads: 0,
          writes: 0,
          uniqueReaders: new Set(),
          uniqueWriters: new Set()
        }
      }

      if (entry.method === "GET") {
        this.stats[key].reads++
        this.stats[key].uniqueReaders.add(entry.ip)
      } else if (entry.method === "POST") {
        this.stats[key].writes++
        this.stats[key].uniqueWriters.add(entry.ip)
      }
    }
  }

  finalizeStats() {
    Object.values(this.stats).forEach(stat => {
      stat.readers = stat.uniqueReaders.size
      stat.writers = stat.uniqueWriters.size
      delete stat.uniqueReaders
      delete stat.uniqueWriters
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
    const csvHeader = "Date,Folder,Reads,Readers,Writes,Writers\n"
    const csvRows = Object.values(this.stats)
      .map(({ date, folder, reads, readers, writes, writers }) => `${date},${folder},${reads},${readers},${writes},${writers}`)
      .join("\n")
    return csvHeader + csvRows
  }

  getStats() {
    return this.stats
  }
}

module.exports = { Dashboard }
