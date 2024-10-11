const fs = require("fs").promises

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.logEntries = []
    this.dailyStats = {}
  }

  parseLogEntry(entry) {
    const regex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) ([\d.:]+) "(\w+) ([^"]+)" "([^"]+)"/
    const match = entry.match(regex)
    if (match) {
      return {
        timestamp: new Date(match[1]),
        ip: match[2],
        method: match[3],
        path: match[4],
        userAgent: match[5]
      }
    }
    return null
  }

  generateDailyStatistics() {
    this.dailyStats = {}
    this.logEntries.forEach(entry => {
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

        if (entry.method.toUpperCase() === "GET") {
          this.dailyStats[date].reads++
          this.dailyStats[date].uniqueReaders.add(entry.ip)
        } else if (entry.method.toUpperCase() === "POST") {
          this.dailyStats[date].writes++
          this.dailyStats[date].uniqueWriters.add(entry.ip)
        }
      }
    })

    // Convert Sets to counts
    Object.keys(this.dailyStats).forEach(date => {
      this.dailyStats[date].readers = this.dailyStats[date].uniqueReaders.size
      this.dailyStats[date].writers = this.dailyStats[date].uniqueWriters.size
      delete this.dailyStats[date].uniqueReaders
      delete this.dailyStats[date].uniqueWriters
    })
  }

  async processLogFile() {
    try {
      const logContent = await fs.readFile(this.inputFile, "utf-8")
      this.logEntries = logContent.split("\n").map(this.parseLogEntry).filter(Boolean)
      this.generateDailyStatistics()
    } catch (error) {
      console.error("Error processing log file:", error)
      throw error
    }
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
