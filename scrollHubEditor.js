// todo: before unload warn about unsaved changes
class EditorApp {
  constructor() {
    this.folderName = ""
    this.previewIFrame = null
    this.scrollParser = new HandParsersProgram(AppConstants.parsers).compileAndReturnRootParser()
    this.codeMirrorInstance = new ParsersCodeMirrorMode("custom", () => this.scrollParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("fileEditor"), {
      lineWrapping: true, // todo: some way to see wrapped lines? do we want to disable line wrapping? make a keyboard shortcut?
      lineNumbers: false
    })
    this.codeMirrorInstance.setSize(this.width, 490)
    window.addEventListener("resize", () => this.codeMirrorInstance.setSize(this.width, 490))
  }

  _scrollProgram
  get scrollProgram() {
    const { scrollParser } = this
    this._scrollProgram = new scrollParser(this.codeMirrorInstance.getValue())
    this._scrollProgram.setFile({ filename: this.fileName })
    return this._scrollProgram
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
    this.bindDeleteButton()
    this.bindFileDrop()
    this.bindKeyboardShortcuts()

    const urlParams = new URLSearchParams(window.location.search)
    this.openFolder(urlParams.get("folderName") || window.location.hostname)
    const fileName = urlParams.get("fileName") || ""
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

  autoOpen() {
    const { scrollFiles } = this
    this.openFile(scrollFiles.includes("index.scroll") ? "index.scroll" : scrollFiles[0])
  }

  async openFolder(folderName) {
    this.folderName = folderName
    this.updateFooterLinks()
  }

  async openFile(fileName) {
    this.fileName = fileName
    const filePath = `${this.folderName}/${fileName}`
    const response = await fetch(`/read.htm${this.auth}filePath=${encodeURIComponent(filePath)}`)
    const content = await response.text()
    this.setFileContent(content)
    this.updatePreviewIFrame()
    this.updateVisitLink()

    if (!this.scrollFiles) await this.fetchAndDisplayFileList()
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
    formData.append("content", this.codeMirrorInstance.getValue())
    try {
      const response = await fetch("/write.htm", {
        method: "POST",
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Network response was not ok")
      }

      const data = await response.text()
      console.log(`'${filePath}' saved`)
      this.hideSpinner()
      this.updatePreviewIFrame()
      return data
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

  get isCustomDomain() {
    const serverName = window.location.hostname
    if (serverName === "localhost") return false
    return this.folderName.includes(".")
  }

  get rootUrl() {
    const protocol = window.location.protocol
    if (!this.isCustomDomain) return protocol + "//" + window.location.hostname + "/" + this.folderName
    return protocol + "//" + this.folderName
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
      `<a class="folderActionLink" href="/globe.html?folderName=${folderName}">live traffic</a> · <a class="folderActionLink" href="/diff.htm/${folderName}">history</a> · <a class="folderActionLink" href="#" onclick="window.app.duplicate()">duplicate</a> · <a href="#" class="folderActionLink" onclick="window.app.renameFolder()">rename</a> · <a href="#" class="folderActionLink" onclick="window.app.deleteFolder()">delete</a>`
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
    try {
      const response = await fetch(`/ls.htm${this.auth}`)
      if (!response.ok) throw new Error(await response.text())
      const data = await response.text()
      const files = data.split("\n")
      this.files = files
      this.scrollFiles = files.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
      this.renderFileList()
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error.message)
    }
  }

  renderFileList() {
    const { files, scrollFiles, folderName } = this
    const currentFileName = this.fileName
    const sorted = scrollFiles.concat(files.filter(file => !file.endsWith(".scroll") && !file.endsWith(".parsers")))
    const fileLinks = sorted.map(file => {
      const selected = currentFileName === file ? "selectedFile" : ""
      return file.endsWith(".scroll") || file.endsWith(".parsers")
        ? `<a class="${selected}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}" oncontextmenu="app.maybeRenameFilePrompt('${file}', event)">${file}</a>`
        : `<a class="nonScrollFile ${selected}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}" oncontextmenu="app.maybeRenameFilePrompt('${file}', event)">${file}</a>`
    })
    this.fileListEl.innerHTML = fileLinks.join("<br>")
  }

  get fileListEl() {
    return document.getElementById("fileList")
  }

  maybeRenameFilePrompt(oldFileName, event) {
    if (!event.ctrlKey) return true

    event.preventDefault()
    const newFileName = prompt(`Enter new name for "${oldFileName}":`, oldFileName)
    if (newFileName && newFileName !== oldFileName) {
      this.performFileRename(oldFileName, this.sanitizeFileName(newFileName))
    }
  }

  async performFileRename(oldFileName, newFileName) {
    try {
      const response = await fetch("/rename.htm", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `folderName=${encodeURIComponent(this.folderName)}&oldFileName=${encodeURIComponent(oldFileName)}&newFileName=${encodeURIComponent(newFileName)}`
      })

      if (!response.ok) throw new Error(await response.text())

      console.log(`File renamed from ${oldFileName} to ${newFileName}`)
      this.fetchAndDisplayFileList()

      // If the renamed file was the current file, update the fileName
      if (this.fileName === oldFileName) this.fileName = newFileName
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
    window.location = `/edit.html?folderName=${folderName}&fileName=${newFileName}`
  }

  setFileContent(value) {
    document.getElementById("fileEditor").value = value
    this.codeMirrorInstance.setValue(value)
    const lines = value.split("\n")
    const lastLine = lines.pop()
    if (lines.length < 30) {
      // if its a small file, put user right in editing experience
      this.codeMirrorInstance.setCursor({ line: lines.length, ch: lastLine.length })
      this.codeMirrorInstance.focus()
    }
  }

  get auth() {
    return `?folderName=${this.folderName}&`
  }

  bindDeleteButton() {
    const deleteLink = document.querySelector(".deleteLink")
    deleteLink.addEventListener("click", async e => {
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
      window.location.href = `/edit.html?folderName=${folderName}` // Redirect back to folder
    })
  }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new EditorApp()
  window.app.main()
})
