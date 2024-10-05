// todo: before unload warn about unsaved changes
class EditorApp {
	constructor() {
		this.folderName = ""
		this.previewIFrame = null
		this.fileList = null
		const scrollParser = new HandParsersProgram(AppConstants.parsers).compileAndReturnRootParser()
		this.codeMirrorInstance = new ParsersCodeMirrorMode("custom", () => scrollParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("fileEditor"), {
			lineWrapping: true, // todo: some way to see wrapped lines? do we want to disable line wrapping? make a keyboard shortcut?
			lineNumbers: false
		})
		this.codeMirrorInstance.setSize(this.width, 490)
		window.addEventListener("resize", () => this.codeMirrorInstance.setSize(this.width, 490))
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
		console.log(computedWidth)
		return computedWidth
	}

	showError(message) {
		console.error(message)
		this.fileList.innerHTML = `<span style="color:red;">${message}</span>`
	}

	get filePath() {
		return `${this.folderName}/${this.fileName}`
	}

	async main() {
		const urlParams = new URLSearchParams(window.location.search)
		this.folderName = urlParams.get("folderName")
		if (!this.folderName) return this.showError("Folder name not provided in the query string")
		this.fileList = document.getElementById("fileList")
		this.fileName = urlParams.get("fileName")
		if (!this.fileName) await this.fetchAndDisplayFileList()
		else this.fetchAndDisplayFileList()

		this.updatePreviewIFrame()

		this.fileEditor = document.getElementById("fileEditor")
		document.getElementById("filePathInput").value = this.filePath
		document.getElementById("folderNameInput").value = this.folderName
		this.loadFileContent()
		this.bindDeleteButton()

		// Add event listener for file drag and drop. If a file is dropped, upload it.

		// Add event listeners for drag and drop
		const dropZone = document.getElementById("editForm")
		dropZone.addEventListener("dragover", this.handleDragOver.bind(this))
		dropZone.addEventListener("dragleave", this.handleDragLeave.bind(this))
		dropZone.addEventListener("drop", this.handleDrop.bind(this))
		this.bindKeyboardShortcuts()

		return this
	}

	async saveFile() {
		const formData = new FormData()
		formData.append("filePath", this.filePath)
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
			console.log("File saved successfully")
			this.updatePreviewIFrame()
			return data
		} catch (error) {
			console.error("Error saving file:", error.message)
			throw error // Re-throw the error if you want calling code to handle it
		}
	}

	bindKeyboardShortcuts() {
		const that = this

		const keyboardShortcuts = {
			"command+s": () => {
				console.log("Saved")
				that.fetchAndDisplayFileList()
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
				that.saveFile()
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
		const uploadPromises = Array.from(files).map(file => this.uploadFile(file))

		Promise.all(uploadPromises)
			.then(() => {
				console.log("All files uploaded successfully")
				this.fetchAndDisplayFileList()
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
		if (!this.isCustomDomain) return "/" + this.folderName
		return "https://" + this.folderName // todo: fix this once ssl is working.
	}

	updatePreviewIFrame() {
		const { folderName, isCustomDomain, rootUrl } = this
		this.previewIFrame = document.getElementById("previewIFrame")
		this.previewIFrame.src = rootUrl

		const serverName = window.location.hostname
		const folderNameText = isCustomDomain ? folderName : `${serverName}/${folderName}`
		document.getElementById("folderNameLink").innerHTML = folderNameText
		document.getElementById("folderNameLink").href = rootUrl
		document.getElementById(
			"gitClone"
		).innerHTML = `<a class="historyLink" href="/diff.htm/${folderName}">history</a> · <a onclick="window.app.duplicate()" class="duplicateButton">duplicate</a> · git clone http://${serverName}/${folderName}.git --origin scrollhub`
		document.title = `Editing ${folderNameText}`
	}

	duplicate() {
		const newFolderName = prompt("Folder name")
		if (!newFolderName) return
		window.location.href = `/createFromForm.htm?folderName=${newFolderName}&template=${this.folderName}`
	}

	async fetchAndDisplayFileList() {
		try {
			const response = await fetch(`/ls.htm${this.auth}`)
			if (!response.ok) throw new Error(await response.text())
			const data = await response.text()
			const files = data.split("\n")
			this.updateFileList(files)
		} catch (error) {
			console.error("There was a problem with the fetch operation:", error.message)
		}
	}

	updateFileList(files) {
		const scrollFiles = files.filter(file => file.endsWith(".scroll") || file.endsWith(".parsers"))
		this.scrollFiles = scrollFiles
		if (!this.fileName) this.fileName = scrollFiles.includes("index.scroll") ? "index.scroll" : scrollFiles[0]
		const currentFileName = this.fileName
		const sorted = scrollFiles.concat(files.filter(file => !file.endsWith(".scroll") && !file.endsWith(".parsers")))
		const { folderName } = this
		const fileLinks = sorted.map(file => {
			const selected = currentFileName === file ? "selectedFile" : ""
			return file.endsWith(".scroll") || file.endsWith(".parsers")
				? `<a class="${selected}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}" oncontextmenu="app.maybeRenamePrompt('${file}', event)">${file}</a>`
				: `<a class="nonScrollFile ${selected}" href="edit.html?folderName=${folderName}&fileName=${encodeURIComponent(file)}" oncontextmenu="app.maybeRenamePrompt('${file}', event)">${file}</a>`
		})
		this.fileList.innerHTML = fileLinks.join("<br>")
	}

	maybeRenamePrompt(oldFileName, event) {
		if (!event.ctrlKey) return true

		event.preventDefault()
		const newFileName = prompt(`Enter new name for "${oldFileName}":`, oldFileName)
		if (newFileName && newFileName !== oldFileName) {
			this.performRename(oldFileName, newFileName)
		}
	}

	async performRename(oldFileName, newFileName) {
		try {
			const response = await fetch("/rename.htm", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body: `folderName=${encodeURIComponent(this.folderName)}&oldFileName=${encodeURIComponent(oldFileName)}&newFileName=${encodeURIComponent(newFileName)}`
			})

			if (!response.ok) throw new Error("Rename operation failed")

			console.log(`File renamed from ${oldFileName} to ${newFileName}`)
			this.fetchAndDisplayFileList()

			// If the renamed file was the current file, update the fileName
			if (this.fileName === oldFileName) {
				this.fileName = newFileName
				document.getElementById("filePathInput").value = `${this.folderName}/${newFileName}`
			}
		} catch (error) {
			console.error("Error renaming file:", error)
			alert("Failed to rename file. Please try again.")
		}
	}

	createFileCommand() {
		const fileName = prompt("Enter a filename", "untitled")
		if (!fileName) return ""
		const { folderName } = this

		const filePath = `${folderName}/${fileName.includes(".") ? fileName : fileName + ".scroll"}`
		window.location = `write.htm?content=&folderName=${encodeURIComponent(folderName)}&filePath=${encodeURIComponent(filePath)}`
	}

	setFileContent(value) {
		this.fileEditor.value = value
		this.codeMirrorInstance.setValue(value)
	}

	get auth() {
		return `?folderName=${this.folderName}&`
	}

	async loadFileContent() {
		if (!this.folderName || !this.fileName) {
			console.error("Folder name or file name is missing")
			return
		}

		const filePath = `${this.folderName}/${this.fileName}`

		const response = await fetch(`/read.htm${this.auth}filePath=${encodeURIComponent(filePath)}`)
		const content = await response.text()
		this.setFileContent(content)

		this.renderDeleteButton()
	}

	bindDeleteButton() {
		const deleteLink = document.querySelector(".deleteLink")
		deleteLink.addEventListener("click", async e => {
			e.preventDefault()

			const { fileName, folderName } = this
			const userInput = prompt(`To confirm deletion, please type the file name: ${fileName}`)

			if (userInput !== fileName) {
				alert("File name did not match. Deletion cancelled.")
				return
			}

			const filePath = `${folderName}/${fileName}`

			const response = await fetch(`/delete.htm?filePath=${encodeURIComponent(filePath)}`, {
				method: "DELETE"
			})

			const data = await response.text()
			window.location.href = `/edit.html?folderName=${folderName}` // Redirect back to folder
		})
	}

	renderDeleteButton() {
		const content = this.codeMirrorInstance.getValue()
		const deleteLink = document.querySelector(".deleteLink")

		deleteLink.style.display = content.trim() === "" ? "inline" : "none"
	}
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
	window.app = new EditorApp()
	window.app.main()
})
