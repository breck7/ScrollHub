// Constants for localStorage keys and selectors
const STORAGE_KEY = "promptSettings"
const SELECTORS = {
  agentSelect: "#aiModelSelect",
  tldSelect: "#tldSelect",
  form: "#createForm",
  agentInput: 'input[name="agent"]',
  tldInput: 'input[name="tld"]'
}

// Settings handler class
class SettingsHandler {
  constructor() {
    this.agentSelect = document.querySelector(SELECTORS.agentSelect)
    this.tldSelect = document.querySelector(SELECTORS.tldSelect)
    this.form = document.querySelector(SELECTORS.form)
    this.agentInput = this.form.querySelector(SELECTORS.agentInput)
    this.tldInput = this.form.querySelector(SELECTORS.tldInput)

    this.initializeEventListeners()
    this.rehydrateSettings()
  }

  initializeEventListeners() {
    // Handle agent selection change
    this.agentSelect.addEventListener("change", e => {
      const agent = e.target.value.toUpperCase()
      this.agentInput.value = agent
      this.saveSettings()
    })

    // Handle TLD selection change
    this.tldSelect.addEventListener("change", e => {
      const tld = e.target.value
      this.tldInput.value = tld
      this.saveSettings()
    })
  }

  saveSettings() {
    const settings = {
      agent: this.agentSelect.value,
      tld: this.tldSelect.value
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }

  rehydrateSettings() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY)
      if (savedSettings) {
        const settings = JSON.parse(savedSettings)

        // Restore agent selection
        if (settings.agent) {
          this.agentSelect.value = settings.agent
          this.agentInput.value = settings.agent.toUpperCase()
        }

        // Restore TLD selection
        if (settings.tld) {
          this.tldSelect.value = settings.tld
          this.tldInput.value = settings.tld
        }
      }
    } catch (error) {
      console.error("Error rehydrating settings:", error)
    }
  }
}

// Initialize settings handler when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new SettingsHandler()
})
