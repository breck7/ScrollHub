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

/*
interface EditorParent {
  bufferValue: string
  fileName: string
  rootUrl: string
}
*/
class ScrollFileEditor {
  constructor(defaultParserCode, parent) {
    this.parent = parent
    this.fakeFs = {}
    this.fs = new ScrollFileSystem(this.fakeFs)
    this.fs._setDefaultParser("", ["scroll"], [defaultParserCode])
    const urlWriter = new UrlWriter(this.fakeFs)
    urlWriter.getBaseUrl = () => parent.rootUrl || ""
    this.fs._storage = urlWriter
  }
  async scrollToHtml(scrollCode) {
    const parsed = await this.parseScroll(scrollCode)
    return parsed.asHtml
  }
  async parseScroll(scrollCode) {
    const { scrollFile } = this
    const page = new scrollFile(scrollCode)
    await page.fuse()
    return page.scrollProgram
  }
  get scrollFile() {
    return this.fs.defaultFileClass
  }
  get parser() {
    return this.fusedFile?.parser || this.fs.defaultParser.parser
  }
  _previousFileName
  async makeFusedFile(code, filename) {
    const { scrollFile, fs } = this
    this.fakeFs[filename] = code
    if (this._previousFileName) fs.clearParserCache(this._previousFileName)
    this._previousFileName = filename
    const file = new scrollFile(code, filename, fs)
    await file.fuse()
    return file
  }
  async getFusedFile() {
    const file = await this.makeFusedFile(this.bufferValue, "/" + this.parent.fileName)
    this.fusedFile = file
    return file
  }
  async getFusedCode() {
    const fusedFile = await this.getFusedFile()
    return fusedFile.fusedCode
  }
  get bufferValue() {
    return this.parent.bufferValue
  }
  get errors() {
    const { parser, bufferValue } = this
    const errs = new parser(bufferValue, this.parent.fileName).getAllErrors()
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

if (typeof module !== "undefined" && module.exports) module.exports = { ScrollFileEditor }
