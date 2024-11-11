const getBaseUrlForFolder = (folderName, hostname, protocol) => {
  if (hostname === "localhost") return "http://localhost/" + folderName

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName
}

// todo: before unload warn about unsaved changes
class EditorApp {
  constructor() {
    this.folderName = ""
    this.previewIFrame = null
    this.scrollParser = new HandParsersProgram(AppConstants.parsers).compileAndReturnRootParser()
    this.initCodeMirror("custom")
    window.addEventListener("resize", () => this.codeMirrorInstance.setSize(this.width, 490))
  }

  getEditorMode(fileName) {
    const extension = fileName ? fileName.split(".").pop().toLowerCase() : ""
    const modeMap = {
      html: "htmlmixed",
      htm: "htmlmixed",
      js: "javascript",
      css: "css",
      py: "python",
      rb: "ruby",
      php: "php",
      perl: "perl",
      scroll: "custom",
      parsers: "custom"
    }
    return modeMap[extension] || null
  }

  initCodeMirror(mode) {
    const textarea = document.getElementById("fileEditor")

    if (this.codeMirrorInstance) this.codeMirrorInstance.toTextArea()

    if (mode === "custom") {
      // Use custom scroll parser mode with its autocomplete
      this.codeMirrorInstance = new ParsersCodeMirrorMode(mode, () => this.scrollParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(textarea, {
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

  mode = "custom"
  updateEditorMode(fileName) {
    const mode = this.getEditorMode(fileName)
    if (mode === this.mode) return
    const currentContent = this.codeMirrorInstance.getValue()
    this.initCodeMirror(mode)
    this.codeMirrorInstance.setValue(currentContent)
    this.mode = mode
  }

  _scrollProgram
  get scrollProgram() {
    const { scrollParser } = this
    this._scrollProgram = new scrollParser(this.bufferValue)
    this._scrollProgram.setFile({ filename: this.fileName })
    return this._scrollProgram
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

  setFileNameInUrl(fileName) {
    const url = new URL(window.location)
    const urlParams = url.searchParams
    urlParams.set("fileName", fileName)
    window.history.replaceState(null, "", url)
  }

  autoOpen() {
    const { filenames } = this
    this.openFile(filenames.includes("index.scroll") ? "index.scroll" : filenames[0])
  }

  async openFolder(folderName) {
    this.folderName = folderName
    this.updateFooterLinks()
  }

  async openFile(fileName) {
    const { folderName } = this
    this.fileName = fileName
    const filePath = `${folderName}/${fileName}`
    const response = await fetch(`/read.htm?folderName=${folderName}&filePath=${encodeURIComponent(filePath)}`)
    const content = await response.text()

    // Update editor mode before setting content
    this.updateEditorMode(fileName)

    this.setFileContent(content)
    this.setFileNameInUrl(fileName)
    this.updatePreviewIFrame()
    this.updateVisitLink()

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
    return dir + (fileName.endsWith(".scroll") ? this.scrollProgram.permalink : fileName)
  }

  updateVisitLink() {
    document.getElementById("folderNameLink").innerHTML = this.permalink
    document.getElementById("folderNameLink").href = this.permalink
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
      let fileName = prompt("Enter a filename", "untitled")
      if (!fileName) return ""
      this.fileName = this.sanitizeFileName(fileName)
    }

    this.showSpinner("Publishing...")
    const formData = new FormData()
    const { filePath } = this
    formData.append("filePath", filePath)
    formData.append("folderName", this.folderName)
    const sentData = this.bufferValue
    formData.append("content", sentData)
    try {
      const response = await fetch("/write.htm", {
        method: "POST",
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Network response was not ok")
      }

      const newVersion = await response.text()
      console.log(`'${filePath}' saved`)
      this.hideSpinner()
      if (this.bufferValue === sentData && newVersion !== sentData) {
        // Todo: figure out how to restore cursor position.
        // this.codeMirrorInstance.setValue(newVersion)
      }
      this.updatePreviewIFrame()
    } catch (error) {
      this.showError(error.message.split(".")[0])
      console.error("Error saving file:", error.message)
      throw error // Re-throw the error if you want calling code to handle it
    }
  }

  async saveCommand() {
    await this.saveFile()
    await this.fetchAndDisplayFileList()
  }

  bindKeyboardShortcuts() {
    const that = this

    const keyboardShortcuts = {
      "command+s": () => {
        that.saveCommand()
      },
      "ctrl+n": () => {
        that.createFileCommand()
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

  handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove("drag-over")
    const files = event.dataTransfer.files
    if (files.length > 0) this.uploadFiles(files)
  }

  // New method to handle multiple file uploads
  uploadFiles(files) {
    this.showSpinner("Uploading...")
    const uploadPromises = Array.from(files).map(file => this.uploadFile(file))

    Promise.all(uploadPromises)
      .then(() => {
        console.log("All files uploaded successfully")
        this.fetchAndDisplayFileList()
        this.hideSpinner()
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
      const response = await fetch("/upload.htm", {
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

  updateFooterLinks() {
    const { folderName } = this
    document.getElementById("gitClone").innerHTML =
      `<a class="folderActionLink" href="/globe.html?folderName=${folderName}">live traffic</a> · <a class="folderActionLink" href="/diffs.htm/${folderName}?count=10">revisions</a> · <a class="folderActionLink" href="${folderName}.zip">download</a> · <a class="folderActionLink" href="#" onclick="window.app.duplicate()">duplicate</a> · <a href="#" class="folderActionLink" onclick="window.app.renameFolder()">rename</a> · <a href="#" class="folderActionLink" onclick="window.app.deleteFolder()">delete</a>`
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
      const response = await fetch("/trash.htm", {
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
    const response = await fetch("/clone.htm", {
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
      this.files = await response.json()
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
    const scrollFiles = filenames.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
    const sorted = scrollFiles.concat(filenames.filter(file => !file.endsWith(".scroll") && !file.endsWith(".parsers")))
    const fileLinks = sorted.map(file => {
      const stats = files[file]
      const selected = currentFileName === file ? "selectedFile" : ""
      const isScrollFile = file.endsWith(".scroll") || file.endsWith(".parsers")
      const isTrackedByGit = stats.versioned ? "" : " untracked"
      return `<a class="${isScrollFile ? "" : "nonScrollFile"} ${selected} ${isTrackedByGit}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}">${file}</a>`
    })
    this.fileListEl.innerHTML = fileLinks.join("<br>")
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
      const response = await fetch("/rename.htm", {
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

      // If the renamed file was the current file, open the new file
      if (this.fileName === oldFileName) this.openFile(newFileName)
    } catch (error) {
      console.error(error)
      alert("Rename error:" + error)
    }
  }

  sanitizeFileName(fileName) {
    fileName = fileName.replace(/[^a-zA-Z0-9\.\_\-]/g, "")

    return fileName.includes(".") ? fileName : fileName + ".scroll"
  }

  async createFileCommand() {
    let fileName = prompt("Enter a filename", "untitled")
    if (!fileName) return ""
    const newFileName = this.sanitizeFileName(fileName)
    const { folderName } = this
    const filePath = `${folderName}/${newFileName}`

    this.showSpinner("Creating file...")

    const response = await fetch("/write.htm", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `content=&folderName=${encodeURIComponent(folderName)}&filePath=${encodeURIComponent(filePath)}`
    })

    await response.text()
    delete this.files
    await this.openFile(newFileName)
    this.hideSpinner()
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

  bindFileButtons() {
    const that = this
    document.querySelector(".renameLink").addEventListener("click", async e => {
      const oldFileName = that.fileName
      const newFileName = prompt(`Enter new name for "${oldFileName}":`, oldFileName)
      if (newFileName && newFileName !== oldFileName) {
        this.performFileRename(oldFileName, this.sanitizeFileName(newFileName))
      }
    })

    document.querySelector(".deleteLink").addEventListener("click", async e => {
      e.preventDefault()

      const { fileName, folderName } = this
      const userInput = prompt(`To delete this file, please type the file name: ${fileName}`)

      if (!userInput || userInput !== fileName) return

      const filePath = `${folderName}/${fileName}`

      this.showSpinner("Deleting...")

      const response = await fetch(`/delete.htm?filePath=${encodeURIComponent(filePath)}`, {
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
