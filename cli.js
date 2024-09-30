#! /usr/bin/env node

const path = require("path")
const { Utils } = require("scrollsdk/products/Utils.js")
const { ScrollSetCLI } = require("scroll-cli/ScrollSetCLI.js")
const { makeCerts } = require("./makeCerts.js")

class ScrollHubCli extends ScrollSetCLI {
  async certCommand(domain) {
    const certs = await makeCerts("breck7@gmail.com", domain)

    const { certificate, domainKey } = certs

    fs.writeFileSync(`${domain}.crt`, certificate)
    fs.writeFileSync(`${domain}.key`, domainKey)
  }
}

module.exports = { ScrollHubCli }

if (!module.parent) Utils.runCommand(new ScrollHubCli(), process.argv[2], process.argv[3])
