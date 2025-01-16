const el = document.getElementById("errorMessage")
const params = new URLSearchParams(window.location.search)
const errorMessage = params.get("errorMessage") || ""
el.textContent = errorMessage
el.style.display = errorMessage ? "block" : "none"
const folderName = params.get("folderName") || ""
const inputEl = document.getElementById("folderName")
if (folderName) inputEl.value = folderName
inputEl.focus()
class CreateFromZipper {
  main() {
    this.bindFileDrop()
    return this
  }
  bindFileDrop() {
    const dropZone = document.querySelector("body")
    dropZone.addEventListener("dragover", this.handleDragOver.bind(this))
    dropZone.addEventListener("dragleave", this.handleDragLeave.bind(this))
    dropZone.addEventListener("drop", this.handleDrop.bind(this))
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

  showSpinner(message, style = "") {
    document.querySelector("#spinner").innerHTML = `<span${style}>${message}</span>`
    document.querySelector("#spinner").style.display = "block"
  }

  hideSpinner() {
    document.querySelector("#spinner").style.display = "none"
  }

  async uploadFiles(files) {
    this.showSpinner("Uploading...")

    try {
      // Check if it's a single zip file
      if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
        await this.uploadZipFile(files[0])
      } else {
        // Handle multiple files or single non-zip file
        await this.uploadMultipleFiles(files)
      }

      this.hideSpinner()
    } catch (error) {
      console.error("Error uploading files:", error)
      alert("Error uploading files: " + error)
      this.hideSpinner()
    }
  }

  async uploadZipFile(file) {
    const formData = new FormData()
    formData.append("zipFile", file)

    const response = await fetch("/createFolderFromZip.htm", {
      method: "POST",
      body: formData
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || "Network response was not ok")
    }

    const data = await response.text()
    window.location = `/edit.html?folderName=${data}&command=showWelcomeMessageCommand`
  }

  async uploadMultipleFiles(files) {
    const formData = new FormData()

    // Append all files to the form data
    Array.from(files).forEach(file => {
      // Use the full path if available (for folders), otherwise just the file name
      const filePath = file.webkitRelativePath || file.name
      formData.append("files[]", file, filePath)
    })

    const response = await fetch("/createFolderFromFiles.htm", {
      method: "POST",
      body: formData
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || "Network response was not ok")
    }

    const data = await response.text()
    window.location = `/edit.html?folderName=${data}&command=showWelcomeMessageCommand`
  }
}

const zipper = new CreateFromZipper().main()
