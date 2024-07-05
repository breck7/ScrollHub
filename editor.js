class EditorApp {
	constructor() {
		this.folderName = ""
		this.previewIFrame = null
	}

	main() {
		this.getFolderNameFromQueryString()
		this.updatePreviewIFrame()
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
}

// Initialize the app when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
	new EditorApp().main()
})
