const fs = require("fs")

class Dashboard {
  constructor(inputFile) {
    this.inputFile = inputFile
    this.logEntries = []
    this.dailyStats = {}
  }

  parseLogEntry(entry) {
    const regex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) ([\d.:]+) "(GET|POST) ([^"]+)" "([^"]+)"/
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
          this.dailyStats[date] = { totalRequests: 0, uniqueIPs: new Set() }
        }
        this.dailyStats[date].totalRequests++
        this.dailyStats[date].uniqueIPs.add(entry.ip)
      }
    })

    Object.keys(this.dailyStats).forEach(date => {
      this.dailyStats[date].uniqueIPCount = this.dailyStats[date].uniqueIPs.size
      delete this.dailyStats[date].uniqueIPs
    })
  }

  processLogFile() {
    const logContent = fs.readFileSync(this.inputFile, "utf-8")
    this.logEntries = logContent.split("\n").map(this.parseLogEntry).filter(Boolean)
    this.generateDailyStatistics()
  }

  generateCSV(outputFile) {
    const csvHeader = "Date,Total Requests,Unique IP Count\n"
    const csvRows = Object.entries(this.dailyStats)
      .map(([date, stats]) => `${date},${stats.totalRequests},${stats.uniqueIPCount}`)
      .join("\n")
    const csvContent = csvHeader + csvRows
    fs.writeFileSync(outputFile, csvContent)
    console.log(`CSV file with daily statistics has been generated: ${outputFile}`)
  }

  getDailyStats() {
    return this.dailyStats
  }
}

module.exports = { Dashboard }
