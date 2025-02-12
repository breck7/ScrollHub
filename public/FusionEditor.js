class UrlWriter extends MemoryWriter {
  async read(fileName) {
    if (this.inMemoryFiles[fileName]) return this.inMemoryFiles[fileName]
    if (!isUrl(fileName)) fileName = this.getBaseUrl() + fileName
    return await super.read(fileName)
  }
  async exists(fileName) {
    if (this.inMemoryFiles[fileName]) return true
    if (!isUrl(fileName)) fileName = this.getBaseUrl() + fileName
    return await super.exists(fileName)
  }
}

class FusionEditor {
  // parent needs a getter "bufferValue" and "rootUrl" and "fileName"
  constructor(defaultParserCode, parent) {
    this.parent = parent
    const parser = new HandParsersProgram(defaultParserCode).compileAndReturnRootParser()
    this.customParser = parser
    // todo: cleanup
    class ScrollFile extends FusionFile {
      EXTERNALS_PATH = ""
      defaultParserCode = defaultParserCode
      defaultParser = parser
    }
    this.ScrollFile = ScrollFile
    this.fakeFs = {}
    this.fs = new Fusion(this.fakeFs)
    const urlWriter = new UrlWriter(this.fakeFs)
    urlWriter.getBaseUrl = () => parent.rootUrl || ""
    this.fs._storage = urlWriter
  }
  async scrollToHtml(scrollCode) {
    const parsed = await this.parseScroll(scrollCode)
    return parsed.asHtml
  }
  async parseScroll(scrollCode) {
    const { ScrollFile } = this
    const page = new ScrollFile(scrollCode)
    await page.fuse()
    return page.scrollProgram
  }
  async makeFusedFile(code, filename) {
    const { ScrollFile, fs } = this
    this.fakeFs[filename] = code
    delete fs._parsersExpandersCache[filename] // todo: cleanup
    const file = new ScrollFile(code, filename, fs)
    await file.fuse()
    return file
  }
  async getFusedFile() {
    const file = await this.makeFusedFile(this.bufferValue, "/" + this.parent.fileName)
    this.fusedFile = file
    this.customParser = file.parser
    return file
  }
  async getFusedCode() {
    const fusedFile = await this.getFusedFile()
    return fusedFile.fusedCode
  }
  get bufferValue() {
    return this.parent.bufferValue
  }
  get parser() {
    return this.customParser
  }
  get errors() {
    const { parser, bufferValue } = this
    const errs = new parser(bufferValue).getAllErrors()
    return new Particle(errs.map(err => err.toObject())).toFormattedTable(200)
  }
  async buildMainProgram() {
    const fusedFile = await this.getFusedFile()
    const fusedCode = fusedFile.fusedCode
    this._mainProgram = fusedFile.scrollProgram
    try {
      await this._mainProgram.load()
    } catch (err) {
      console.error(err)
    }
    return this._mainProgram
  }
  async getFormatted() {
    const mainDoc = await this.buildMainProgram(false)
    return mainDoc.formatted
  }
  get mainProgram() {
    if (!this._mainProgram) this.buildMainProgram()
    return this._mainProgram
  }
  get mainOutput() {
    const { mainProgram } = this
    const particle = mainProgram.filter(particle => particle.buildOutput)[0]
    if (!particle)
      return {
        type: "html",
        content: mainProgram.buildHtml()
      }
    return {
      type: particle.extension.toLowerCase(),
      content: particle.buildOutput()
    }
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = { FusionEditor }
