const { Anthropic } = require("@anthropic-ai/sdk")
const fs = require("fs")
const path = require("path")
const OpenAI = require("openai")
const { Particle } = require("scrollsdk/products/Particle.js")

class FolderPrompt {
  constructor(userPrompt, existingFolders, agent, whatKind, domainSuffix) {
    this.userPrompt = userPrompt
    this.existingFolders = existingFolders
    this.agent = agent
    this.what = whatKind
    this.domainSuffix = "." + domainSuffix.replace(/^\./, "")
    this.systemPrompt = this.makePrompt(userPrompt, domainSuffix)
  }
  setResponse(response) {
    this.response = response
    return this
  }

  makePrompt(userPrompt, domainSuffix) {
    const domainExpression = `(domain${domainSuffix} here)`
    const domainPrompt = `First suggest a short, memorable domain name ending in ${domainSuffix} that represents this website. Then provide the website files. Use this exact format:

---domain---
${domainExpression}`
    let basePrompt = fs.readFileSync(path.join(__dirname, "prompts", this.what + ".scroll"), "utf8")
    basePrompt = basePrompt.replaceAll("USER_PROMPT", userPrompt)
    basePrompt = basePrompt.replaceAll("DOMAIN_PROMPT", domainPrompt)
    basePrompt = basePrompt.replaceAll("DOMAIN_EXPRESSION", domainExpression)
    return basePrompt
  }

  setDebugLog(completion) {
    this.completion = completion
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

    // sometimes LLMs are returning junk with spaces and newlines etc
    suggestedDomain = suggestedDomain.split(" ")[0].split("\n")[0]

    if (!suggestedDomain) suggestedDomain = "error"

    const { domainSuffix } = this
    // Ensure the suggested domain ends with domainSuffix
    if (!suggestedDomain.endsWith(domainSuffix)) suggestedDomain = suggestedDomain.replace(domainSuffix, "") + domainSuffix

    // If domain is taken, add numbers until we find a free one
    let finalDomain = suggestedDomain
    let counter = 1
    while (this.existingFolders[finalDomain]) {
      const baseName = suggestedDomain.replace(domainSuffix, "")
      finalDomain = `${baseName}${counter}${domainSuffix}`
      counter++
    }

    // Add a default README
    files["readme.scroll"] = `# ${finalDomain}

Prompt: ${this.what}
Agent: ${this.agent.name}
Model: ${this.agent.model}

## User prompt
${this.userPrompt}

## System prompt
${this.systemPrompt}`

    return {
      folderName: finalDomain,
      files
    }
  }
}

class AbstractAgent {
  constructor(apiKey, hubFolder) {
    this.apiKey = apiKey
    this.hubFolder = hubFolder
  }
}

class Claude extends AbstractAgent {
  get client() {
    if (!this._client)
      this._client = new Anthropic({
        apiKey: this.apiKey
      })
    return this._client
  }
  name = "claude"
  model = "claude-3-5-sonnet-20241022"
  async do(prompt) {
    console.log("Sending prompt to claude")
    const { client } = this
    // Call Claude API
    const completion = await client.messages.create({
      model: this.model,
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt.systemPrompt }]
    })
    // Parse Claude's response into domain and files
    const response = completion.content[0].text
    prompt.setDebugLog(completion)
    return prompt.setResponse(response)
  }
}

class DeepSeek extends AbstractAgent {
  get client() {
    if (!this._client)
      this._client = new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: this.apiKey
      })
    return this._client
  }
  model = "deepseek-chat"
  name = "deepseek"
  async do(prompt) {
    console.log("Sending prompt to deepseek")
    const completion = await this.client.chat.completions.create({
      messages: this.getMessages(prompt),
      model: this.model
    })
    const response = completion.choices[0].message.content
    prompt.setDebugLog(completion)
    return prompt.setResponse(response)
  }

  getMessages(prompt) {
    return [{ role: "system", content: prompt.systemPrompt }]
  }
}

class DeepSeekReasoner extends DeepSeek {
  model = "deepseek-reasoner"
  name = "deepseekreasoner"

  getMessages(prompt) {
    return [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt }
    ]
  }
}

class Agents {
  constructor(hub) {
    this.hubFolder = hub.hubFolder
    this.config = hub.config
    this.agents = {}
    const availableAgents = "deepseek claude".split(" ")
    availableAgents.forEach(agent => this.loadAgent(agent))
  }

  loadAgent(name) {
    const { hubFolder } = this
    const apiKey = this.config.get(name)
    if (!apiKey) {
      console.log(`No ${name} API key found. Skipping ${name} agent`)
      return
    } else {
      console.log(`${name} agent loaded.`)
    }
    const AgentClasses = { claude: [Claude], deepseek: [DeepSeek, DeepSeekReasoner] }
    const agentConstructors = AgentClasses[name]
    agentConstructors.forEach(con => {
      const agent = new con(apiKey, hubFolder)
      this.agents[agent.name] = agent
    })
  }

  get allAgents() {
    return Object.values(this.agents)
  }

  async createFolderNameAndFilesFromPrompt(userPrompt, existingFolders, agentName, promptTemplate, domainSuffix) {
    const agent = this.agents[agentName] || this.allAgents[0]
    const prompt = new FolderPrompt(userPrompt, existingFolders, agent, promptTemplate, domainSuffix)
    if (!agent) throw new Error(`Agent ${agentName} not found. Is API key set?`)
    await agent.do(prompt)
    return prompt
  }

  // todo: wire this up
  async createMultipleFoldersFromPrompt(userPrompt, existingFolders) {
    return await Promise.all(
      this.allAgents.map(async agent => {
        const prompt = new SimpleCreationPrompt(userPrompt, existingFolders)
        await agent.do(prompt)
        return prompt
      })
    )
  }
}

module.exports = { Agents }
