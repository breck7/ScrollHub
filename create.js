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

  showSpinner(message, style) {
    document.querySelector("#spinner").innerHTML = `<span${style}>${message}</span>`
    document.querySelector("#spinner").style.display = "block"
  }
  hideSpinner() {
    document.querySelector("#spinner").style.display = "none"
  }

  // New method to handle multiple file uploads
  uploadFiles(files) {
    this.showSpinner("Uploading...")
    const uploadPromises = Array.from(files).map(file => this.uploadFile(file))

    Promise.all(uploadPromises)
      .then(() => {
        console.log("All files uploaded successfully")
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
    formData.append("zipFile", file)

    try {
      const response = await fetch("/createFromZip.htm", {
        method: "POST",
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Network response was not ok")
      }

      const data = await response.text()
      window.location = `/edit.html?folderName=${data}`
    } catch (error) {
      console.error("Error uploading file:", error.message)
      throw error // Re-throw the error if you want calling code to handle it
    }
  }
}

const zipper = new CreateFromZipper().main()
