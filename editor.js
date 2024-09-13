// todo: before unload warn about unsaved changes

class EditorApp {
	constructor() {
		this.folderName = ""
		this.previewIFrame = null
		this.fileList = null
		const scrollParser = new HandParsersProgram(AppConstants.parsers).compileAndReturnRootParser()
		this.codeMirrorInstance = new ParsersCodeMirrorMode("custom", () => scrollParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("fileEditor"), {
			lineWrapping: false,
			lineNumbers: false
		})
		this.codeMirrorInstance.setSize(784, 490) // todo: adjust on resize
	}

	showError(message) {
		console.error(message)
		this.fileList.innerHTML = `<span style="color:red;">${message}</span>`
	}

	main() {
		const urlParams = new URLSearchParams(window.location.search)
		this.folderName = urlParams.get("folderName")
		this.fileName = urlParams.get("fileName")
		this.fileList = document.getElementById("fileList")

		this.updatePreviewIFrame()
		if (!this.folderName) return this.showError("Folder name not provided in the query string")

		this.fetchAndDisplayFileList()

		this.fileEditor = document.getElementById("fileEditor")
		document.getElementById("filePathInput").value = `${this.folderName}/${this.fileName}`
		document.getElementById("folderNameInput").value = this.folderName
		this.loadFileContent()

		// Add event listener for file drag and drop. If a file is dropped, upload it.

		// Add event listeners for drag and drop
		const dropZone = document.getElementById("editForm")
		dropZone.addEventListener("dragover", this.handleDragOver.bind(this))
		dropZone.addEventListener("dragleave", this.handleDragLeave.bind(this))
		dropZone.addEventListener("drop", this.handleDrop.bind(this))
		return this
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
			const response = await fetch("/upload", {
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

	updatePreviewIFrame() {
		this.previewIFrame = document.getElementById("previewIFrame")

		if (this.previewIFrame && this.folderName) {
			this.previewIFrame.src = `/${this.folderName}`
		} else {
			console.error("Preview iframe not found or folder name is missing")
		}

		const serverName = window.location.hostname
		document.getElementById("folderNameLink").innerHTML = `http://${serverName}/${this.folderName}`
		document.getElementById("folderNameLink").href = this.folderName
		document.getElementById("gitClone").innerHTML = `git clone http://${serverName}/git/${this.folderName} --origin scrollhub`
		document.title = `Editing ${serverName}/${this.folderName}`
	}

	fetchAndDisplayFileList() {
		if (!this.folderName) {
			console.error("Folder name is missing")
			return
		}

		fetch(`/ls${this.auth}`)
			.then(response => {
				if (!response.ok) {
					throw new Error(response.text())
				}
				return response.text()
			})
			.then(data => {
				const files = data.split("\n")
				this.updateFileList(files)
			})
			.catch(error => {
				console.error("There was a problem with the fetch operation:", error.message)
			})
	}

	updateFileList(files) {
		const sorted = files.filter(file => !file.endsWith(".txt") && !file.endsWith(".html"))
		// sort by scroll files first, and then everything else

		const fileLinks = sorted.map(file =>
			file.endsWith(".scroll") || file.endsWith(".parsers")
				? `<a href="edit.html?folderName=${encodeURIComponent(this.folderName)}&fileName=${encodeURIComponent(file)}">${file}</a>`
				: `<a class="nonScrollFile" target="preview" href="/${this.folderName}/${file}">${file}</a>`
		)
		this.fileList.innerHTML = fileLinks.join("<br>") + `<br><br><a class="createButton" onclick="app.createFileCommand()">+</a>`
	}

	createFileCommand() {
		const fileName = prompt("Enter a filename", "untitled")
		if (!fileName) return ""
		const { folderName } = this
		const filePath = `${folderName}/${fileName.replace(".scroll", "") + ".scroll"}`
		window.location = `write?content=&folderName=${encodeURIComponent(folderName)}&filePath=${encodeURIComponent(filePath)}`
	}

	setFileContent(value) {
		this.fileEditor.value = value
		this.codeMirrorInstance.setValue(value)
	}

	get auth() {
		return `?folderName=${this.folderName}&`
	}

	loadFileContent() {
		if (!this.folderName || !this.fileName) {
			console.error("Folder name or file name is missing")
			return
		}

		const filePath = `${this.folderName}/${this.fileName}`

		fetch(`/read${this.auth}filePath=${encodeURIComponent(filePath)}`)
			.then(response => {
				if (!response.ok) throw new Error("Network response was not ok")

				return response.text()
			})
			.then(content => this.setFileContent(content))
			.catch(error => console.error("There was a problem reading the file:", error.message))
	}
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => (window.app = new EditorApp().main()))
