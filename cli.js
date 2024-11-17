#! /usr/bin/env node

// NPM ecosystem includes
const parseArgs = require("minimist")
const path = require("path")
const fs = require("fs")
const child_process = require("child_process")

// Particles Includes
const { Disk } = require("scrollsdk/products/Disk.node.js")
const { Particle } = require("scrollsdk/products/Particle.js")
const { ScrollCli, ScrollFile, ScrollFileSystem, SimpleCLI } = require("scroll-cli")
const { ScrollHub } = require("./ScrollHub.js")
const packageJson = require("./package.json")

class ScrollHubCLI extends SimpleCLI {
  welcomeMessage = `\n🛜 WELCOME TO SCROLLHUB (v${packageJson.version})`

  startCommand(cwd) {
    new ScrollHub(cwd).startAll()
  }
}

if (module && !module.parent) new ScrollHubCLI().executeUsersInstructionsFromShell(parseArgs(process.argv.slice(2))._)

module.exports = { ScrollHubCLI }
