class App {
  constructor() {
    this.statusDiv = document.getElementById("status")
    this.contextDiv = document.getElementById("contextData")
    this.buttons = ["contextBtn", "urlBtn", "closeBtn", "testBtn"].map(id => document.getElementById(id))
    this.isSDKLoaded = false
  }

  setStatus(message) {
    if (this.statusDiv) {
      this.statusDiv.innerText = message
    }
  }

  enableButtons() {
    this.buttons.forEach(btn => {
      if (btn) btn.disabled = false
    })
  }

  get sdk() {
    return jframe.sdk
  }

  async start() {
    try {
      await this.sdk.actions.ready()
      this.isSDKLoaded = true
      this.setStatus("Frame is ready!")
      this.enableButtons()

      this.sdk.on("primaryButtonClicked", () => {
        this.setStatus("Primary button was clicked!")
      })
    } catch (error) {
      this.setStatus(`Error initializing frame: ${error.message}`)
    }
  }

  async getContext() {
    if (!this.isSDKLoaded) return
    try {
      const context = await this.sdk.context
      if (this.contextDiv) {
        this.contextDiv.innerHTML = `
          <h3>Frame Context:</h3>
          <pre>${JSON.stringify(context, null, 2)}</pre>
        `
      }
    } catch (error) {
      this.setStatus(`Error getting context: ${error.message}`)
    }
  }

  openUrl() {
    if (!this.isSDKLoaded) return
    try {
      this.sdk.actions.openUrl("https://www.farcaster.xyz")
      this.setStatus("Opening URL...")
    } catch (error) {
      this.setStatus(`Error opening URL: ${error.message}`)
    }
  }

  closeFrame() {
    if (!this.isSDKLoaded) return
    try {
      this.sdk.actions.close()
      this.setStatus("Closing frame...")
    } catch (error) {
      this.setStatus(`Error closing frame: ${error.message}`)
    }
  }

  testPrimaryButton() {
    if (!this.isSDKLoaded) return
    try {
      this.sdk.actions.setPrimaryButton({
        text: "Click Me!",
        loading: false,
        disabled: false
      })
      this.setStatus("Primary button set - try clicking it!")
    } catch (error) {
      this.setStatus(`Error setting primary button: ${error.message}`)
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.app = new App()
  window.app.start()
})
