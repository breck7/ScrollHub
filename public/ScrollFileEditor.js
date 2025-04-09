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
  async init() {
    await this.buildMainProgram()
  }
  async scrollToHtml(scrollCode) {
    const parsed = await this._parseScroll(scrollCode)
    return parsed.asHtml
  }
  async _parseScroll(scrollCode) {
    const file = this.fs.newFile(scrollCode)
    await file.singlePassFuse()
    return file.scrollProgram
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
    const errs = this.mainProgram.getAllErrors()
    return new Particle(errs.map(err => err.toObject())).toFormattedTable(200)
  }
  async buildMainProgram() {
    const fusedFile = await this.getFusedFile()
    const fusedCode = await this.getFusedCode()
    this.mainProgram = fusedFile.scrollProgram
    try {
      await this.mainProgram.load()
    } catch (err) {
      console.error(err)
    }
    return this.mainProgram
  }
  async getFormatted() {
    const mainDoc = await this.buildMainProgram(false)
    return mainDoc.formatted
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
  _cachedCode
  _cachedProgram
  getParsedProgramForCodeMirror(code) {
    // Note: this uses the latest loaded constructor and does a SYNC parse.
    // This allows us to use and loaded parsers, but gives sync, real time best
    // answers for highlighting and autocomplete.
    // It reparses the whole document. Actually seems to be fine for now.
    // Ideally we could also just run off mainProgram and not reparse, but
    // it gets tricky with the CodeMirror lib and async stuff. Maybe in the
    // future we can clean this up.
    if (code === this._cachedCode) return this._cachedProgram

    this._cachedCode = code
    this._cachedProgram = new this.mainProgram.latestConstructor(code)
    return this._cachedProgram
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { ScrollFileEditor }
