class EditorApp {
	constructor() {
		this.folderName = ""
		this.password = ""
		this.previewIFrame = null
		this.fileList = null
		const scrollParser = new HandParsersProgram(AppConstants.parsers).compileAndReturnRootParser()
		this.codeMirrorInstance = new ParsersCodeMirrorMode("custom", () => scrollParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("fileEditor"), {
			lineWrapping: false,
			lineNumbers: false
		})
		this.codeMirrorInstance.setSize(600, 360) // todo: adjust on resize
	}

	main() {
		const urlParams = new URLSearchParams(window.location.search)
		this.folderName = urlParams.get("folderName")
		this.fileName = urlParams.get("fileName")
		this.password = urlParams.get("password")

		if (!this.folderName) console.error("Folder name not provided in the query string")
		if (!this.password) console.error("Password not provided in the query string")

		this.updatePreviewIFrame()
		this.fileList = document.getElementById("fileList")
		this.fetchAndDisplayFileList()

		this.fileEditor = document.getElementById("fileEditor")
		document.getElementById("filePathInput").value = `${this.folderName}/${this.fileName}`
		document.getElementById("password").value = this.password
		document.getElementById("folderNameInput").value = this.folderName
		this.loadFileContent()
		return this
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
		document.getElementById("gitClone").innerHTML = `git clone http://${serverName}/git/${this.folderName}`

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
					throw new Error("Network response was not ok")
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
		const fileLinks = files.map(file => `<a href="edit.html?folderName=${encodeURIComponent(this.folderName)}&fileName=${encodeURIComponent(file)}&password=${this.password}">${file}</a>`)
		this.fileList.innerHTML = fileLinks.join("<br>") + `<br><br><a class="createButton" onclick="app.createFileCommand()">+</a>`
	}

	createFileCommand() {
		const fileName = prompt("Enter a filename", "untitled")
		if (!fileName) return ""
		window.location = `edit.html?folderName=${encodeURIComponent(this.folderName)}&password=${this.password}&fileName=${encodeURIComponent(fileName.replace(".scroll", "") + ".scroll")}`
	}

	setFileContent(value) {
		this.fileEditor.value = value
		this.codeMirrorInstance.setValue(value)
	}

	get auth() {
		return `?folderName=${this.folderName}&password=${this.password}&`
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
