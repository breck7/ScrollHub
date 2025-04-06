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
    this.fs.setDefaultParserFromString(defaultParserCode)
    const urlWriter = new UrlWriter(this.fakeFs)
    urlWriter.getBaseUrl = () => parent.rootUrl || ""
    this.fs._storage = urlWriter
  }
  async scrollToHtml(scrollCode) {
    const parsed = await this.parseScroll(scrollCode)
    return parsed.asHtml
  }
  async parseScroll(scrollCode) {
    const file = this.fs.newFile(scrollCode)
    await file.singlePassFuse()
    return file.scrollProgram
  }
  get parser() {
    return this.fusedFile?.scrollProgram.constructor || this.fs.defaultParser
  }
  async makeFusedFile(code, filename) {
    const { fs } = this
    this.fakeFs[filename] = code
    const file = this.fs.newFile(code, filename)
    await file.singlePassFuse()
    return file
  }
  async getFusedFile() {
    const file = await this.makeFusedFile(this.bufferValue, "/" + this.parent.fileName)
    this.fusedFile = file
    return file
  }
  async getFusedCode() {
    const fusedFile = await this.getFusedFile()
    return fusedFile.scrollProgram.toString()
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
    const fusedCode = await this.getFusedCode()
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
