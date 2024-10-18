#! /usr/bin/env node

const tap = require("tap")
const fs = require("fs")
const path = require("path")
const { TestRacer } = require("scrollsdk/products/TestRacer.js")
const { ScrollHub } = require("./ScrollHub.js")

const testParticles = {}

testParticles.basics = areEqual => {
  // Arrange
  const hub = new ScrollHub()
  // Act/Assert
  areEqual(!!hub, true)
}

if (module && !module.parent) TestRacer.testSingleFile(__filename, testParticles)

module.exports = { testParticles }
