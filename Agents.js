const { Anthropic } = require("@anthropic-ai/sdk")
const fs = require("fs")
const path = require("path")
const OpenAI = require("openai")

class AbstractPrompt {
  constructor(userPrompt, existingNames) {
    this.userPrompt = userPrompt
    this.existingNames = existingNames
  }
  setResponse(response) {
    this.response = response
    return this
  }
}

class SimpleCreationPrompt extends AbstractPrompt {
  get systemPrompt() {
    return `You are an expert web developer. Create a website based on this request: "${this.userPrompt}"

Requirements:
- Use only Scroll, vanilla HTML, CSS, and JavaScript (NO frameworks, NO external dependencies)
- Create clean, semantic HTML5
- Make it mobile-responsive
- Follow modern best practices and accessibility guidelines
- Keep it simple but professional
- Include basic SEO meta tags using Scroll
- Use only relative links and no external resources
- Do not put a copyright symbol or all rights reserved in the footer.
- Make it beautiful. Dazzling. Advanced used of CSS.

First suggest a short, memorable domain name ending in .scroll.pub that represents this website. Then provide the website files. Use this exact format:

---domain---
(domain.scroll.pub here)
---index.scroll---
buildHtml
baseUrl https://(domain.scroll.pub here)
metaTags
editButton /edit.html
title (Title here)
style.css
body.html
script.js
---body.html---
(HTML body content here)
---style.css---
(CSS content here)
---script.js---
(JavaScript content here)
---end---`
  }

  get parsedResponse() {
    const { response } = this
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
    while (this.existingNames.includes(finalDomain)) {
      const baseName = suggestedDomain.replace(".scroll.pub", "")
      finalDomain = `${baseName}${counter}.scroll.pub`
      counter++
    }

    // Add a default README
    files["readme.scroll"] = `# ${finalDomain}\nWebsite generated from prompt: ${this.userPrompt}`

    return {
      folderName: finalDomain,
      files
    }
  }
}

class AbstractAgent {}

class Claude extends AbstractAgent {
  constructor(apiKey) {
    super(apiKey)
    this.client = new Anthropic({
      apiKey
    })
  }
  async do(prompt) {
    console.log("Sending prompt to claude")
    const { client } = this
    // Call Claude API
    const completion = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt.systemPrompt }]
    })

    // Parse Claude's response into domain and files
    const response = completion.content[0].text
    return prompt.setResponse(response)
  }
}

class OpenAIAgent extends AbstractAgent {}

class DeepSeek extends AbstractAgent {
  constructor(apiKey) {
    super(apiKey)
    this.openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey
    })
  }
  async do(prompt) {
    console.log("Sending prompt to deepseek")
    const completion = await this.openai.chat.completions.create({
      messages: [{ role: "system", content: prompt.systemPrompt }],
      model: "deepseek-chat"
    })
    const response = completion.choices[0].message.content
    return prompt.setResponse(response)
  }
}

const AgentClasses = { claude: Claude, deepseek: DeepSeek, openai: OpenAIAgent }

class Agents {
  constructor(keyFolder) {
    this.keyFolder = keyFolder
    this.agents = {}
    this.availableAgents.forEach(agent => this.loadAgent(agent))
  }

  availableAgents = "claude deepseek".split(" ")

  loadAgent(name) {
    const { keyFolder } = this
    const keyPath = path.join(keyFolder, `${name}.txt`)
    if (!fs.existsSync(keyPath)) {
      console.log(`No ${name} API key found. Skipping ${name} agent`)
      return
    }
    const apiKey = fs.readFileSync(keyPath, "utf8").trim()
    const agentConstructor = AgentClasses[name]
    this.agents[name] = new agentConstructor(apiKey)
  }

  get allAgents() {
    return Object.values(this.agents)
  }

  async createFolderNameAndFilesFromPrompt(userPrompt, existingNames, agentName) {
    const agent = this.agents[agentName] || this.allAgents[0]
    const prompt = new SimpleCreationPrompt(userPrompt, existingNames)
    await agent.do(prompt)
    return prompt.parsedResponse
  }

  // todo: wire this up
  async createMultipleFoldersFromPrompt(userPrompt, existingNames) {
    return await Promise.all(
      this.allAgents.map(async agent => {
        const prompt = new SimpleCreationPrompt(userPrompt, existingNames)
        await agent.do(prompt)
        return prompt
      })
    )
  }
}

module.exports = { Agents }
