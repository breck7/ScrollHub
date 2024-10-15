const fs = require("fs")
const readline = require("readline")

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.dailyStats = {}
    this.folderStats = {}
    this.totalLines = 0
    this.parsedLines = 0
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

  updateDailyStats(entry) {
    if (entry) {
      const date = entry.timestamp.toISOString().split("T")[0]
      if (!this.dailyStats[date]) {
        this.dailyStats[date] = {
          reads: 0,
          writes: 0,
          uniqueReaders: new Set(),
          uniqueWriters: new Set(),
          folders: new Set()
        }
      }
      if (!this.folderStats[entry.folder]) {
        this.folderStats[entry.folder] = {
          reads: 0,
          writes: 0,
          uniqueReaders: new Set(),
          uniqueWriters: new Set()
        }
      }

      this.dailyStats[date].folders.add(entry.folder)

      if (entry.method === "GET") {
        this.dailyStats[date].reads++
        this.dailyStats[date].uniqueReaders.add(entry.ip)
        this.folderStats[entry.folder].reads++
        this.folderStats[entry.folder].uniqueReaders.add(entry.ip)
      } else if (entry.method === "POST") {
        this.dailyStats[date].writes++
        this.dailyStats[date].uniqueWriters.add(entry.ip)
        this.folderStats[entry.folder].writes++
        this.folderStats[entry.folder].uniqueWriters.add(entry.ip)
      }
    }
  }

  finalizeDailyStats() {
    Object.keys(this.dailyStats).forEach(date => {
      this.dailyStats[date].readers = this.dailyStats[date].uniqueReaders.size
      this.dailyStats[date].writers = this.dailyStats[date].uniqueWriters.size
      this.dailyStats[date].uniqueFolders = this.dailyStats[date].folders.size
      delete this.dailyStats[date].uniqueReaders
      delete this.dailyStats[date].uniqueWriters
    })

    Object.keys(this.folderStats).forEach(folder => {
      this.folderStats[folder].readers = this.folderStats[folder].uniqueReaders.size
      this.folderStats[folder].writers = this.folderStats[folder].uniqueWriters.size
      delete this.folderStats[folder].uniqueReaders
      delete this.folderStats[folder].uniqueWriters
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
    const csvHeader = "Date,Folder,Reads,Readers,Writes,Writers\n"
    const csvRows = Object.entries(this.dailyStats)
      .flatMap(([date, stats]) =>
        Array.from(stats.folders).map(folder => {
          const folderStats = this.folderStats[folder] || { reads: 0, readers: 0, writes: 0, writers: 0 }
          return `${date},${folder},${folderStats.reads},${folderStats.readers},${folderStats.writes},${folderStats.writers}`
        })
      )
      .join("\n")
    return csvHeader + csvRows
  }

  getDailyStats() {
    return this.dailyStats
  }

  getFolderStats() {
    return this.folderStats
  }
}

module.exports = { Dashboard }
