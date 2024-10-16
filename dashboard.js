const fs = require("fs")
const readline = require("readline")

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.stats = {} // Combined daily and folder stats
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
