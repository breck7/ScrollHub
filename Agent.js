const { Anthropic } = require("@anthropic-ai/sdk")

class Agent {
  constructor(apiKey) {
    this.client = new Anthropic({
      apiKey: apiKey
    })
  }

  /**
   * Creates website files from a user prompt
   * @param {string} prompt - User's website request
   * @param {string[]} existingNames - Array of taken domain names
   * @returns {Promise<{folderName: string, files: Object.<string, string>}>}
   */
  async createFolderNameAndFilesFromPrompt(prompt, existingNames) {
    // Construct a detailed prompt for Claude
    const systemPrompt = `You are an expert web developer. Create a website based on this request: "${prompt}"

Requirements:
- Use only vanilla HTML, CSS, and JavaScript (NO frameworks, NO external dependencies)
- Create clean, semantic HTML5
- Make it mobile-responsive
- Follow modern best practices and accessibility guidelines
- Keep it simple but professional
- Include basic SEO meta tags
- Use only relative links and no external resources
- Do not put a copyright symbol or all rights reserved in the footer.
- Make it beautiful. Dazzling. Advanced used of CSS.

First suggest a short, memorable domain name ending in .scroll.pub that represents this website. Then provide the website files. Use this exact format:

---domain---
(domain.scroll.pub here)
---index.html---
(HTML content here)
---style.css---
(CSS content here)
---script.js---
(JavaScript content here)
---end---`

    // Call Claude API
    const completion = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: "user", content: systemPrompt }]
    })

    // Parse Claude's response into domain and files
    const response = completion.content[0].text
    const files = {}

    let currentFile = null
    let currentContent = []
    let suggestedDomain = ""

    for (const line of response.split("\n")) {
      if (line.startsWith("---") && line.endsWith("---")) {
        if (currentFile === "domain" && currentContent.length > 0) {
          suggestedDomain = currentContent.join("").trim()
        } else if (currentFile && currentContent.length > 0) {
          files[currentFile] = currentContent.join("\n")
        }
        currentContent = []
        const fileName = line.replace(/---/g, "")
        if (fileName === "end") break
        currentFile = fileName
      } else if (currentFile) {
        currentContent.push(line)
      }
    }

    // Ensure the suggested domain ends with .scroll.pub
    if (!suggestedDomain.endsWith(".scroll.pub")) {
      suggestedDomain = suggestedDomain.replace(/\.scroll\.pub.*$/, "") + ".scroll.pub"
    }

    // If domain is taken, add numbers until we find a free one
    let finalDomain = suggestedDomain
    let counter = 1
    while (existingNames.includes(finalDomain)) {
      const baseName = suggestedDomain.replace(".scroll.pub", "")
      finalDomain = `${baseName}${counter}.scroll.pub`
      counter++
    }

    // Add a default README
    files["README.md"] = `# ${finalDomain}\nWebsite generated from prompt: ${prompt}`

    return {
      folderName: finalDomain,
      files
    }
  }
}

module.exports = { Agent }
