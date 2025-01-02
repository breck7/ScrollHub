const getBaseUrlForFolder = (folderName, hostname, protocol) => {
  if (hostname === "localhost" || hostname.startsWith("localhost:")) return `http://${hostname}/${folderName}`

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName
}

const getCloneUrlForFolder = (folderName, hostname, protocol) => {
  if (hostname === "localhost" || hostname.startsWith("localhost:")) return `http://${hostname}/${folderName}.git`

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName + ".git"

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName + "/" + folderName + ".git"
}

// todo: before unload warn about unsaved changes
class EditorApp {
  constructor() {
    this.folderName = ""
    this.previewIFrame = null
    this.initCodeMirror("custom")
    window.addEventListener("resize", () => this.updateEditorDimensions())

    // Add file filter input handler
    this.fileFilter = document.getElementById("fileFilter")
    this.fileFilter.addEventListener("input", () => {
      this.updateFilteredFileList()
      this.updateUrlWithFilter()
    })
    this.fusionEditor = new FusionEditor(AppConstants.parsers, this)
  }

  get editorHeight() {
    return Math.max(300, window.innerHeight - 200)
  }

  updateEditorDimensions() {
    const { editorHeight } = this
    this.codeMirrorInstance.setSize(this.width, editorHeight)
    const fileList = document.getElementById("fileList")
    fileList.style.height = `${editorHeight - 138}px`
    if (this.isFocusMode) {
      console.log("Entering focus mode")
      document.querySelector(".buttonRow").style.display = "none"
      document.querySelector(".editorHolder").classList.add("focusMode")
      const width = Math.min(800, document.body.clientWidth)
      this.codeMirrorInstance.setSize(width, window.innerHeight)
    }
  }

  exitFocusModeCommand() {
    this.isFocusMode = false
    document.querySelector(".buttonRow").style.display = "block"
    document.querySelector(".editorHolder").classList.remove("focusMode")
    this.updateEditorDimensions()
    this.enableAutocomplete()
  }

  toggleFocusModeCommand() {
    if (this.isFocusMode) this.exitFocusModeCommand()
    else this.enterFocusModeCommand()
  }

  enterFocusModeCommand() {
    this.isFocusMode = true
    // Request browser full screen
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen()
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen()
    }
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) this.exitFocusModeCommand()
    })
    this.disableAutocomplete()
    this.updateEditorDimensions()
    if (!this.codeMirrorInstance.hasFocus()) this.focusOnEnd()
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

    this.codeMirrorInstance.on("keyup", () => this._onCodeKeyUp())

    this.updateEditorDimensions()
  }

  _onCodeKeyUp() {
    const code = this.codeMirrorInstance.getValue()
    if (this._code === code) return
    this._code = code
    // no-op at the moment
    // todo: save to local storage? autosave? other?
  }

  rehighlight() {
    if (this._parser === this.parser) return
    console.log("rehighlighting needed")
    this._parser = this.parser

    // todo: figure this out
  }

  mode = "custom"
  autocomplete = true
  currentParser = null
  updateEditorMode(fileName) {
    const mode = this.getEditorMode(fileName)
    const modeChanged = mode !== this.mode
    if (!this.autocomplete) this.disableAutocomplete()
    else this.enableAutocomplete()
    if (!modeChanged && mode !== "custom") return
    if (!modeChanged && mode === "custom" && this.currentParser === this.parser) return
    console.log("Setting editor mode: " + mode)
    this.currentParser = this.parser
    const currentContent = this.codeMirrorInstance.getValue()
    this.initCodeMirror(mode)
    this.codeMirrorInstance.setValue(currentContent)
    this.mode = mode
  }

  toggleAutocompleteCommand() {
    this.autocomplete = !this.autocomplete
    if (this.autocomplete) this.enableAutocomplete()
    else this.disableAutocomplete()
  }

  disableAutocomplete() {
    this.autocomplete = false
    this.codeMirrorInstance.setOption("showHint", false)
    if (!this._hintOptions) this._hintOptions = this.codeMirrorInstance.getOption("hintOptions")
    this.codeMirrorInstance.setOption("hintOptions", { completeSingle: false })
  }

  enableAutocomplete() {
    if (this.autocomplete) return
    this.autocomplete = true
    this.codeMirrorInstance.setOption("showHint", true)
    this.codeMirrorInstance.setOption("hintOptions", this._hintOptions)
  }

  get bufferValue() {
    return this.codeMirrorInstance.getValue().replace(/\r/g, "")
  }

  get width() {
    const bodyWidth = document.body.clientWidth
    const maxWidth = 784
    let computedWidth = bodyWidth - 270
    return Math.max(100, Math.min(maxWidth, computedWidth))
  }

  showError(message) {
    console.error(message)
    this.fileListEl.innerHTML = `<span style="color:red;">${message}</span>`
  }

  get filePath() {
    return `${this.folderName}/${this.fileName}`
  }

  async main() {
    this.initTheme()
    this.bindFileButtons()
    this.bindFileListListeners()
    this.bindFileDrop()
    this.bindKeyboardShortcuts()

    const urlParams = new URL(window.location).searchParams
    this.openFolder(urlParams.get("folderName") || window.location.hostname)
    let fileName = urlParams.get("fileName") || ""
    if (fileName.startsWith("/")) {
      fileName = fileName.replace(/^\/+/, "")
      this.setFileNameInUrl(fileName) // strip leading slashes
    }

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
        await this.autoOpen()
        if (urlParams.get("command") === "showWelcomeMessageCommand") this.showWelcomeMessageCommand()
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

  async autoOpen() {
    const { filenames } = this
    const lowerFilenames = new Set(filenames.map(f => f.toLowerCase()))
    const defaultFiles = ["index.scroll", "readme.scroll", "index.html", "readme.md", "package.json"]
    let file = filenames[0]
    for (let f of defaultFiles) {
      if (lowerFilenames.has(f)) {
        file = filenames.find(n => n.toLowerCase() === f)
        break
      }
    }
    await this.openFile(file)
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

    this.setFileContent(content)
    this.setFileNameInUrl(fileName)
    await this.refreshParserCommand()
    this.updateEditorMode(fileName)
    this.updatePreviewIFrame()

    if (!this.files) await this.fetchAndDisplayFileList()
    else this.renderFileList()

    if (this.isModalOpen && this._openModal === "metrics") this.openMetricsCommand()
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
    await this.refreshParserCommand()
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
    const message = await response.text()
    if (!response.ok) {
      console.error(message)
      this.showError(message.message.split(".")[0])
    } else if (message.includes("SyntaxError")) {
      this.showError("There may have been an error building your site. Please check console logs.")
      console.error(message)
    }

    console.log(`'${folderName}' built`)
  }

  async saveAndPublishCommand() {
    await this.saveFile()
    await this.fetchAndDisplayFileList()
    await this.buildFolderCommand()
  }

  async refreshParserCommand() {
    await this.fusionEditor.buildMainProgram()
    console.log("Parser refreshed")
    this.rehighlight()
  }

  toggleHelpCommand(event) {
    if (this._openModal === "help") this.closeHelpModalCommand()
    else this.openHelpModalCommand(event)
  }

  closeHelpModalCommand() {
    this.closeModal()
  }

  _modalContent
  openModal(content, modalName, event) {
    this._openModal = modalName
    if (!this._modalContent) this._modalContent = document.querySelector("#theModal").innerHTML
    document.querySelector("#theModal").innerHTML = this._modalContent + content
    openModal("theModal", event)
  }

  get isModalOpen() {
    return document.querySelector("#theModal").style.display === "block"
  }

  closeModal() {
    if (this.isModalOpen) closeModal(document.querySelector("#theModal"))
    delete this._openModal
  }

  get metrics() {
    // Calculate document metrics
    const content = this.bufferValue
    const words = (content.match(/\S+/g) || []).filter(word => !/[.]\w+[(]|[[\]{}()]|[.]\w+$|[@]|[;\|\#\`,=+\-*/%]/.test(word))
    const chars = content.length
    const sentences = content.split(/[.!?]+\s+/).filter(s => s.trim().length > 0)
    const readingTimeMinutes = Math.max(1, Math.ceil(words.length / 200))

    // Calculate average word length
    const avgWordLength = words.length ? (words.join("").length / words.length).toFixed(1) : 0

    // Count unique words
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[.,!?]$/, ""))).size

    return `
    <div class="shortcut-category">
      <h3>Document Metrics</h3>
      <div><span class="metric-label">Sentences:</span><span class="metric-value">${sentences.length}</span></div>
      <div><span class="metric-label">Words:</span><span class="metric-value">${words.length}</span></div>
      <div><span class="metric-label">Characters:</span><span class="metric-value">${chars}</span></div>
      <div><span class="metric-label">Average Word Length:</span><span class="metric-value">${avgWordLength}</span></div>
      <div><span class="metric-label">Unique Words:</span><span class="metric-value">${uniqueWords}</span></div>
      <div><span class="metric-label">Reading Time:</span><span class="metric-value">${readingTimeMinutes} min</span></div>
      </div>
    `
  }

  openMetricsCommand(event) {
    this.openModal(this.metrics, "metrics", event)
  }

  toggleMetricsCommand(event) {
    if (this._openModal === "metrics") this.closeModal()
    else this.openMetricsCommand(event)
  }

  openHelpModalCommand(event) {
    const { keyboardShortcuts } = this
    // Group shortcuts by category
    const shortcutsByCategory = lodash.groupBy(keyboardShortcuts, "category")

    // Generate HTML for each category
    const categoryElements = Object.entries(shortcutsByCategory)
      .map(([category, shortcuts]) => {
        if (category === "Hidden") return ""
        const shortcutElements = shortcuts
          .map(shortcut => {
            const command = shortcut.command
            const description = lodash.startCase(command.replace("Command", ""))
            const keyStr = shortcut.key.replace("command", "cmd")
            return `
            <div class="shortcut" onclick="app.${command}(event)">
              <kbd>${keyStr}</kbd> <span>${description}</span>
            </div>
          `
          })
          .join("")

        return `
          <div class="shortcut-category">
            <h4>${category}</h4>
            <div class="shortcuts-grid">
              ${shortcutElements}
            </div>
          </div>
        `
      })
      .join("")

    this.openModal(
      `
      <div class="keyboard-shortcuts">
        <h3>Keyboard Shortcuts</h3>
        ${categoryElements}
          <div style="text-align: center;">
            ScrollHub Community: 
            <a href="https://github.com/breck7/ScrollHub" target="_blank">GitHub</a> · 
            <a href="https://x.com/breckyunits" target="_blank">Twitter</a> · 
            <a href="https://www.youtube.com/watch?v=LghkzIOBqMY&list=PLnN2hBdpELHqcBeZIJyxT-WKyJ34lqqt-" target="_blank">YouTube</a> · 
            <a href="https://www.reddit.com/r/WorldWideScroll/" target="_blank">Reddit</a>
          </div>
      </div>
    `,
      "help",
      event
    )
  }

  nextFileCommand() {
    const { scrollFiles } = this
    const currentIndex = scrollFiles.indexOf(this.fileName)
    const nextIndex = (currentIndex + 1) % scrollFiles.length
    console.log(nextIndex)
    this.openFile(scrollFiles[nextIndex])
  }

  previousFileCommand() {
    const { scrollFiles } = this
    const currentIndex = scrollFiles.indexOf(this.fileName)
    const prevIndex = (currentIndex - 1 + scrollFiles.length) % scrollFiles.length
    this.openFile(scrollFiles[prevIndex])
  }

  keyboardShortcuts = Object.values(
    Particle.fromSsv(
      `key command category
command+s saveAndPublishCommand File
ctrl+n createFileCommand File
command+p formatFileCommand File
command+. toggleFocusModeCommand Editor
shift+t toggleThemeCommand Editor
ctrl+p refreshParserCommand Editor
command+3 toggleMetricsCommand Editor
command+1 previousFileCommand Navigation
command+2 nextFileCommand Navigation
command+/ toggleHelpCommand Hidden
? toggleHelpCommand Help
ctrl+w showWelcomeMessageCommand Help`
    ).toObject()
  )

  initTheme() {
    document.documentElement.setAttribute("data-theme", this.theme)
  }

  get theme() {
    return localStorage.getItem("editorTheme") || "light"
  }

  toggleThemeCommand() {
    const newTheme = this.theme === "light" ? "dark" : "light"
    document.documentElement.setAttribute("data-theme", newTheme)
    localStorage.setItem("editorTheme", newTheme)
  }

  bindKeyboardShortcuts() {
    const { keyboardShortcuts } = this
    const map = {}
    keyboardShortcuts.forEach(row => (map[row.key] = row.command))
    const that = this
    // note: I do not rememeber why we do any of this stopCallback stuff but it seems hard won knowledge ;)
    Mousetrap._originalStopCallback = Mousetrap.prototype.stopCallback
    Mousetrap.prototype.stopCallback = async function (evt, element, keyPress) {
      if (map[keyPress] && (!that.codeMirrorInstance.hasFocus() || keyPress.startsWith("command"))) {
        that[map[keyPress]]()
        evt.preventDefault()
        return true
      }

      if (Mousetrap._pause) return true
      return Mousetrap._originalStopCallback.call(this, evt, element)
    }

    keyboardShortcuts.forEach(shortcut => {
      Mousetrap.bind(shortcut.key, function (evt) {
        that[shortcut.command]()
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

  async showWelcomeMessageCommand(event) {
    const content = `container 600px

# Welcome to ScrollHub!

${this.folderName} is live!
 link ${this.permalink} ${this.folderName}
  target preview
 class newSiteLink

Scroll and ScrollHub are tools to help you refine and publish your best ideas.

Email me (breck@scroll.pub) with any requests or feedback.

-Breck
Follow me on X or GitHub
 https://x.com/breckyunits X
  target _blank
 https://github.com/breck7 GitHub
  target _blank`

    const html = await this.fusionEditor.scrollToHtml(content)
    this.openModal(html, "welcome", event)
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

  get hostnameWithPort() {
    const hostname = window.location.hostname
    const port = window.location.port
    if (!port || port === 80 || port === 443) return hostname
    return hostname + ":" + port
  }

  get rootUrl() {
    const protocol = this.useSsl ? window.location.protocol : "http:"
    return getBaseUrlForFolder(this.folderName, this.hostnameWithPort, protocol)
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
    const protocol = this.useSsl ? window.location.protocol : "http:"
    return getCloneUrlForFolder(this.folderName, this.hostnameWithPort, protocol)
  }

  copyClone() {
    // Create a temporary textarea element
    const textarea = document.createElement("textarea")
    textarea.value = `git clone ` + this.cloneUrl
    document.body.appendChild(textarea)

    // Select and copy the text
    textarea.select()
    document.execCommand("copy")

    // Clean up by removing the textarea
    document.body.removeChild(textarea)

    this.showSpinner("Git clone command copied to clipboard...")
    setTimeout(() => this.hideSpinner(), 3000)
  }

  updateFooterLinks() {
    const { folderName } = this
    document.getElementById("gitClone").innerHTML =
      `<a class="folderActionLink" href="/globe.html?folderName=${folderName}">traffic</a> · <a class="folderActionLink" href="/diffs.htm/${folderName}?count=10">revisions</a> · <a class="folderActionLink" href="#" onclick="window.app.copyClone()">clone</a> · <a class="folderActionLink" href="${folderName}.zip">download</a> · <a class="folderActionLink" href="#" onclick="window.app.duplicate()">duplicate</a> · <a href="#" class="folderActionLink" onclick="window.app.renameFolder()">move</a> · <a href="#" class="folderActionLink" onclick="window.app.deleteFolder()">delete</a>`
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

  useSsl = window.location.protocol === "https:"

  async fetchAndDisplayFileList() {
    const { folderName } = this
    try {
      const response = await fetch(`/ls.json?folderName=${folderName}`)
      if (!response.ok) throw new Error(await response.text())
      const allData = await response.json()
      const allFiles = allData.files
      this.useSsl = allData.hasSslCert

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

  get scrollFiles() {
    return this.filenames.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
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

    this.fileListEl.innerHTML = fileLinks.join("")
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
    let fileName = prompt("Enter a filename", "untitled").replace(/ /g, "")
    if (!fileName) return ""
    await this.writeFile("Creating file...", "", fileName)
  }

  _isFirstOpen = true
  setFileContent(value) {
    document.getElementById("fileEditor").value = value.replace(/\r/g, "")
    this.codeMirrorInstance.setValue(value)
    const lines = value.split("\n")
    // if its a small file, put user right in editing experience
    if (lines.length < 24 && this._isFirstOpen) this.focusOnEnd()
    this._isFirstOpen = false
  }

  focusOnEnd() {
    const lines = this.codeMirrorInstance.getValue().split("\n")
    const lastLine = lines.pop()
    this.codeMirrorInstance.setCursor({ line: lines.length, ch: lastLine.length })
    this.codeMirrorInstance.focus()
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

  async formatFileCommand() {
    const bufferValue = await this.fusionEditor.getFormatted()
    this.setFileContent(bufferValue)
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

    document.querySelector(".formatFileLink").addEventListener("click", async evt => {
      evt.preventDefault()
      this.formatFileCommand()
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
