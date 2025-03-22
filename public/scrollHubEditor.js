const getBaseUrlForFolder = (folderName, hostname, protocol, usesCustomDomain) => {
  if (hostname === "localhost" || hostname.startsWith("localhost:")) return `http://${hostname}/${folderName}`

  if (!folderName.includes(".") || !usesCustomDomain) return protocol + "//" + hostname + "/" + folderName

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

const sortFns = {
  defaultSort: filteredFiles => {
    // Sort files: .scroll and .parsers first, then others
    const scrollFiles = filteredFiles.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
    return scrollFiles.concat(filteredFiles.filter(file => !file.endsWith(".scroll") && !file.endsWith(".parsers")))
  },
  recentSort: filteredFiles => {
    // Sort by most recently modified, most recent first
    return lodash.orderBy(filteredFiles, file => new Date(app.files[file].mtime), "desc")
  },
  sizeSort: filteredFiles => {
    // Sort by file size, largest first
    return lodash.orderBy(filteredFiles, file => app.files[file].size, "desc")
  }
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
    return this.isMobile ? 400 : Math.max(300, window.innerHeight - 200)
  }

  updateEditorDimensions() {
    const { editorHeight, isMobile } = this
    const fileListHeight = isMobile ? "auto" : `${editorHeight - 138}px`
    const fileListWidth = isMobile ? document.body.clientWidth - 40 + "px" : "200px"
    const fileList = document.getElementById("fileList")
    fileList.style.height = fileListHeight
    fileList.style.width = fileListWidth
    this.codeMirrorInstance.setSize(this.width, editorHeight)
    if (this.isFocusMode) {
      console.log("Entering focus mode")
      document.querySelector(".buttonRow").style.display = "none"
      document.querySelector(".editorHolder").classList.add("focusMode")
      const width = Math.min(800, document.body.clientWidth)
      this.codeMirrorInstance.setSize(width, window.innerHeight) // subtract 40 for padding
    }
  }

  get isMobile() {
    return window.innerWidth < 768
  }

  get width() {
    const bodyWidth = document.body.clientWidth
    if (this.isMobile) return bodyWidth - 40
    const maxWidth = 784
    let computedWidth = bodyWidth - 270
    return Math.max(100, Math.min(maxWidth, computedWidth))
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
        lineNumbers: this.showLineNumbers,
        mode
      })
    } else {
      // Use standard CodeMirror with appropriate mode and hint addons
      this.codeMirrorInstance = CodeMirror.fromTextArea(textarea, {
        lineWrapping: true,
        lineNumbers: this.showLineNumbers,
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
    console.log("rehighlighting needed - reinitializing CodeMirror")
    this._parser = this.parser

    // Store current state
    const currentContent = this.codeMirrorInstance.getValue()
    const currentCursor = this.codeMirrorInstance.getCursor()
    const currentScrollInfo = this.codeMirrorInstance.getScrollInfo()

    // Completely reinitialize CodeMirror with current mode
    this.initCodeMirror(this.mode)

    // Restore content and cursor position
    this.codeMirrorInstance.setValue(currentContent)
    this.codeMirrorInstance.setCursor(currentCursor)

    // Restore scroll position
    this.codeMirrorInstance.scrollTo(currentScrollInfo.left, currentScrollInfo.top)
  }

  mode = "custom"
  autocomplete = true
  currentParser = null
  updateEditorMode(mode) {
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

  get showLineNumbers() {
    return this.getFromLocalOrMemory("showLineNumbers") === "true"
  }

  toggleLineNumbersCommand() {
    this.setFromLocalOrMemory("showLineNumbers", !this.showLineNumbers)
    this.codeMirrorInstance.setOption("lineNumbers", this.showLineNumbers)
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

  get filePath() {
    return `${this.folderName}/${this.fileName}`
  }

  async main() {
    this.initTheme()
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
        buffer = buffer.replace(/TODAYS_DATE/g, new Date().toLocaleDateString("en-US"))
        this.refreshFileListCommand()
        await this.clearBufferCommand(decodeURIComponent(buffer))
      } else {
        await this.refreshFileListCommand()
        await this.autoOpen()
        if (urlParams.get("command") === "showWelcomeMessageCommand") this.showWelcomeMessageCommand()
      }
    } else {
      this.refreshFileListCommand()
      this.openFile(fileName)
    }

    return this
  }

  async clearBufferCommand(buffer = "") {
    this.fileName = ""
    this.setFileContent(buffer)
    await this.refreshParserCommand()
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
    await this.updateFooterLinks()
  }

  async openFile(fileName) {
    const { folderName } = this
    this.fileName = fileName
    const filePath = `${folderName}/${fileName}`

    // Update UI state for binary files
    if (this.isBinaryFile(fileName)) {
      this.setFileContent("Binary file not shown.")
      this.codeMirrorInstance.setOption("readOnly", true)
      this.updateUIForBinaryFile(true)
    } else {
      // Regular file handling
      const response = await fetch(`/readFile.htm?folderName=${folderName}&filePath=${encodeURIComponent(filePath)}`)
      const content = await response.text()
      this.setFileContent(content)
      this.codeMirrorInstance.setOption("readOnly", false)
      this.updateUIForBinaryFile(false)
      await this.refreshParserCommand()
      this.updateEditorMode(this.getEditorMode(fileName))
    }

    this.setFileNameInUrl(fileName)
    this.updatePreviewIFrame()

    if (!this.allFiles) await this.refreshFileListCommand()
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

  // Add a method to check if a file is binary
  isBinaryFile(fileName) {
    const binaryExtensions = new Set(
      "ds_store thumbs.db pdf png jpg jpeg gif webp bmp tiff ico eps raw cr2 nef heic doc docx xls xlsx ppt pptx odt ods odp pages numbers key zip tar gz 7z rar bz2 dmg iso tgz exe dll so dylib bin app msi deb rpm mp3 wav ogg mp4 avi mov wmv flv mkv".split(
        " "
      )
    )
    const extension = fileName.split(".").pop().toLowerCase()
    return binaryExtensions.has(extension)
  }

  updateUIForBinaryFile(isBinary) {
    // Get UI elements
    const saveButton = document.querySelector('[onclick*="saveAndPublishCommand"]')
    const formatButton = document.querySelector('[onclick*="formatFileCommand"]')

    if (saveButton) {
      saveButton.style.display = isBinary ? "none" : "inline-block"
    }
    if (formatButton) {
      formatButton.style.display = isBinary ? "none" : "inline-block"
    }

    // Update editor styling for binary files
    const editorElement = this.codeMirrorInstance.getWrapperElement()
    if (isBinary) {
      editorElement.classList.add("binary-file")
      this.codeMirrorInstance.setOption("lineNumbers", false)
      this.codeMirrorInstance.refresh()
    } else {
      editorElement.classList.remove("binary-file")
      this.codeMirrorInstance.setOption("lineNumbers", this.showLineNumbers)
      this.codeMirrorInstance.refresh()
    }
  }

  showSpinner(message, style) {
    document.querySelector("#spinner").innerHTML = `<span${style}>${message}</span>`
    document.querySelector("#spinner").style.display = "block"
  }

  showSpinnerWithStopwatch(message, style) {
    this.showSpinner(message, style)
    let count = 1
    this.spinnerInterval = setInterval(() => (document.querySelector("#spinner").innerHTML = `<span${style}>${message} - ${count++}s</span>`), 1000)
    document.querySelector("#spinner").style.display = "block"
  }

  silenceErrorsCommand() {
    this.silenceErrors = true
    this.hideSpinner()
  }

  showError(message) {
    clearInterval(this.spinnerInterval)
    if (this.silenceErrors) this.hideSpinner()
    else this.showSpinner(message + ` <a onclick="app.silenceErrorsCommand()">[Silence]</a>`, ` style="color:red;"`)
  }

  hideSpinner() {
    document.querySelector("#spinner").style.display = "none"
    clearInterval(this.spinnerInterval)
  }

  async saveFile() {
    if (!this.fileName) {
      const name = new URL(window.location).searchParams.get("bufferName") || "untitled"
      let newFileName = this.sanitizeFileName(prompt("Enter a filename", name))
      if (!newFileName) return ""
      if (await this.nameTakenAndAbortRequested(newFileName)) return
      this.fileName = newFileName
    }
    await this.writeFile("Publishing...", this.bufferValue, this.fileName)
    await this.refreshParserCommand()
    this.updatePreviewIFrame()
  }

  async writeFile(spinnerText, content, fileName) {
    const { folderName, author } = this
    const filePath = `${folderName}/${fileName}`
    this.showSpinner(spinnerText)
    try {
      const response = await this.postData("/writeFile.htm", { filePath, content })
      this.hideSpinner()
      await this.refreshFileListCommand()
      if (this.fileName !== fileName) this.openFile(fileName)
      this.buildFolderCommand()
    } catch (error) {
      console.error("Error duplicating file:", error)
      this.showError(error.message)
    }
  }

  async buildFolderCommand() {
    const response = await this.postData("/build.htm")
    const message = await response.text()
    if (!response.ok) {
      console.error(message)
      this.showError(message.message?.split(".")[0] || "Error building folder.")
      return false
    } else if (message.includes("SyntaxError")) {
      this.showError("There may have been an error building your site. Please check console logs.")
      console.error(message)
      return false
    }
    console.log(`'${this.folderName}' built in ${message}ms`)
    return true
  }

  async buildFolderAndRefreshCommand() {
    this.showSpinnerWithStopwatch("Building")
    const result = await this.buildFolderCommand()
    if (!result) return false
    await this.refreshFileListCommand()
    this.hideSpinner()
  }

  async saveAndPublishCommand() {
    await this.saveFile()
    await this.refreshFileListCommand()
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
    document.querySelector("#theModal").classList.remove("scrollModalFit")
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
            const keyStr = shortcut.key.startsWith("nokey") ? "⚪️" : shortcut.key.replace("command", "cmd")
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
              ${shortcutElements}
          </div>
        `
      })
      .join("")

    this.openModal(
      `
      <div class="keyboard-shortcuts">
        <h3>Keyboard Shortcuts</h3>
        <div class="shortcuts-grid">
        ${categoryElements}
        </div>
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
command+h showFileHistoryCommand File
command+h showFileBlameCommand File
command+b buildFolderAndRefreshCommand Folder
command+shift+f searchFolderCommand Folder
nokey2 exportForPromptCommand Folder
nokey4 testFolderCommand Folder
nokey6 formatFolderCommand Folder
nokey5 listSubfoldersCommand Folder
nokey7 showGitStatusCommand Folder
command+. toggleFocusModeCommand Editor
shift+t toggleThemeCommand Editor
nokey91 toggleLineNumbersCommand Editor
ctrl+p refreshParserCommand Editor
command+3 toggleMetricsCommand Editor
ctrl+b clearBufferCommand Editor
command+shift+h showHiddenFilesCommand Files
nokey9 changeFileSortCommand Files
command+1 previousFileCommand Navigation
command+2 nextFileCommand Navigation
command+/ toggleHelpCommand Hidden
? toggleHelpCommand Help
nokey1 showWelcomeMessageCommand Help`
    ).toObject()
  )

  initTheme() {
    document.documentElement.setAttribute("data-theme", this.theme)
  }

  get theme() {
    return localStorage.getItem("editorTheme") || "light"
  }

  async searchFolderCommand(event) {
    const query = prompt("Enter search query:")
    if (!query) return

    try {
      this.showSpinnerWithStopwatch("Searching...")
      const response = await fetch(`/search.htm?folderName=${this.folderName}&query=${encodeURIComponent(query)}`)
      if (!response.ok) throw new Error(await response.text())

      const results = await response.text()
      const resultsArray = results.split("\n").filter(line => line.trim())

      // Create modal content with formatted results
      const modalContent = `
        <div class="search-results">
          <h3>Search Results for: "${query}"</h3>
          <div class="search-results-container" style="max-height: 70vh; overflow-y: auto;">
            ${resultsArray
              .map(line => {
                // Parse the ripgrep output line (format: "filename:line_number:content")
                const [file, lineNum, ...contentParts] = line.split(":")
                const content = contentParts.join(":") // Rejoin content in case it contains colons

                return `
                <div class="search-result-item" style="margin: 10px 0; padding: 10px; border-bottom: 1px solid #eee;">
                  <div>
                    <a href="#" 
                       onclick="app.openFile('${file}'); return false;" 
                       style="text-decoration: none; font-weight: bold;">
                      ${file}
                    </a>
                    <span style="margin-left: 10px;">Line ${lineNum}</span>
                  </div>
                  <pre style="margin: 5px 0 0 20px; padding: 5px; white-space: pre-wrap;">${content}</pre>
                </div>`
              })
              .join("")}
          </div>
        </div>
      `

      this.hideSpinner()
      this.openModal(modalContent, "search", event)
    } catch (error) {
      console.error("Search error:", error)
      this.showError("Search failed: " + error.message)
    }
  }

  toggleThemeCommand() {
    const newTheme = this.theme === "light" ? "dark" : "light"
    document.documentElement.setAttribute("data-theme", newTheme)
    localStorage.setItem("editorTheme", newTheme)
  }

  showHiddenFilesCommand() {
    this.setFromLocalOrMemory("showHiddenFiles", !this.showHiddenFiles)
    delete this._files
    this.renderFileList()
  }

  get showHiddenFiles() {
    return this.getFromLocalOrMemory("showHiddenFiles") === "true"
  }

  changeFileSortCommand() {
    const sortOptions = Object.keys(sortFns)
    const currentIndex = sortOptions.indexOf(this.fileSort)
    const nextIndex = (currentIndex + 1) % sortOptions.length
    const newStrategy = sortOptions[nextIndex]

    this.setFromLocalOrMemory("fileSort", newStrategy)
    delete this._files
    this.renderFileList()

    // Show feedback to user about the current sort
    const sortNames = {
      defaultSort: "Default Sort (.scroll files first)",
      recentSort: "Most Recently Modified",
      sizeSort: "Largest Files First"
    }
    this.showSpinner(`Sorted by: ${sortNames[newStrategy]}`)
    setTimeout(() => this.hideSpinner(), 2000)
  }

  get fileSort() {
    return this.getFromLocalOrMemory("fileSort") || "defaultSort"
  }

  setFromLocalOrMemory(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch (err) {
      this[key] = value
      console.error(err)
    }
  }

  getFromLocalOrMemory(key) {
    try {
      return localStorage.getItem(key)
    } catch (err) {
      console.error(err)
      return this[key]
    }
  }

  bindKeyboardShortcuts() {
    const keyboardShortcuts = this.keyboardShortcuts.filter(key => !key.key.startsWith("nokey"))
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

  async exportForPromptCommand(event) {
    this.openIframeModal("/stamp?folderName=" + this.folderName, event)
  }

  async testFolderCommand(event) {
    this.openIframeModal("/test/" + this.folderName, event)
  }

  async formatFolderCommand(event) {
    this.openIframeModal("/format/" + this.folderName, event)
  }

  async listSubfoldersCommand(event) {
    this.openIframeModal("/list/" + this.folderName, event)
  }

  async showGitStatusCommand(event) {
    this.openIframeModal("/status/" + this.folderName, event)
  }

  async showFileHistoryCommand(event) {
    this.openIframeModal(`fileHistory.htm?folderName=${this.folderName}&filePath=${this.fileName}`, event)
  }

  async showWelcomeMessageCommand(event) {
    let content = `container 600px

# Welcome to ScrollHub!

center
${this.folderName} is live!
<div class="iframeHolder2"><iframe src="${this.permalink}" class="visitIframe"></iframe></div>

center
Visit ${this.folderName}
 link ${this.permalink}
  target preview
 class newSiteLink

We make Scroll and ScrollHub to help you refine and publish your best ideas.

I'd love to hear your requests and feedback! Contact me on X, GitHub, or email.
 https://x.com/breckyunits X
  target _blank
 email breck@scroll.pub email
  target _blank
 https://github.com/breck7 GitHub
  target _blank

-Breck`
    if (new URL(window.location).searchParams.get("welcomeMessage") === "framehub") {
      content = `container 600px

# Welcome to FrameHub!

center
${this.folderName} is live!
<div class="iframeHolder2"><iframe src="${this.permalink}" class="visitIframe"></iframe></div>

center
Visit ${this.folderName}
 link ${this.permalink}
  target preview
 class newSiteLink

I'd love to hear your requests and feedback! Find me on Warpcast.
 https://warpcast.com/breck Find me on Warpcast

-Breck`
    }

    const html = await this.fusionEditor.scrollToHtml(content)
    this.openModal(html, "welcome", event)
    document.querySelector("#theModal").classList.add("scrollModalFit")
  }

  async showFileBlameCommand(event) {
    if (!this.fileName) return

    try {
      this.showSpinner("Loading file blame...")
      const response = await fetch(`/blame.htm?folderName=${this.folderName}&fileName=${encodeURIComponent(this.fileName)}`)

      if (!response.ok) {
        throw new Error("Failed to fetch file blame")
      }

      const blame = await response.text()

      // Format the blame data into HTML
      const formattedHistory = `
        <div class="file-blame">
          <h3>File Blame: ${this.fileName}</h3>
          <div class="blame-content" style="white-space: pre; font-family: monospace; max-height: 70vh; overflow-y: auto;">${blame}</div>
        </div>
      `

      this.openModal(formattedHistory, "blame", event)
      this.hideSpinner()
    } catch (error) {
      console.error("Error fetching file blame:", error)
      this.showError("Failed to load file blame: " + error.message)
      setTimeout(() => this.hideSpinner(), 3000)
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
        this.refreshFileListCommand()
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
    try {
      const response = await this.postData("/uploadFile.htm", { file })
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
    // If we are serving not from a custom domain or we are serving from a custom domain and it has SSL, use SSL.
    const protocol = this.useSsl || !this.usesCustomDomain ? window.location.protocol : "http:"
    return getBaseUrlForFolder(this.folderName, this.hostnameWithPort, protocol, this.usesCustomDomain)
  }

  get isPreviewableFile() {
    if (!this.fileName) return false
    const previewableExtensions = "html htm scroll parsers md txt css svg png jpg jpeg gif webp pdf".split(" ")
    return previewableExtensions.some(ext => this.fileName.toLowerCase().endsWith(ext))
  }

  updatePreviewIFrame() {
    const { rootUrl, folderName } = this
    const oldIframe = document.querySelector(".previewIFrame")
    const newIframe = document.createElement("iframe")
    newIframe.className = "previewIFrame"
    newIframe.allow = ""
    newIframe.sandbox = "allow-scripts"
    newIframe.src = this.isPreviewableFile ? this.permalink : "about:blank"
    oldIframe.replaceWith(newIframe)
    this.previewIFrame = newIframe

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

  openIframeModalFromClick(event) {
    this.openIframeModal(event.currentTarget.href, event)
  }

  openIframeModal(url, event) {
    const { folderName } = this
    const modalContent = `
        <iframe 
          src="${url}" 
          style="width: 100%; height: 80vh; border: none;"
        ></iframe>
  `
    this.openModal(modalContent, url, event)
  }

  async updateFooterLinks() {
    const { folderName } = this
    const code = `a traffic
 class folderActionLink
 href /globe.html?folderName=${folderName}
 onclick if (!event.ctrlKey && !event.metaKey) { window.app.openIframeModalFromClick(event); return false; }
span ·
a revisions
 class folderActionLink
 href /commits.htm?folderName=${folderName}&count=30
 onclick if (!event.ctrlKey && !event.metaKey) { window.app.openIframeModalFromClick(event); return false; }
span ·
a clone
 class folderActionLink
 href #
 onclick window.app.copyClone()
span ·
a download
 class folderActionLink
 href ${folderName}.zip
span ·
a duplicate
 class folderActionLink
 href #
 onclick window.app.duplicate()
span ·
a move
 href #
 class folderActionLink
 onclick window.app.renameFolder()
span ·
a delete
 href #
 class folderActionLink
 onclick window.app.deleteFolder()
span ·
a ${this.authorDisplayName}
 href #
 class folderActionLink
 linkify false
 onclick window.app.loginCommand()`
    const html = await this.fusionEditor.scrollToHtml(code)
    document.getElementById("folderLinks").innerHTML = html
  }

  get author() {
    return localStorage.getItem("author")
  }

  get authorDisplayName() {
    const { author } = this
    if (!author) return "anon"
    return author.split("<")[1].split(">")[0]
  }

  async loginCommand() {
    const { author } = this
    const defaultAuthor = "Anon <anon@scroll.pub>"
    const newAuthorName = prompt(`Your name and email:`, author || defaultAuthor)
    if (newAuthorName === "" || newAuthorName === defaultAuthor) {
      localStorage.removeItem("author", undefined)
    } else if (newAuthorName && newAuthorName.match(/^[^<>]+\s<[^<>@\s]+@[^<>@\s]+>$/)) {
      localStorage.setItem("author", newAuthorName)
    }

    await this.updateFooterLinks()
  }

  async renameFolder() {
    const newFolderName = prompt(`Rename ${this.folderName} to:`)
    if (!newFolderName) return
    const response = await this.postData("/mv.htm", { oldFolderName: this.folderName, newFolderName })
    const result = await response.text()
    window.location.href = `/edit.html?folderName=${newFolderName}`
  }

  async deleteFolder() {
    const userInput = prompt(`To delete this entire folder, please type the folder name: ${this.folderName}`)

    if (userInput !== this.folderName) return

    try {
      const response = await this.postData("/trashFolder.htm")
      const data = await response.text()
      console.log(data)
      window.location.href = "/" // Redirect to home page after deletion
    } catch (error) {
      console.error("Error:", error)
    }
  }

  async duplicate() {
    this.showSpinner("Copying folder...")
    const response = await this.postData("/cloneFolder.htm", { redirect: "false" })
    const result = await response.text()
    this.hideSpinner()
    console.log(result)
    window.location.href = `/edit.html?folderName=${result}`
  }

  useSsl = window.location.protocol === "https:"

  get files() {
    if (this._files) return this._files
    const { allFiles, showHiddenFiles } = this
    const filtered = {}
    Object.keys(allFiles).forEach(key => {
      const value = allFiles[key]
      if (showHiddenFiles || value.tracked || !key.startsWith(".")) filtered[key] = value
    })

    this._files = filtered
    return this._files
  }

  async refreshFileListCommand() {
    const { folderName } = this
    try {
      const response = await fetch(`/ls.json?folderName=${folderName}`)
      if (!response.ok) throw new Error(await response.text())
      const allData = await response.json()
      const allFiles = allData.files
      delete this._files
      this.allFiles = allFiles
      this.useSsl = allData.hasSslCert
      this.aRecordIps = allData.aRecordIps || []
      this.serverIps = allData.serverIps || []
      // We look at the A Records for the domain and compare to the Server's IP addresses.
      // If there's a match, we use the custom domain.
      this._usesCustomDomain = this.aRecordIps.some(ip => this.serverIps.includes(ip))
      this.renderFileList()
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error.message)
    }
  }

  get usesCustomDomain() {
    if (this._usesCustomDomain !== undefined) return this._usesCustomDomain
    return this.folderName === window.location.hostname
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
    const sortStrategy = this.fileSort
    const sorted = sortFns[sortStrategy](filteredFiles)

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

  async postData(url, params = {}) {
    const { folderName, author } = this
    const formData = new FormData()
    formData.append("folderName", folderName)
    if (author) formData.append("author", author)
    Object.keys(params).forEach(key => {
      formData.append(key, params[key])
    })
    const response = await fetch(url, {
      method: "POST",
      body: formData
    })
    return response
  }

  async performFileRename(oldFileName, newFileName) {
    const { folderName } = this
    try {
      this.showSpinner("Renaming..")
      const response = await this.postData("/renameFile.htm", { oldFileName, newFileName })
      if (!response.ok) throw new Error(await response.text())

      this.hideSpinner()
      console.log(`File renamed from ${oldFileName} to ${newFileName}`)
      this.refreshFileListCommand()
      this.buildFolderCommand()

      // If the renamed file was the current file, open the new file
      if (this.fileName === oldFileName) this.openFile(newFileName)
    } catch (error) {
      console.error(error)
      alert("Rename error:" + error)
    }
  }

  sanitizeFileName(fileName) {
    if (fileName === undefined || fileName === null) return ""
    // Dont allow spaces in filenames. And if no extension, auto add .scroll.
    return (fileName.includes(".") ? fileName : fileName + ".scroll").replace(/ /g, "")
  }

  async createFileCommand() {
    let newFileName = this.sanitizeFileName(prompt("Enter a filename", "untitled"))
    if (!newFileName) return ""
    if (await this.nameTakenAndAbortRequested(newFileName)) return
    await this.writeFile("Creating file...", "", newFileName)
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

  async duplicateFileCommand() {
    const { fileName } = this
    // Generate default name for the duplicate file
    const extension = fileName.includes(".") ? "." + fileName.split(".").pop() : ""
    const baseName = fileName.replace(extension, "")
    const defaultNewName = `${baseName}-copy${extension}`

    const newFileName = this.sanitizeFileName(prompt(`Enter name for the duplicate of "${fileName}":`, defaultNewName))
    if (!newFileName || newFileName === fileName) return
    if (await this.nameTakenAndAbortRequested(newFileName)) return
    await this.writeFile("Duplicating...", this.bufferValue, newFileName)
  }

  // If the filename does not exist, return true, if it already exists, prompt the user to confirm overwrite.
  async nameTakenAndAbortRequested(newFileName) {
    const { filenames } = this

    // If the filename doesn't exist, return false (no overwrite needed)
    if (!filenames.includes(newFileName)) return false

    // If the filename exists, prompt user for confirmation
    const confirmation = confirm(`A file named "${newFileName}" already exists. Would you like to overwrite it?`)

    // Return true if user confirms overwrite, false if they cancel
    return !confirmation
  }

  async formatFileCommand() {
    const bufferValue = await this.fusionEditor.getFormatted()
    this.setFileContent(bufferValue)
  }

  async renameFileCommand() {
    const oldFileName = this.fileName
    const newFileName = this.sanitizeFileName(prompt(`Enter new name for "${oldFileName}":`, oldFileName))
    if (await this.nameTakenAndAbortRequested(newFileName)) return
    if (newFileName && newFileName !== oldFileName) this.performFileRename(oldFileName, newFileName)
  }

  async deleteFileCommand() {
    const { fileName, folderName } = this
    const userInput = prompt(`To delete this file, please type the file name: ${fileName}`)

    if (!userInput || userInput !== fileName) return
    this.showSpinner("Deleting...")
    const response = await this.postData("/deleteFile.htm", { filePath: fileName })
    const data = await response.text()
    await this.refreshFileListCommand()
    await this.autoOpen()
    await this.buildFolderCommand()
    await this.refreshFileListCommand()
    this.hideSpinner()
  }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new EditorApp()
  window.app.main()
})
