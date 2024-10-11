const fs = require("fs")
const readline = require("readline")

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.dailyStats = {}
    this.totalLines = 0
    this.parsedLines = 0
  }

  parseLogEntry(entry) {
    const regex = /^(read|write) ([^ ]+) ([^ ]+) (\d+) (.+)$/
    const match = entry.match(regex)
    if (match) {
      return {
        method: match[1] === "read" ? "GET" : "POST",
        path: match[2],
        ip: match[3],
        timestamp: new Date(parseInt(match[4])),
        userAgent: match[5]
      }
    }
    return null
  }

  updateDailyStats(entry) {
    if (entry) {
      const date = entry.timestamp.toISOString().split("T")[0]
      if (!this.dailyStats[date]) {
        this.dailyStats[date] = {
          reads: 0,
          writes: 0,
          uniqueReaders: new Set(),
          uniqueWriters: new Set()
        }
      }

      if (entry.method === "GET") {
        this.dailyStats[date].reads++
        this.dailyStats[date].uniqueReaders.add(entry.ip)
        console.log(`Read request from IP: ${entry.ip}`)
      } else if (entry.method === "POST") {
        this.dailyStats[date].writes++
        this.dailyStats[date].uniqueWriters.add(entry.ip)
        console.log(`Write request from IP: ${entry.ip}`)
      }
    }
  }

  finalizeDailyStats() {
    Object.keys(this.dailyStats).forEach(date => {
      this.dailyStats[date].readers = this.dailyStats[date].uniqueReaders.size
      this.dailyStats[date].writers = this.dailyStats[date].uniqueWriters.size
      console.log(`Date: ${date}`)
      console.log(`  Unique readers: ${this.dailyStats[date].uniqueReaders.size}`)
      console.log(`  Reader IPs: ${[...this.dailyStats[date].uniqueReaders].join(", ")}`)
      console.log(`  Unique writers: ${this.dailyStats[date].uniqueWriters.size}`)
      console.log(`  Writer IPs: ${[...this.dailyStats[date].uniqueWriters].join(", ")}`)
      delete this.dailyStats[date].uniqueReaders
      delete this.dailyStats[date].uniqueWriters
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
          this.updateDailyStats(entry)
        } else {
          console.log(`Failed to parse line: ${line}`)
        }
      })

      rl.on("close", () => {
        console.log(`Total lines processed: ${this.totalLines}`)
        console.log(`Successfully parsed lines: ${this.parsedLines}`)
        this.finalizeDailyStats()
        resolve()
      })

      fileStream.on("error", error => {
        reject(error)
      })
    })
  }

  get csv() {
    const csvHeader = "Date,Reads,Readers,Writes,Writers\n"
    const csvRows = Object.entries(this.dailyStats)
      .map(([date, stats]) => `${date},${stats.reads},${stats.readers},${stats.writes},${stats.writers}`)
      .join("\n")
    return csvHeader + csvRows
  }

  getDailyStats() {
    return this.dailyStats
  }
}

module.exports = { Dashboard }
