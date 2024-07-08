class EditorApp {
	constructor() {
		this.folderName = ""
		this.previewIFrame = null
		this.fileList = null
	}

	main() {
		const urlParams = new URLSearchParams(window.location.search)
		this.folderName = urlParams.get("folderName")
		this.fileName = urlParams.get("fileName")

		if (!this.folderName) {
			console.error("Folder name not provided in the query string")
		}

		this.updatePreviewIFrame()
		this.fileList = document.getElementById("fileList")
		this.fetchAndDisplayFileList()

		this.filePathInput = document.getElementById("filePathInput")
		this.fileEditor = document.getElementById("fileEditor")
		this.updateFilePathInput()
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
	}

	fetchAndDisplayFileList() {
		if (!this.folderName) {
			console.error("Folder name is missing")
			return
		}

		fetch(`/ls/${this.folderName}`)
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
		if (!this.fileList) {
			console.error("File list element not found")
			return
		}

		const fileLinks = files.map(file => {
			return `<a href="edit.html?folderName=${encodeURIComponent(this.folderName)}&fileName=${encodeURIComponent(file)}">${file}</a>`
		})

		this.fileList.innerHTML = fileLinks.join("<br>") + `<br><br><a class="createButton" onclick="app.createFileCommand()">+</a>`
	}

	createFileCommand() {
		const fileName = prompt("Enter a filename", "untitled")
		if (!fileName) return ""
		window.location = `edit.html?folderName=${encodeURIComponent(this.folderName)}&fileName=${encodeURIComponent(fileName.replace(".scroll", "") + ".scroll")}`
	}

	updateFilePathInput() {
		if (!this.folderName || !this.fileName) {
			console.error("File path input not found or folder/file name is missing")
			return
		}

		this.filePathInput.value = `${this.folderName}/${this.fileName}`
	}

	loadFileContent() {
		if (!this.folderName || !this.fileName) {
			console.error("Folder name or file name is missing")
			return
		}

		const filePath = `${this.folderName}/${this.fileName}`

		fetch(`/read/${encodeURIComponent(filePath)}`)
			.then(response => {
				if (!response.ok) {
					throw new Error("Network response was not ok")
				}
				return response.text()
			})
			.then(content => {
				if (this.fileEditor) {
					this.fileEditor.value = content
				} else {
					console.error("File editor textarea not found")
				}
			})
			.catch(error => {
				console.error("There was a problem reading the file:", error.message)
			})
	}
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => (window.app = new EditorApp().main()))
