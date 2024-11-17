#! /usr/bin/env node
const { ScrollHub } = require("./ScrollHub.js")
const os = require("os")

new ScrollHub(os.homedir()).startAll()
