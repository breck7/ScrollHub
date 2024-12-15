const getBaseUrlForFolder = (folderName, hostname, protocol) => {
  if (hostname === "localhost") return "http://localhost/" + folderName

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName
}

const getCloneUrlForFolder = (folderName, hostname, protocol) => {
  if (hostname === "localhost") return "http://localhost/" + folderName + ".git"

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName + ".git"

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName + "/" + folderName + ".git"
}

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
  async getFusedFile() {
    const { bufferValue, ScrollFile } = this
    const filename = "/" + this.parent.fileName
    this.fakeFs[filename] = bufferValue
    const file = new ScrollFile(bufferValue, filename, this.fs)
    await file.fuse()
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
  async buildMainProgram(macrosOn = true) {
    const fusedFile = await this.getFusedFile()
    const fusedCode = fusedFile.fusedCode
    this._mainProgram = fusedFile.scrollProgram
    await this._mainProgram.load()
    return this._mainProgram
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

// todo: before unload warn about unsaved changes
class EditorApp {
  constructor() {
    this.folderName = ""
    this.previewIFrame = null
    this.initCodeMirror("custom")
    window.addEventListener("resize", () => this.codeMirrorInstance.setSize(this.width, 490))

    // Add file filter input handler
    this.fileFilter = document.getElementById("fileFilter")
    this.fileFilter.addEventListener("input", () => {
      this.updateFilteredFileList()
      this.updateUrlWithFilter()
    })
    this.fusionEditor = new FusionEditor(AppConstants.parsers, this)
  }

  getEditorMode(fileName) {
    const extension = fileName ? fileName.split(".").pop().toLowerCase() : ""
    const modeMap = {
      html: "htmlmixed",
      htm: "htmlmixed",
      js: "javascript",
      mjs: "javascript",
      json: "javascript",
      css: "css",
      py: "python",
      rb: "ruby",
      php: "php",
      perl: "perl",
      scroll: "custom",
      sh: "shell",
      parsers: "custom"
    }
    return modeMap[extension] || null
  }

  get parser() {
    return this.fusionEditor.customParser
  }

  initCodeMirror(mode) {
    const textarea = document.getElementById("fileEditor")

    if (this.codeMirrorInstance) this.codeMirrorInstance.toTextArea()

    if (mode === "custom") {
      // Use custom scroll parser mode with its autocomplete
      this.codeMirrorInstance = new ParsersCodeMirrorMode(mode, () => this.parser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(textarea, {
        lineWrapping: true,
        lineNumbers: false,
        mode
      })
    } else {
      // Use standard CodeMirror with appropriate mode and hint addons
      this.codeMirrorInstance = CodeMirror.fromTextArea(textarea, {
        lineWrapping: true,
        lineNumbers: false,
        mode
      })
    }

    this.codeMirrorInstance.setSize(this.width, 490)
  }

  rehighlight() {
    if (this._parser === this.parser) return
    console.log("rehighlighting needed")
    this._parser = this.parser

    // todo: figure this out
  }

  mode = "custom"
  updateEditorMode(fileName) {
    const mode = this.getEditorMode(fileName)
    if (mode === this.mode) return
    const currentContent = this.codeMirrorInstance.getValue()
    this.initCodeMirror(mode)
    this.codeMirrorInstance.setValue(currentContent)
    this.mode = mode
  }

  get bufferValue() {
    return this.codeMirrorInstance.getValue().replace(/\r/g, "")
  }

  get width() {
    const bodyWidth = document.body.clientWidth
    let computedWidth

    if (bodyWidth < 1000) {
      // Calculate width as body width minus 250
      computedWidth = bodyWidth - 270
    } else {
      // Set width to 784 when body width is 1000 or more
      computedWidth = 784
    }

    // Ensure the width does not exceed 784 and is not less than 100
    computedWidth = Math.max(100, Math.min(784, computedWidth))
    return computedWidth
  }

  showError(message) {
    console.error(message)
    this.fileListEl.innerHTML = `<span style="color:red;">${message}</span>`
  }

  get filePath() {
    return `${this.folderName}/${this.fileName}`
  }

  async main() {
    this.bindFileButtons()
    this.bindFileListListeners()
    this.bindFileDrop()
    this.bindKeyboardShortcuts()

    const urlParams = new URL(window.location).searchParams
    this.openFolder(urlParams.get("folderName") || window.location.hostname)
    let fileName = urlParams.get("fileName") || ""
    if (fileName.startsWith("/")) this.setFileNameInUrl(fileName.replace(/^\/+/, "")) // strip leading slashes

    // Set initial filter value from URL if present
    const filterValue = urlParams.get("filter") || ""
    this.fileFilter.value = filterValue

    if (!fileName) {
      let buffer = urlParams.get("buffer")
      if (buffer) {
        this.fetchAndDisplayFileList()
        buffer = buffer.replace(/TODAYS_DATE/g, new Date().toLocaleDateString("en-US"))
        this.setFileContent(decodeURIComponent(buffer))
      } else {
        await this.fetchAndDisplayFileList()
        this.autoOpen()
      }
    } else {
      this.fetchAndDisplayFileList()
      this.openFile(fileName)
    }

    return this
  }

  updateUrlWithFilter() {
    const url = new URL(window.location)
    const filterValue = this.fileFilter.value.trim()

    if (filterValue) {
      url.searchParams.set("filter", filterValue)
    } else {
      url.searchParams.delete("filter")
    }

    window.history.replaceState(null, "", url)
  }

  setFileNameInUrl(fileName) {
    const url = new URL(window.location)
    const urlParams = url.searchParams
    urlParams.set("fileName", fileName)
    window.history.replaceState(null, "", url)
  }

  autoOpen() {
    const { filenames } = this
    const lowerFilenames = new Set(filenames.map(f => f.toLowerCase()))
    const defaultFiles = ["index.scroll", "readme.scroll", "readme.md", "index.html", "package.json"]
    let file = filenames[0]
    for (let f of defaultFiles) {
      if (lowerFilenames.has(f)) {
        file = filenames.find(n => n.toLowerCase() === f)
        break
      }
    }
    this.openFile(file)
  }

  async openFolder(folderName) {
    this.folderName = folderName
    this.updateFooterLinks()
  }

  async openFile(fileName) {
    const { folderName } = this
    this.fileName = fileName
    const filePath = `${folderName}/${fileName}`
    const response = await fetch(`/readFile.htm?folderName=${folderName}&filePath=${encodeURIComponent(filePath)}`)
    const content = await response.text()

    // Update editor mode before setting content
    this.updateEditorMode(fileName)

    this.setFileContent(content)
    this.setFileNameInUrl(fileName)
    await this.refreshParser()
    this.updatePreviewIFrame()

    if (!this.files) await this.fetchAndDisplayFileList()
    else this.renderFileList()
  }

  bindFileDrop() {
    const dropZone = document.getElementById("editForm")
    dropZone.addEventListener("dragover", this.handleDragOver.bind(this))
    dropZone.addEventListener("dragleave", this.handleDragLeave.bind(this))
    dropZone.addEventListener("drop", this.handleDrop.bind(this))
  }

  get permalink() {
    const dir = this.rootUrl.replace(/\/$/, "") + "/"
    const { fileName } = this
    if (!fileName.endsWith(".scroll")) return dir + fileName
    const { outputFileNames } = this.fusionEditor.mainProgram
    const primaryOutputFile = outputFileNames.find(name => name.endsWith(".html")) || outputFileNames[0]
    if (!primaryOutputFile) return dir + fileName
    const path = fileName.split("/")
    if (path.length === 1) return dir + primaryOutputFile
    path.pop()
    return dir + path.join("/") + "/" + primaryOutputFile
  }

  showSpinner(message, style) {
    document.querySelector("#spinner").innerHTML = `<span${style}>${message}</span>`
    document.querySelector("#spinner").style.display = "block"
  }

  showError(message) {
    this.showSpinner(message, ` style="color:red;"`)
  }

  hideSpinner() {
    document.querySelector("#spinner").style.display = "none"
  }

  async saveFile() {
    if (!this.fileName) {
      const name = new URL(window.location).searchParams.get("bufferName") || "untitled"
      let fileName = prompt("Enter a filename", name)
      if (!fileName) return ""
      this.fileName = this.sanitizeFileName(fileName)
    }
    await this.writeFile("Publishing...", this.bufferValue, this.fileName)
    await this.refreshParser()
    this.updatePreviewIFrame()
  }

  async writeFile(spinnerText, content, fileName) {
    const { folderName } = this
    fileName = this.sanitizeFileName(fileName)
    const filePath = `${folderName}/${fileName}`
    this.showSpinner(spinnerText)
    const formData = new FormData()
    formData.append("filePath", filePath)
    formData.append("folderName", folderName)
    formData.append("content", content)
    try {
      const response = await fetch("/writeFile.htm", {
        method: "POST",
        body: formData
      })
      this.hideSpinner()
      await this.fetchAndDisplayFileList()
      if (this.fileName !== fileName) this.openFile(fileName)
      this.buildFolderCommand()
    } catch (error) {
      console.error("Error duplicating file:", error)
      this.showError(error.message)
    }
  }

  async buildFolderCommand() {
    const formData = new FormData()
    const { folderName } = this
    formData.append("folderName", folderName)
    const response = await fetch("/build.htm", {
      method: "POST",
      body: formData
    })
    if (!response.ok) {
      const error = await response.text()
      console.error(error)
      this.showError(error.message.split(".")[0])
    }

    console.log(`'${folderName}' built`)
  }

  async saveCommand() {
    await this.saveFile()
    await this.fetchAndDisplayFileList()
    await this.buildFolderCommand()
  }

  async refreshParser() {
    await this.fusionEditor.buildMainProgram()
    console.log("Parser refreshed")
    this.rehighlight()
  }

  bindKeyboardShortcuts() {
    const that = this

    const keyboardShortcuts = {
      "command+s": () => {
        that.saveCommand()
      },
      "ctrl+n": () => {
        that.createFileCommand()
      },
      "ctrl+p": async () => {
        that.refreshParser()
      }
    }

    // note: I do not rememeber why we do any of this stopCallback stuff but it seems hard won knowledge ;)
    Mousetrap._originalStopCallback = Mousetrap.prototype.stopCallback
    Mousetrap.prototype.stopCallback = async function (evt, element, shortcut) {
      if (shortcut === "command+s") {
        // save. refresh preview
        that.saveCommand()
        evt.preventDefault()
        return true
      } else if (keyboardShortcuts[shortcut]) {
        keyboardShortcuts[shortcut]()
        evt.preventDefault()
        return true
      }

      if (Mousetrap._pause) return true
      return Mousetrap._originalStopCallback.call(this, evt, element)
    }

    Object.keys(keyboardShortcuts).forEach(key => {
      Mousetrap.bind(key, function (evt) {
        keyboardShortcuts[key]()
        // todo: handle the below when we need to
        if (evt.preventDefault) evt.preventDefault()
        return false
      })
    })
  }

  handleDragOver(event) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.add("drag-over")
  }

  handleDragLeave(event) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove("drag-over")
  }

  async handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove("drag-over")
    const files = event.dataTransfer.files
    if (files.length) {
      this.showSpinner(`Uploading ${files.length} files...`)
      await this.uploadFiles(files)
      this.hideSpinner()
      return
    }
    const html = event.dataTransfer.getData("text/html")
    if (html) {
      // Create a temporary DOM element to parse the HTML
      const div = document.createElement("div")
      div.innerHTML = html

      // Find the image element
      const img = div.querySelector("img")
      if (img) {
        const url = img.src
        const filename = this.getFilenameFromUrl(url)
        await this.handleImageUrl(url, filename)
      }
    }
  }

  getFilenameFromUrl(url) {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      // Get the last segment of the path and decode it
      let filename = decodeURIComponent(pathname.split("/").pop())
      // If no extension, try to get it from the Content-Type
      if (!filename.includes(".")) {
        return null // Let the Content-Type determine it later
      }
      return filename
    } catch {
      return null
    }
  }

  async handleImageUrl(url, preferredFilename) {
    try {
      const response = await fetch(url)
      const contentType = response.headers.get("Content-Type")
      const blob = await response.blob()

      // If we don't have a filename or it doesn't have an extension,
      // create one from the Content-Type
      let filename = preferredFilename
      if (!filename) {
        const ext = contentType.split("/")[1]
        filename = `image.${ext}`
      }

      const file = new File([blob], filename, { type: contentType })
      await this.uploadFiles([file])
    } catch (error) {
      console.error("Error handling image URL:", error)
    }
  }

  // New method to handle multiple file uploads
  async uploadFiles(files) {
    const uploadPromises = Array.from(files).map(file => this.uploadFile(file))

    Promise.all(uploadPromises)
      .then(() => {
        console.log("All files uploaded successfully")
        this.fetchAndDisplayFileList()
        this.buildFolderCommand()
      })
      .catch(error => {
        console.error("Error uploading files:", error)
        // todo: show error to user
        alert("Error uploading files:" + error)
      })
  }

  // Modified uploadFile method to return a Promise
  async uploadFile(file) {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("folderName", this.folderName)

    try {
      const response = await fetch("/uploadFile.htm", {
        method: "POST",
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Network response was not ok")
      }

      const data = await response.text()
      console.log("File uploaded successfully:", data)
      return data
    } catch (error) {
      console.error("Error uploading file:", error.message)
      throw error // Re-throw the error if you want calling code to handle it
    }
  }

  get rootUrl() {
    return getBaseUrlForFolder(this.folderName, window.location.hostname, window.location.protocol)
  }

  updatePreviewIFrame() {
    const { rootUrl, folderName } = this
    this.previewIFrame = document.getElementById("previewIFrame")
    this.previewIFrame.src = this.permalink

    this.updateVisitLink()
    document.title = `Editing ${folderName}`
  }

  updateVisitLink() {
    const { permalink, fileName } = this
    const text = permalink.replace(/\/index.html$/, "")
    document.getElementById("folderNameLink").innerHTML = text
    document.getElementById("folderNameLink").href = permalink
  }

  get cloneUrl() {
    return getCloneUrlForFolder(this.folderName, window.location.hostname, window.location.protocol)
  }

  updateFooterLinks() {
    const { folderName } = this
    document.getElementById("gitClone").innerHTML =
      `<a class="folderActionLink" href="/globe.html?folderName=${folderName}">traffic</a> · <a class="folderActionLink" href="/diffs.htm/${folderName}?count=10">revisions</a> · <a class="folderActionLink" href="${folderName}.zip">download</a> · <a class="folderActionLink" href="#" onclick="window.app.duplicate()">duplicate</a> · <a href="#" class="folderActionLink" onclick="window.app.renameFolder()">move</a> · <a href="#" class="folderActionLink" onclick="window.app.deleteFolder()">delete</a><div class="cloneCommand">git clone ${this.cloneUrl}</div>`
    document.addEventListener("click", function (event) {
      // Check if clicked element has the class 'cloneCommand'
      if (event.target.classList.contains("cloneCommand")) {
        // Get the text content
        const text = event.target.innerText

        // Create a temporary textarea element
        const textarea = document.createElement("textarea")
        textarea.value = text
        document.body.appendChild(textarea)

        // Select and copy the text
        textarea.select()
        document.execCommand("copy")

        // Clean up by removing the textarea
        document.body.removeChild(textarea)

        // Optional: Add some feedback
        console.log("Text copied:", text)
      }
    })
  }

  async renameFolder() {
    const newFolderName = prompt(`Rename ${this.folderName} to:`)
    if (!newFolderName) return
    const response = await fetch("/mv.htm", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `oldFolderName=${this.folderName}&newFolderName=${newFolderName}`
    })

    const result = await response.text()
    window.location.href = `/edit.html?folderName=${newFolderName}`
  }

  async deleteFolder() {
    const userInput = prompt(`To delete this entire folder, please type the folder name: ${this.folderName}`)

    if (userInput !== this.folderName) return

    try {
      const response = await fetch("/trashFolder.htm", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `folderName=${encodeURIComponent(this.folderName)}`
      })

      const data = await response.text()
      console.log(data)
      window.location.href = "/" // Redirect to home page after deletion
    } catch (error) {
      console.error("Error:", error)
    }
  }

  async duplicate() {
    this.showSpinner("Copying folder...")
    const response = await fetch("/cloneFolder.htm", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `folderName=${this.folderName}&redirect=false`
    })

    const result = await response.text()
    this.hideSpinner()
    console.log(result)
    window.location.href = `/edit.html?folderName=${result}`
  }

  async fetchAndDisplayFileList() {
    const { folderName } = this
    try {
      const response = await fetch(`/ls.json?folderName=${folderName}`)
      if (!response.ok) throw new Error(await response.text())
      const allFiles = await response.json()

      const filtered = {}
      Object.keys(allFiles).forEach(key => {
        const value = allFiles[key]
        if (value.tracked || !key.startsWith(".")) filtered[key] = value
      })

      this.files = filtered
      this.renderFileList()
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error.message)
    }
  }

  get filenames() {
    return Object.keys(this.files)
  }

  renderFileList() {
    const { files, filenames, folderName } = this
    const currentFileName = this.fileName
    const filterValue = this.fileFilter.value.toLowerCase()

    // Filter files based on search input
    const filteredFiles = filenames.filter(file => file.toLowerCase().includes(filterValue))

    // Sort files: .scroll and .parsers first, then others
    const scrollFiles = filteredFiles.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
    const sorted = scrollFiles.concat(filteredFiles.filter(file => !file.endsWith(".scroll") && !file.endsWith(".parsers")))

    const fileLinks = sorted.map(file => {
      const stats = files[file]
      const selected = currentFileName === file ? "selectedFile" : ""
      const isScrollFile = file.endsWith(".scroll") || file.endsWith(".parsers")
      const isTrackedByGit = stats.versioned ? "" : " untracked"
      return `<a class="${isScrollFile ? "" : "nonScrollFile"} ${selected} ${isTrackedByGit}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}">${file}</a>`
    })

    this.fileListEl.innerHTML = fileLinks.join("<br>")
  }

  updateFilteredFileList() {
    this.renderFileList()
  }

  bindFileListListeners() {
    this.fileListEl.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey) return true
      const link = event.target.closest("a")
      if (!link) return true
      event.preventDefault()

      if (event.shiftKey) this.maybeRenameFilePrompt(link.textContent, event)
      else this.openFile(link.textContent)
    })
  }

  get fileListEl() {
    return document.getElementById("fileList")
  }

  maybeRenameFilePrompt(oldFileName, event) {
    const newFileName = prompt(`Enter new name for "${oldFileName}":`, oldFileName)
    if (newFileName && newFileName !== oldFileName) {
      this.performFileRename(oldFileName, this.sanitizeFileName(newFileName))
    }
  }

  async performFileRename(oldFileName, newFileName) {
    const { folderName } = this
    try {
      this.showSpinner("Renaming..")
      const response = await fetch("/renameFile.htm", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `folderName=${encodeURIComponent(folderName)}&oldFileName=${encodeURIComponent(oldFileName)}&newFileName=${encodeURIComponent(newFileName)}`
      })

      if (!response.ok) throw new Error(await response.text())

      this.hideSpinner()
      console.log(`File renamed from ${oldFileName} to ${newFileName}`)
      this.fetchAndDisplayFileList()
      this.buildFolderCommand()

      // If the renamed file was the current file, open the new file
      if (this.fileName === oldFileName) this.openFile(newFileName)
    } catch (error) {
      console.error(error)
      alert("Rename error:" + error)
    }
  }

  sanitizeFileName(fileName) {
    return fileName.includes(".") ? fileName : fileName + ".scroll"
  }

  async createFileCommand() {
    let fileName = prompt("Enter a filename", "untitled")
    if (!fileName) return ""
    await this.writeFile("Creating file...", "", fileName)
  }

  setFileContent(value) {
    document.getElementById("fileEditor").value = value.replace(/\r/g, "")
    this.codeMirrorInstance.setValue(value)
    const lines = value.split("\n")
    const lastLine = lines.pop()
    if (lines.length < 24) {
      // if its a small file, put user right in editing experience
      this.codeMirrorInstance.setCursor({ line: lines.length, ch: lastLine.length })
      this.codeMirrorInstance.focus()
    }
  }
  async duplicateFile() {
    const { fileName } = this
    // Generate default name for the duplicate file
    const extension = fileName.includes(".") ? "." + fileName.split(".").pop() : ""
    const baseName = fileName.replace(extension, "")
    const defaultNewName = `${baseName}-copy${extension}`

    const newFileName = prompt(`Enter name for the duplicate of "${fileName}":`, defaultNewName)
    if (!newFileName || newFileName === fileName) return
    await this.writeFile("Duplicating...", this.bufferValue, this.sanitizeFileName(newFileName))
  }

  bindFileButtons() {
    const that = this
    document.querySelector(".renameFileLink").addEventListener("click", async e => {
      const oldFileName = that.fileName
      const newFileName = prompt(`Enter new name for "${oldFileName}":`, oldFileName)
      if (newFileName && newFileName !== oldFileName) {
        this.performFileRename(oldFileName, this.sanitizeFileName(newFileName))
      }
    })

    document.querySelector(".duplicateFileLink").addEventListener("click", async evt => {
      evt.preventDefault()
      this.duplicateFile()
    })

    document.querySelector(".deleteFileLink").addEventListener("click", async e => {
      e.preventDefault()

      const { fileName, folderName } = this
      const userInput = prompt(`To delete this file, please type the file name: ${fileName}`)

      if (!userInput || userInput !== fileName) return
      this.showSpinner("Deleting...")
      const response = await fetch(`/deleteFile.htm?folderName=${folderName}&filePath=${encodeURIComponent(fileName)}`, {
        method: "POST"
      })

      const data = await response.text()
      await this.fetchAndDisplayFileList()
      this.autoOpen()
      this.hideSpinner()
    })
  }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new EditorApp()
  window.app.main()
})
