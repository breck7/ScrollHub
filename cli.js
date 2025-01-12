#! /usr/bin/env node

// NPM ecosystem includes
const parseArgs = require("minimist")
const path = require("path")
const fs = require("fs")
const child_process = require("child_process")

// Particles Includes
const { Disk } = require("scrollsdk/products/Disk.node.js")
const { Particle } = require("scrollsdk/products/Particle.js")
const { SimpleCLI } = require("scroll-cli")
const { ScrollHub } = require("./ScrollHub.js")
const packageJson = require("./package.json")

class ScrollHubCLI extends SimpleCLI {
  welcomeMessage = `\n🛜 WELCOME TO SCROLLHUB (v${packageJson.version})`

  startCommand(cwd) {
    new ScrollHub(cwd).startAll()
  }

  getRunningScrollHubs() {
    try {
      // Get detailed process info including CPU and memory
      const command = "ps aux | grep '[S]crollHubProcess' | awk '{printf \"%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s %s %s\\n\", $2, $3, $4, $5, $6, $9, $11, $12, $13}'"
      const output = child_process.execSync(command, { encoding: "utf-8" }).trim()

      if (!output) return []

      return output.split("\n").map(line => {
        const [pid, cpu, mem, vsz, rss, startTime, command] = line.split("\t")
        // Get listening ports for this process
        const portsCommand = `lsof -Pan -p ${pid} -i | grep LISTEN | awk '{print $9}' | cut -d: -f2`
        let ports = []
        try {
          ports = child_process.execSync(portsCommand, { encoding: "utf-8" }).trim().split("\n").filter(Boolean)
        } catch (e) {
          // Process might be gone or no permissions
        }

        return {
          pid,
          cpu: `${parseFloat(cpu).toFixed(1)}%`,
          mem: `${parseFloat(mem).toFixed(1)}%`,
          vsz: `${Math.round(vsz / 1024)}MB`, // Convert to MB
          rss: `${Math.round(rss / 1024)}MB`, // Convert to MB
          startTime,
          ports,
          command
        }
      })
    } catch (error) {
      console.error("Error getting ScrollHub processes:", error.message)
      return []
    }
  }

  listCommand(cwd) {
    const processes = this.getRunningScrollHubs()

    if (!processes.length) {
      console.log("No ScrollHub processes currently running")
      return
    }

    console.log("\nRunning ScrollHub Processes:")
    console.log("PID\tCPU\tMEM\tRSS\tSTARTED\tPORTS\t\tCOMMAND")
    console.log("-".repeat(80))

    processes.forEach(proc => {
      const ports = proc.ports.length ? proc.ports.join(", ") : "none"
      console.log(`${proc.pid}\t` + `${proc.cpu}\t` + `${proc.mem}\t` + `${proc.rss}\t` + `${proc.startTime}\t` + `${ports}\t\t` + `${proc.command}`)
    })
  }

  killCommand(cwd) {
    const processes = this.getRunningScrollHubs()

    if (!processes.length) {
      console.log("No ScrollHub process found")
      return
    }

    processes.forEach(proc => {
      try {
        child_process.execSync(`kill -9 ${proc.pid}`)
        console.log(`Successfully killed ScrollHub process (PID: ${proc.pid})`)
      } catch (error) {
        console.error(`Error killing process ${proc.pid}:`, error.message)
      }
    })
  }
}

if (module && !module.parent) new ScrollHubCLI().executeUsersInstructionsFromShell(parseArgs(process.argv.slice(2))._)

module.exports = { ScrollHubCLI }
