class EditorApp {
	constructor() {
		this.folderName = ""
		this.previewIFrame = null
		this.fileList = null
	}

	main() {
		this.getFolderNameFromQueryString()
		this.updatePreviewIFrame()
		this.fileList = document.getElementById("fileList")
		this.fetchAndDisplayFileList()
	}

	getFolderNameFromQueryString() {
		const urlParams = new URLSearchParams(window.location.search)
		this.folderName = urlParams.get("folderName")

		if (!this.folderName) {
			console.error("Folder name not provided in the query string")
		}
	}

	updatePreviewIFrame() {
		this.previewIFrame = document.getElementById("previewIFrame")

		if (this.previewIFrame && this.folderName) {
			this.previewIFrame.src = `/${this.folderName}`
		} else {
			console.error("Preview iframe not found or folder name is missing")
		}

		document.getElementById("folderNameLink").innerHTML = this.folderName
		document.getElementById("folderNameLink").href = this.folderName
	}

	fetchAndDisplayFileList() {
		if (!this.folderName) {
			console.error("Folder name is missing")
			return
		}

		fetch(`/ls/${this.folderName}`)
			.then((response) => {
				if (!response.ok) {
					throw new Error("Network response was not ok")
				}
				return response.text()
			})
			.then((data) => {
				const files = data.split("\n")
				this.updateFileList(files)
			})
			.catch((error) => {
				console.error(
					"There was a problem with the fetch operation:",
					error.message,
				)
			})
	}

	updateFileList(files) {
		if (!this.fileList) {
			console.error("File list element not found")
			return
		}

		const fileLinks = files.map((file) => {
			return `<a href="edit.html?folderName=${encodeURIComponent(
				this.folderName,
			)}&fileName=${encodeURIComponent(file)}">${file}</a>`
		})

		this.fileList.innerHTML = fileLinks.join("<br>")
	}
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
	new EditorApp().main()
})
