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

testParticles.create = areEqual => {
  // Arrange
  const hub = new ScrollHub()

  const testCases = {
    "http://pldb.io pldb7": {
      errorMessage: undefined,
      folderName: "pldb7",
      template: "http://pldb.io"
    },
    foobar: {
      errorMessage: undefined,
      folderName: "foobar",
      template: "blank_template"
    },
    "http://pldb.io": {
      errorMessage: undefined,
      folderName: "pldb.io",
      template: "http://pldb.io"
    },
    "gallery_template my copy": {
      errorMessage: undefined,
      folderName: "mycopy",
      template: "gallery_template",
      folderCache: { gallery_template: true }
    },
    "missing my copy": {
      errorMessage: undefined,
      folderName: "missingmycopy",
      template: "blank_template"
    }
  }

  // Act/ Assert
  Object.keys(testCases).forEach(key => {
    const theCase = testCases[key]
    const result = hub.makeFolderNameAndTemplateFromInput(key, theCase.folderCache || {})
    const keys = "folderName template errorMessage".split(" ")
    keys.forEach(testKey => areEqual(result[testKey], theCase[testKey], `${testKey} did not match`))
  })
}

testParticles.writeFlow = async areEqual => {
  // Arrange
  const testCases = {
    "foo.scroll": {
      error: undefined,
      content: ``,
      expected: ``
    },
    "foo2.scroll": {
      error: undefined,
      content: `\r\r`,
      expected: ``
    },
    "foo.css": {
      error: undefined,
      content: `   body { color: red; }`,
      expected: `body {\n color: red;\n}\n`
    },
    "foo.docx": {
      error: true,
      content: ``,
      expected: ``
    }
  }
  const hub = new ScrollHub()
  // todo:
  // // Act/ Assert
  // Object.keys(testCases).forEach(filename => {
  //   const theCase = testCases[key]
  //   const result = hub.writeAndCommitTextFile(filename, theCase.content)
  //   const keys = "content error".split(" ")
  //   keys.forEach(testKey => areEqual(result[testKey], theCase[testKey], `${testKey} did not match`))
  // })
}

if (module && !module.parent) TestRacer.testSingleFile(__filename, testParticles)

module.exports = { testParticles }
