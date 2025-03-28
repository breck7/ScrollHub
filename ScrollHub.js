// STDLib
const { exec, execSync, spawn } = require("child_process")
const fs = require("fs")
const v8 = require("v8")
const fsp = require("fs").promises
const os = require("os")
const dns = require("dns").promises
const path = require("path")
const util = require("util")
const crypto = require("crypto")
const execAsync = util.promisify(exec)

// Web server
const express = require("express")
const compression = require("compression")
const https = require("https")
const http = require("http")
const fileUpload = require("express-fileupload")

// Git server
const httpBackend = require("git-http-backend")

// PPS
const { Particle } = require("scrollsdk/products/Particle.js")
const { ScrollCli } = require("scroll-cli/scroll.js")
const { CloneCli } = require("scroll-cli/clone.js")
const { ScriptRunner } = require("./ScriptRunner.js")
const packageJson = require("./package.json")

// This
const { TrafficMonitor } = require("./TrafficMonitor.js")
const { CronRunner } = require("./CronRunner.js")
const { FolderIndex } = require("./FolderIndex.js")
const { Agents } = require("./Agents.js")

const exists = async filePath => {
  const fileExists = await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  return fileExists
}

const isGreaterOrEqualVersion = (version1, version2) => {
  // console.log(isGreaterOrEqualVersion("0.5.1", "0.5.0")); // true
  // console.log(isGreaterOrEqualVersion("0.5.0", "0.5.0")); // true
  // console.log(isGreaterOrEqualVersion("0.4.9", "0.5.0")); // false
  // console.log(isGreaterOrEqualVersion("1.0.0", "0.9.9")); // true
  const [major1, minor1, patch1] = version1.split(".").map(Number)
  const [major2, minor2, patch2] = version2.split(".").map(Number)

  if (major1 !== major2) return major1 >= major2
  if (minor1 !== minor2) return minor1 >= minor2
  return patch1 >= patch2
}

// todo: cleanup
const sfs = new ScrollCli().sfs
const ScrollFile = sfs.defaultFileClass
const ScrollToHtml = async scrollCode => {
  const page = new ScrollFile(scrollCode)
  await page.fuse()
  return page.scrollProgram.asHtml
}

const generateFileName = async (basePath, strategy, content) => {
  let name = "untitled.scroll"
  switch (strategy) {
    case "timestamp":
      name = Date.now() + ".scroll"
      break
    case "autoincrement":
      // Find the highest numbered file and increment
      if (!(await exists(basePath))) {
        name = `1.scroll`
        break
      }
      const files = await fsp.readdir(basePath)
      const scrollFiles = files.filter(file => file.endsWith(".scroll"))
      const numbers = scrollFiles
        .map(file => {
          const match = file.match(/^(\d+)\.scroll$/)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter(num => num > 0)

      const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1

      name = `${nextNumber}.scroll`
      break
    case "hash":
      // Generate a hash from the content or a random string
      const hash = crypto
        .createHash("md5")
        .update(content || crypto.randomBytes(16))
        .digest("hex")
        .slice(0, 10)

      name = `${hash}.scroll`
      break
    case "random":
      // Generate a random string
      const randomStr = crypto.randomBytes(8).toString("hex")
      name = `${randomStr}.scroll`
      break
    case "datetime":
      // Use formatted date and time
      const now = new Date()
      const formattedDateTime = now.toISOString().replace(/[:\.]/g, "-").slice(0, 19)

      name = `${formattedDateTime}.scroll`
      break
  }

  const fullPath = path.join(basePath, name)
  const fileExists = await exists(fullPath)

  // Recursive check to ensure unique filename
  if (fileExists) throw new Error(`File ${fullPath} exists`)

  return fullPath
}

const requestsFile = folderName => `title Traffic Data
metaTags
homeButton
buildHtml
theme gazette

printTitle

container

Real time view
 /globe.html?folderName=${folderName}

scrollButton Refresh
 link /summarizeRequests.htm?folderName=${folderName}
 post
  // Anything

.requests.csv
 <br><br><span style="width: 200px; display:inline-block; color: blue;">Readers</span><span style="color:green;">Writers</span><br><br>
 sparkline
  y Readers
  color blue
  width 200
  height 200
 sparkline
  y Writers
  color green
  width 200
  height 200
 printTable

tableSearch
scrollVersionLink
`

express.static.mime.define({ "text/plain": ["scroll", "parsers"] })
express.static.mime.define({ "text/plain": ["ssv", "psv", "tsv", "csv"] })

const parseUserAgent = userAgent => {
  if (!userAgent) return "Unknown"

  // Extract browser and OS
  const browser = userAgent.match(/(Chrome|Safari|Firefox|Edge|Opera|MSIE|Trident)[\/\s](\d+)/i)
  const os = userAgent.match(/(Mac OS X|Windows NT|Linux|Android|iOS)[\/\s]?(\d+[\._\d]*)?/i)

  let result = []
  if (browser) result.push(browser[1] + (browser[2] ? "." + browser[2] : ""))
  if (os) result.push(os[1].replace(/ /g, "") + (os[2] ? "." + os[2].replace(/_/g, ".") : ""))

  return result.join(" ") || "Other"
}

const isUrl = str => str.startsWith("http://") || str.startsWith("https://")

// todo: clean this up. add all test cases
const sanitizeFolderName = name => {
  name = name.replace(/\.git$/, "")
  // if given a url, return the last part
  // given http://hub.com/foo returns foo
  // given http://hub.com/foo.git returns foo
  if (isUrl(name)) {
    try {
      const url = new URL(name)
      const { hostname, pathname } = url
      // given http://hub.com/ return hub.com
      name = pathname.split("/").pop()
      if (!name) return hostname
      return name.toLowerCase().replace(/[^a-z0-9._]/g, "")
    } catch (err) {
      console.error(err)
    }
  }
  name = name.split("/").pop()
  return name.toLowerCase().replace(/[^a-z0-9._]/g, "")
}

const sanitizeFileName = name => {
  // Split path into components and filter out empty parts and parent directory attempts
  const parts = name.split("/").filter(part => {
    // Remove empty parts and any parts containing ".."
    return part && !part.includes("..")
  })

  // Sanitize each remaining path component
  const sanitizedParts = parts.map(part => part.replace(/[^a-zA-Z0-9._\-]/g, ""))

  // If we end up with no valid parts, return empty string
  if (sanitizedParts.length === 0) return ""

  // Rejoin with forward slashes
  return sanitizedParts.join("/")
}

const sampleConfig = `// Sample config options below. Uncomment and fill out to use.
// wildcard *.example.com /etc/letsencrypt/live/example.com/fullchain.pem /etc/letsencrypt/live/example.com/privkey.pem
// claude [anthropic api key]
// deepseek [deepseek api key]`

// todo: improve Scroll to clean this up
const sampleCreate = `div
 class promptSettings
 select
  id aiModelSelect
  option Deepseek
   value deepseek
  option DSReasoner
   value deepseekreasoner
  option Claude
   value claude
 select
  id tldSelect
  option Scroll.pub
   value scroll.pub
  option Powerhouse.wiki
   value powerhouse.wiki
  option FrameHub.pro
   value framehub.pro`

class ScrollHub {
  constructor(dir = path.join(os.homedir(), "folders")) {
    this.app = express()
    const app = this.app
    this.port = 80
    this.maxUploadSize = 100 * 1000 * 1024
    this.requestsServed = 0
    this.startCpuUsage = process.cpuUsage()
    this.lastCpuUsage = this.startCpuUsage
    this.lastCpuCheck = Date.now()
    this.hostname = os.hostname()
    this.wildCardCerts = []
    this.rootFolder = dir
    const hubFolder = path.join(dir, ".hub")
    this.hubFolder = hubFolder
    this.configPath = path.join(hubFolder, `config.scroll`)
    this.publicFolder = path.join(hubFolder, "public")
    this.trashFolder = path.join(hubFolder, "trash")
    this.globalLogFile = path.join(hubFolder, ".global.log.txt")
    this.slowLogFile = path.join(hubFolder, ".slow.txt")
    this.storyLogFile = path.join(hubFolder, ".writes.txt")
    this.folderCache = {}
    this.sseClients = new Set()
    this.folderIndex = new FolderIndex(this)
    this.trafficMonitor = new TrafficMonitor(this.globalLogFile, this.hubFolder)
    this.version = packageJson.version
  }

  async getServerPublicIpsFromDNS() {
    try {
      const resolver = new dns.Resolver()
      resolver.setServers(["8.8.8.8"])
      return await resolver.resolve4(this.hostname)
    } catch (err) {
      console.error(err)
      return []
    }
  }

  async startAll() {
    const { rootFolder } = this
    const lastFolder = rootFolder.split("/").pop()
    process.title = process.title + ` ScrollHub ${lastFolder}`
    this.startTime = Date.now()

    await this.ensureInstalled()
    this.config = Particle.fromDisk(this.configPath)

    this.serverIps = Object.values(os.networkInterfaces())
      .flat()
      .map(iface => iface.address)
      .filter(ip => !ip.includes("::")) // Filter IPv6

    const publicIps = await this.getServerPublicIpsFromDNS()
    console.log("Public IPs from DNS: " + JSON.stringify(publicIps))
    this.serverIps = this.serverIps.concat(publicIps)

    this.ensureTemplatesInstalled()
    this.warmFolderCache()
    this.initVandalProtection()
    this.enableCompression()
    this.enableCors()
    this.enableFormParsing()
    this.enableFileUploads()

    this.initAnalytics()
    this.addStory({ ip: "admin" }, `started ScrollHub v${this.version}`)
    console.log(`ScrollHub version: ${this.version}`)
    console.log(`Serving all folders in: ${this.rootFolder}`)
    console.log(`Saving runtime data in: ${this.hubFolder}`)
    console.log(`Max memory: ${v8.getHeapStatistics().heap_size_limit / 1024 / 1024} MB`)

    this.initFileRoutes()
    this.initAIRoutes()
    this.initGitRoutes()
    this.initHistoryRoutes()
    this.initZipRoutes()
    this.initCommandRoutes()
    this.initSSERoute()
    this.initCloneRoute()
    this.initScriptRunner()

    this.enableStaticFileServing()

    this.servers = []
    if (!this.isLocalHost) this.servers.push(this.startHttpsServer())

    this.servers.push(this.startHttpServer())
    this.init404Routes()
    this.cronRunner = new CronRunner(this).start()
    return this
  }

  initCloneRoute() {
    const { folderCache, app } = this
    app.get("/clone", (req, res) => {
      const folderName = this.getFolderName(req)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const html = `<!DOCTYPE html>
<html>
<head>
 <title>Clone ${folderName}</title>
 <style>
   body { margin: 0; }
   iframe { width: 100%; height: 100vh; border: none; }
   .clone-btn { 
     position: fixed; 
     top: 50%; 
     left: 50%;
     transform: translate(-50%, -50%);
     z-index: 100; 
     padding: 30px 60px;
     background: #0066cc; 
     color: white;
     border: none; 
     border-radius: 8px;
     cursor: pointer;
     font-size: 24px;
     font-weight: bold;
     box-shadow: 0 4px 12px rgba(0,0,0,0.2);
     transition: all 0.2s;
   }
   .clone-btn:hover { 
     background: #0052a3;
     transform: translate(-50%, -50%) scale(1.05);
   }
 </style>
</head>
<body>
 <button class="clone-btn" onclick="cloneSite()">Clone this site</button>
 <iframe src="/${folderName}"></iframe>
 <script>
 function cloneSite() {
   fetch('/cloneFolder.htm', {
     method: 'POST',
     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
     body: 'folderName=${folderName}&redirect=false'
   })
   .then(res => res.text())
   .then(name => window.location.href = '/edit.html?folderName=' + name);
 }
 </script>
</body>
</html>`
      res.send(html)
    })
  }

  initScriptRunner() {
    this.scriptRunner = new ScriptRunner(this)
    this.scriptRunner.init()
  }

  initSSERoute() {
    const { app, globalLogFile } = this
    app.get("/.requests.htm", (req, res) => {
      const folderName = req.query?.folderName
      req.headers["accept-encoding"] = "identity"
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      })

      // Send initial ping
      res.write(": ping\n\n")

      const id = Date.now()

      const client = {
        id,
        res,
        folderName
      }

      this.sseClients.add(client)

      req.on("close", () => this.sseClients.delete(client))
    })
  }

  async broadCastMessage(folderName, log, ip) {
    if (!this.sseClients.size) return
    const geo = await this.trafficMonitor.ipToGeo(ip === "::1" ? "98.150.188.43" : ip)
    const name = (geo.regionName + "/" + geo.country).replace(/ /g, "")
    log = [log.trim(), name, geo.lat, geo.lon].join(" ")
    this.sseClients.forEach(client => {
      if (!client.folderName || client.folderName === folderName) client.res.write(`data: ${JSON.stringify({ log })}\n\n`)
    })
  }

  enableCompression() {
    this.app.use(compression())
  }

  getBaseUrlForFolder(folderName, hostname, protocol, isLocalHost) {
    // if localhost, no custom domains
    if (isLocalHost) return `/${folderName}`

    if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

    // now it might be a custom domain, serve it as if it is
    // of course, sometimes it would not be
    return protocol + "//" + folderName
  }

  enableCors() {
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

      // Handle preflight requests
      if (req.method === "OPTIONS") {
        return res.status(200).end()
      }

      next()
    })
  }

  enableFormParsing() {
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))
  }

  enableFileUploads() {
    this.app.use(fileUpload({ limits: { fileSize: this.maxUploadSize } }))
  }

  async sendFolderNotFound(res, hostname) {
    const message = `title Folder Not Found

css
 body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  max-width: 600px;
  margin: 40px auto;
  padding: 20px;
  line-height: 1.6;
 }
 h1 { color: #333; }
 .message { color: #666; }
 .suggestion { margin-top: 20px; color: #0066cc; }

# Folder Not Found

The folder "${hostname}" does not exist on this ScrollHub instance.
 link https://github.com/breck7/ScrollHub ScrollHub
 class message

If you'd like to create this folder, visit our main site to get started.
 link https://${this.hostname} our main site
 class suggestion`
    // Use 400 (Bad Request) for unknown hostname
    const html = await ScrollToHtml(message)
    res.status(400).send(html)
    return
  }

  enableStaticFileServing() {
    const { app, folderCache, rootFolder } = this

    const isRootHost = req => {
      const hostname = req.hostname?.toLowerCase()
      // If its the main hostname, serve the folders directly
      if (hostname === this.hostname || hostname === "localhost") return true
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (ipv4Regex.test(hostname))
        // treat direct IP requests as host requests
        return true
      return false
    }

    app.use((req, res, next) => {
      const hostname = req.hostname?.toLowerCase()

      // If no hostname, continue to next middleware
      if (!hostname) return next()

      // If hostname is the main server hostname, continue to next middleware
      if (isRootHost(req)) return next()

      // If the hostname requested isnt root host and doesn't exist in folderCache, return 400
      if (!folderCache[hostname]) return this.sendFolderNotFound(res, hostname)

      // If domain exists, serve from its folder
      const folderPath = path.join(rootFolder, hostname)
      express.static(folderPath, { dotfiles: "allow" })(req, res, next)
    })

    app.use((req, res, next) => {
      // On the root host, all folders are served like: rootDomain/folder/
      if (isRootHost(req)) return express.static(rootFolder, { dotfiles: "allow" })(req, res, next)
      next()
    })

    // Serve the process's public folder
    app.use(express.static(this.publicFolder, { dotfiles: "allow" }))
  }

  init404Routes() {
    const { app, rootFolder, publicFolder } = this
    //The 404 Route (ALWAYS Keep this as the last route)
    app.get("*", async (req, res) => {
      const folderName = this.getFolderName(req)
      const folderPath = path.join(rootFolder, folderName)

      const notFoundPage = path.join(folderPath, "404.html")
      await fsp
        .access(notFoundPage)
        .then(() => {
          res.status(404).sendFile(notFoundPage)
        })
        .catch(() => {
          res.status(404).sendFile(path.join(publicFolder, "404.html"))
        })
    })
  }

  isSummarizing = {}
  async buildRequestsSummary(folder = "") {
    const { rootFolder, folderCache, hubFolder } = this
    if (this.isSummarizing[folder]) return
    this.isSummarizing[folder] = true
    if (folder && !folderCache[folder]) return
    const logFile = folder ? this.getFolderLogFile(folder) : this.globalLogFile
    const outputPath = folder ? path.join(rootFolder, folder) : path.join(this.publicFolder)
    const trafficMonitor = new TrafficMonitor(logFile, hubFolder)
    await trafficMonitor.processLogFile()
    const content = folder ? trafficMonitor.csv : trafficMonitor.csvTotal
    await fsp.writeFile(path.join(outputPath, ".requests.csv"), content, "utf8")
    if (folder) {
      const reqFile = path.join(outputPath, ".requests.scroll")
      await fsp.writeFile(reqFile, requestsFile(folder), "utf8")
      await this.buildFile(reqFile)
    } else await this.buildPublicFolder()
    this.isSummarizing[folder] = false
  }

  initAnalytics() {
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    if (!fs.existsSync(this.storyLogFile)) fs.writeFileSync(this.storyLogFile, "", "utf8")
    const { app, folderCache } = this

    app.use((req, res, next) => {
      req.startTime = performance.now()

      res.on("finish", () => {
        this.logRequest(req, res)
        this.requestsServed++
      })
      next()
    })

    app.use("/summarizeRequests.htm", checkWritePermissions, async (req, res) => {
      const folderName = this.getFolderName(req)
      if (folderName) {
        await this.buildRequestsSummary(folderName)
        if (req.body.particle) return res.send("Done.")
        const base = this.getBaseUrlForFolder(folderName, req.hostname, req.protocol + ":", this.isLocalHost)
        return res.redirect(base + "/.requests.html")
      }
      await this.buildRequestsSummary()
      res.send(`Done.`)
    })

    app.get("/hostname.htm", (req, res) => res.send(req.hostname))
  }

  reqToLog(req, res) {
    const { hostname, method, url, protocol } = req
    const ip = req.ip || req.connection.remoteAddress
    const userAgent = parseUserAgent(req.get("User-Agent") || "Unknown")
    const folderName = this.getFolderName(req)
    const responseTime = ((performance.now() - req.startTime) / 1000).toFixed(1)
    return `${method === "GET" ? "read" : "write"} ${folderName || hostname} ${protocol}://${hostname}${url} ${Date.now()} ${ip} ${responseTime} ${res.statusCode} ${userAgent}\n`
  }

  async logRequest(req, res) {
    const { folderCache, globalLogFile, slowLogFile } = this
    const ip = req.ip || req.connection.remoteAddress
    const folderName = this.getFolderName(req)

    const logEntry = this.reqToLog(req, res)
    fs.appendFile(globalLogFile, logEntry, err => {
      if (err) console.error("Failed to log request:", err)
    })

    if (performance.now() - req.startTime > 1000) {
      fs.appendFile(slowLogFile, logEntry, err => {
        if (err) console.error("Failed to log slow request:", err)
      })
    }

    this.broadCastMessage(folderName, logEntry, ip)

    if (folderName && folderCache[folderName]) {
      const folderLogFile = this.getFolderLogFile(folderName)
      try {
        await fsp.appendFile(folderLogFile, logEntry)
      } catch (err) {
        console.error(`Failed to log request to folder log (${folderLogFile}):`, err)
      }
    }
  }

  getFolderLogFile(folderName) {
    const { rootFolder } = this
    const folderPath = path.join(rootFolder, folderName)
    return path.join(folderPath, ".log.txt")
  }

  initGitRoutes() {
    const { app, rootFolder } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    app.get("/:repo.git/*", (req, res) => {
      const repo = req.params.repo
      const repoPath = path.join(rootFolder, repo)
      req.url = "/" + req.url.split("/").slice(2).join("/")
      const handlers = httpBackend(req.url, (err, service) => {
        if (err) return res.end(err + "\n")
        res.setHeader("content-type", service.type)
        const ps = spawn(service.cmd, service.args.concat(repoPath))
        ps.stdout.pipe(service.createStream()).pipe(ps.stdin)
      })
      req.pipe(handlers).pipe(res)
    })

    app.post("/:repo.git/*", checkWritePermissions, async (req, res) => {
      const repo = req.params.repo
      const repoPath = path.join(rootFolder, repo)
      req.url = "/" + req.url.split("/").slice(2).join("/")
      const handlers = httpBackend(req.url, (err, service) => {
        if (err) return res.end(err + "\n")
        res.setHeader("content-type", service.type)
        const ps = spawn(service.cmd, service.args.concat(repoPath))
        ps.stdout.pipe(service.createStream()).pipe(ps.stdin)
        // Handle Git pushes asynchronously and build the scroll
        ps.on("close", async code => {
          if (code === 0 && service.action === "push") {
            const folderName = repoPath.split("/").pop()
            await this.buildFolder(folderName)
            this.addStory(req, `pushed ${repo}`)
            this.updateFolderAndBuildList(repo)
          }
        })
      })
      req.pipe(handlers).pipe(res)
    })
  }

  initHistoryRoutes() {
    const { app, rootFolder, folderCache, folderIndex } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    app.get("/revisions.htm/:folderName", async (req, res) => {
      const folderName = req.params.folderName
      const folderPath = path.join(rootFolder, folderName)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      try {
        // Get the git log asynchronously and format it as CSV
        const { stdout: gitLog } = await execAsync(`git log --pretty=format:"%h,%an,%ad,%at,%s" --date=short`, { cwd: folderPath })

        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        const header = "commit,author,date,timestamp,message\n"
        res.send(header + gitLog)
      } catch (error) {
        console.error(error)
        res.status(500).send("An error occurred while fetching the git log")
      }
    })
    app.get("/commits.htm", async (req, res) => {
      const folderName = this.getFolderName(req)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      await folderIndex.sendCommits(folderName, req.query.count || 10, res)
    })
    app.get("/commits.json", async (req, res) => {
      const folderName = this.getFolderName(req)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      const commits = await folderIndex.getCommits(folderName, req.query.count || 10)
      res.send(JSON.stringify(commits, undefined, 2))
    })

    app.get("/fileHistory.htm", async (req, res) => {
      const folderName = this.getFolderName(req)
      const filePath = req.query.filePath
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      if (!filePath) return res.status(400).send("File path is required")
      await folderIndex.sendFileHistory(folderName, filePath, req.query.count || 100, res)
    })

    app.post("/revert.htm/:folderName", checkWritePermissions, async (req, res) => {
      const folderName = req.params.folderName
      const targetHash = req.body.hash
      const folderPath = path.join(rootFolder, folderName)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      if (!targetHash || !/^[0-9a-f]{40}$/i.test(targetHash)) return res.status(400).send("Invalid target hash provided")

      try {
        // Perform the revert
        await execAsync(`git checkout ${targetHash} . && git add . && git commit ${this.getCommitAuthor(req)} -m "Reverted to ${targetHash}" --allow-empty`, { cwd: folderPath })

        this.addStory(req, `reverted ${folderName}`)

        await this.buildFolder(folderName)

        res.redirect("/commits.htm?folderName=" + folderName)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while reverting the repository:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })
  }

  getCommitAuthor(req) {
    let author = ""
    if (req.body.author?.match(/^[^<>]+\s<[^<>@\s]+@[^<>@\s]+>$/)) author = req.body.author
    else {
      const clientIp = req.ip || req.connection.remoteAddress
      const hostname = req.hostname?.toLowerCase()
      const author = `${clientIp} <${clientIp}@${hostname}>`
    }
    return `--author="${author}"`
  }

  getCloneName(folderName) {
    const { folderCache } = this
    const isSubdomain = folderName.includes(".")
    // If its a domain name, add a subdomain
    let newName = folderName
    while (folderCache[newName]) {
      // todo: would need to adjust if popular
      const rand = Math.random().toString(16).slice(2, 7)
      newName = isSubdomain ? `clone${rand}.` + folderName : folderName + rand
    }
    return newName
  }

  async exists(filePath) {
    return await exists(filePath)
  }

  async getFileList(folderName) {
    const { folderCache, rootFolder } = this
    const folderPath = path.join(rootFolder, folderName)
    const cachedEntry = folderCache[folderName]

    // Get all unique directories containing tracked files
    const directoriesSet = new Set()
    Object.keys(cachedEntry.files).forEach(file => directoriesSet.add(path.join(folderPath, path.dirname(file))))

    const files = cachedEntry.files
    for (let dir of directoriesSet) {
      const fileNames = (await fsp.readdir(dir, { withFileTypes: true })).filter(dirent => dirent.isFile() && dirent.name !== ".git" && dirent.name !== ".DS_Store").map(dirent => dirent.name)
      fileNames.forEach(file => {
        const relativePath = path.join(dir, file).replace(folderPath, "").substr(1)
        if (!files[relativePath])
          files[relativePath] = {
            versioned: false
          }
      })
    }
    return files
  }

  async handleCreateFolder(newFolderName, req, res) {
    try {
      const result = await this.createFolder(newFolderName)
      if (result.errorMessage) return this.handleCreateError(req, res, result)
      const { folderName } = result
      this.addStory(req, `created ${folderName}`)
      res.redirect(`/edit.html?folderName=${folderName}&command=showWelcomeMessageCommand`)
    } catch (error) {
      console.error(error)
      res.status(500).send("Sorry, an error occurred while creating the folder:", error)
    }
  }

  initAIRoutes() {
    const { app, folderCache } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    const agents = new Agents(this)
    app.post("/createFromPrompt.htm", checkWritePermissions, async (req, res) => {
      try {
        const prompt = req.body.prompt
        const agent = (req.body.agent || "deepseek").toLowerCase()
        const template = req.body.template
        const welcomeMessage = req.body.welcomeMessage || "scrollhub"
        const domainSuffix = req.body.tld || "scroll.pub"
        if (!prompt) return res.status(400).send("Prompt is required")

        // Generate website content from prompt
        const response = await agents.createFolderNameAndFilesFromPrompt(prompt, this.folderCache, agent, template, domainSuffix)
        const { folderName, files } = response.parsedResponse
        files["prompt.json"] = JSON.stringify(response.completion, null, 2)

        // Create the folder with generated files
        await this.createFolderFromFiles(folderName, files)

        try {
          await this.buildFolder(folderName)
        } catch (err) {
          console.error(err)
        }

        // Add to story and redirect
        this.addStory(req, `created ${folderName} from prompt using ${agent}`)
        res.redirect(`/edit.html?folderName=${folderName}&command=showWelcomeMessageCommand&welcomeMessage=${welcomeMessage}`)
      } catch (error) {
        console.error("Error creating from prompt:", error)
        res.status(500).send("Failed to create website from prompt: " + error.message)
      }
    })
  }

  async doesHaveSslCert(folderName) {
    // by default assume root server has ssl certs
    if (!folderName.includes(".")) return true
    // Now we see if the custom domain has one
    const certPath = this.makeCertPath(folderName)
    const hasSslCert = await exists(certPath)
    return hasSslCert ? hasSslCert : this.getMatchingWildcardCert(folderName)
  }

  makeCertPath(folderName) {
    return path.join(this.rootFolder, folderName, `.${folderName}.crt`)
  }

  initStampRoute() {
    const { app, rootFolder, folderCache } = this

    // Text file extensions - only include actual text formats
    const textExtensions = new Set("scroll parsers txt html htm rb php md perl py mjs css json csv tsv psv ssv js".split(" "))

    const isTextFile = filepath => {
      const ext = path.extname(filepath).toLowerCase().slice(1)
      return textExtensions.has(ext)
    }

    async function makeStamp(dir) {
      let stamp = "stamp\n"

      const handleFile = async (indentation, relativePath, itemPath) => {
        if (!isTextFile(itemPath)) return
        stamp += `${indentation}${relativePath}\n`
        const content = await fsp.readFile(itemPath, "utf8")
        stamp += `${indentation} ${content.replace(/\n/g, `\n${indentation} `)}\n`
      }

      let gitTrackedFiles

      async function processDirectory(currentPath, depth) {
        const items = await fsp.readdir(currentPath)

        for (const item of items) {
          const itemPath = path.join(currentPath, item)
          const relativePath = path.relative(dir, itemPath)

          if (!gitTrackedFiles.has(relativePath)) continue

          const stats = await fsp.stat(itemPath)
          const indentation = " ".repeat(depth)

          if (stats.isDirectory()) {
            stamp += `${indentation}${relativePath}/\n`
            await processDirectory(itemPath, depth + 1)
          } else if (stats.isFile()) {
            await handleFile(indentation, relativePath, itemPath)
          }
        }
      }

      const stats = await fsp.stat(dir)
      if (stats.isDirectory()) {
        // Get list of git-tracked files
        const { stdout } = await execAsync("git ls-files", { cwd: dir })
        gitTrackedFiles = new Set(stdout.split("\n").filter(Boolean))
        await processDirectory(dir, 1)
      } else {
        await handleFile(" ", dir, dir)
      }

      return stamp.trim()
    }

    app.get("/stamp", async (req, res) => {
      const folderName = this.getFolderName(req)
      const { rootFolder, folderCache } = this

      // Check if folder exists
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const folderPath = path.join(rootFolder, folderName)

      try {
        // Generate the stamp
        const stamp = await makeStamp(folderPath)

        // Set content type and send response
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.send(stamp)
      } catch (error) {
        console.error("Error generating stamp:", error)
        res.status(500).send(`Error generating stamp: ${error.toString().replace(/</g, "&lt;")}`)
      }
    })
  }

  initFileRoutes() {
    const { app, rootFolder, folderCache } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)

    app.post("/createFolder.htm", checkWritePermissions, async (req, res) => this.handleCreateFolder(req.body.folderName, req, res))

    app.post("/cloneFolder.htm", checkWritePermissions, async (req, res) => {
      try {
        const sourceFolderName = req.body.folderName || (req.body.particle ? new Particle(req.body.particle).get("folderName") : "")
        if (!sourceFolderName) return res.status(500).send("No folder name provided")
        const cloneName = this.getCloneName(sourceFolderName)
        const result = await this.createFolder(sourceFolderName + " " + cloneName)
        if (result.errorMessage) return this.handleCreateError(req, res, result)
        const { folderName } = result
        this.addStory(req, `cloned ${sourceFolderName} to ${cloneName}`)
        if (req.body.redirect === "false") return res.send(cloneName)
        res.redirect(`/edit.html?folderName=${cloneName}&command=showWelcomeMessageCommand`)
      } catch (error) {
        console.error(error)
        res.status(500).send("Sorry, an error occurred while cloning the folder:", error)
      }
    })

    app.get("/ls.json", async (req, res) => {
      const folderName = this.getFolderName(req)
      const folderEntry = folderCache[folderName]
      if (!folderEntry) return res.status(404).send(`Folder '${folderName}' not found`)
      res.setHeader("Content-Type", "text/json")
      const files = await this.getFileList(folderName)
      if (folderEntry.hasSslCert === undefined) folderEntry.hasSslCert = await this.doesHaveSslCert(folderName)

      const { hasSslCert, aRecordIps } = folderEntry
      const { serverIps } = this
      res.send(JSON.stringify({ files, hasSslCert, aRecordIps, serverIps }, undefined, 2))
    })

    app.get("/ls.csv", async (req, res) => {
      const folderName = this.getFolderName(req)
      const folderEntry = folderCache[folderName]
      if (!folderEntry) return res.status(404).send(`Folder '${folderName}' not found`)
      res.setHeader("Content-Type", "text/plain")
      const files = await this.getFileList(folderName)
      res.send(new Particle(files).asCsv)
    })

    this.initStampRoute()

    app.get("/readFile.htm", async (req, res) => {
      const filePath = path.join(rootFolder, decodeURIComponent(req.query.filePath))
      try {
        const fileExists = await exists(filePath)
        if (!fileExists) return res.status(404).send(`File '${filePath}' not found`)

        const content = await fsp.readFile(filePath, "utf8")
        res.setHeader("Content-Type", "text/plain")
        res.send(content)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while reading '${filepath}'.`)
      }
    })

    app.post("/writeFile.htm", checkWritePermissions, (req, res) => this.writeAndCommitTextFile(req, res, req.body.filePath, req.body.content))

    app.post("/set", checkWritePermissions, async (req, res) => {
      const { rootFolder, folderCache } = this
      const folderName = this.getFolderName(req)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const { file, line } = req.query
      if (!file) return res.status(400).send("No filename provided")

      const filePath = path.join(rootFolder, folderName, file)

      try {
        // Check if file exists
        const fileExists = await exists(filePath)
        if (!fileExists) return res.status(404).send("File not found")

        // Read the current content
        const content = await fsp.readFile(filePath, "utf8")

        // Parse into Particle
        const particle = new Particle(content)

        // Set the new content at the specified line
        const parts = line.split(" ")
        particle.set(parts[0], parts.slice(1).join(" "))

        const relativePath = filePath.replace(rootFolder, "")

        this.writeAndCommitTextFile(req, res, relativePath, particle.toString(), folderName)
      } catch (error) {
        console.error(`Error in /set route:`, error)
        res.status(500).send(`An error occurred while setting particle content: ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/new", checkWritePermissions, async (req, res) => {
      const stripped = req.body.content.replace(/\r/g, "")
      let content = stripped
      let filenameStrategy
      let folderName
      let subfolders
      let redirect
      if (req.query.folderName) {
        // Query string
        folderName = this.getFolderName(req)
        filenameStrategy = req.query.filenameStrategy
        subfolders = req.query.subfolders?.split("/") || []
        redirect = req.query.redirect
      } else {
        // Top matter
        const parts = stripped.split("\n\n")
        const topMatter = new Particle(parts.shift())
        content = parts.join("\n\n")
        folderName = topMatter.get("folderName") || this.getFolderName(req)
        filenameStrategy = topMatter.get("filenameStrategy")
        redirect = topMatter.get("redirect")
        subfolders = topMatter.get("subfolder")?.split("/") || []
      }
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      const basePath = path.join(folderName, ...subfolders)
      try {
        const filePath = await generateFileName(basePath, filenameStrategy, content)
        this.writeAndCommitTextFile(req, res, filePath, content, folderName, redirect)
      } catch (err) {
        return res.status(400).send(err.message)
      }
    })

    // Add a route for file uploads
    app.post("/uploadFile.htm", checkWritePermissions, async (req, res) => {
      if (!req.files || Object.keys(req.files).length === 0) return res.status(400).send("No files were uploaded.")

      const file = req.files.file
      const folderName = req.body.folderName
      const folderPath = path.join(rootFolder, folderName)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      // Check file extension
      const fileExtension = path.extname(file.name).toLowerCase().slice(1)

      if (file.size > this.maxUploadSize) return res.status(400).send("File size exceeds the maximum limit of 1MB.")

      // Save file to disk
      const fileName = sanitizeFileName(path.basename(file.name, path.extname(file.name))) + "." + fileExtension
      const filePath = path.join(folderPath, fileName)

      try {
        // Use async `mv` with `await`
        await file.mv(filePath)

        // Run git and scroll commands asynchronously
        await execAsync(`git add -f ${fileName}; git commit -m 'Added ${fileName}'`, { cwd: folderPath })
        this.addStory(req, `uploaded ${fileName} to ${folderName}`)
        res.send("File uploaded successfully")
        this.updateFolderAndBuildList(folderName)
      } catch (err) {
        console.error(err)
        res.status(500).send("An error occurred while uploading or processing the file: " + err.message)
      }
    })

    app.post("/createFolderFromFiles.htm", checkWritePermissions, async (req, res) => {
      if (!req.files || !req.files["files[]"]) return res.status(400).send("No files were uploaded.")

      try {
        // Generate a unique folder name
        const folderName = await this.findAvailableFolderName()
        const folderPath = path.join(this.rootFolder, folderName)

        // Create the folder
        await fsp.mkdir(folderPath, { recursive: true })

        // Handle multiple files
        const uploadedFiles = Array.isArray(req.files["files[]"]) ? req.files["files[]"] : [req.files["files[]"]]

        // Process each file
        for (const file of uploadedFiles) {
          const filePath = path.join(folderPath, file.name)

          // Create necessary subdirectories
          await fsp.mkdir(path.dirname(filePath), { recursive: true })

          // Move the file to its destination
          await file.mv(filePath)
        }

        // Initialize git repository
        await execAsync("git init", { cwd: folderPath })
        await execAsync("git add .", { cwd: folderPath })
        await execAsync('git commit -m "Initial commit from uploaded files"', { cwd: folderPath })

        // Add to story and update caches
        this.addStory(req, `created ${folderName} from uploaded files`)
        await this.updateFolderAndBuildList(folderName)

        // Build the folder
        await this.buildFolder(folderName)

        // Send the folder name back
        res.send(folderName)
      } catch (error) {
        console.error(`Error creating folder from files:`, error)
        res.status(500).send(`An error occurred while creating folder from files: ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    // In the initFileRoutes method, add this new route:
    app.post("/createFolderFromZip.htm", checkWritePermissions, async (req, res) => {
      if (!req.files || !req.files.zipFile) return res.status(400).send("No zip file was uploaded.")

      const zipFile = req.files.zipFile
      const suggestedName = req.body.folderName || path.basename(zipFile.name, ".zip").toLowerCase()
      const folderName = sanitizeFolderName(suggestedName)

      // Validate folder name
      if (!this.isValidFolderName(folderName)) return res.status(400).send(`Invalid folder name "${folderName}". Folder names must start with a letter a-z, ` + `be more than 1 character, and not end in a common file extension.`)

      // Check if folder already exists
      if (this.folderCache[folderName]) return res.status(409).send(`A folder named "${folderName}" already exists`)

      const folderPath = path.join(this.rootFolder, folderName)
      const tempPath = path.join(os.tmpdir(), `scroll-${Date.now()}`)

      try {
        // Create temp directory
        await fsp.mkdir(tempPath, { recursive: true })

        // Write zip file to temp location
        const tempZipPath = path.join(tempPath, "upload.zip")
        await zipFile.mv(tempZipPath)

        // Create the target folder
        await fsp.mkdir(folderPath, { recursive: true })

        // Unzip the file
        await execAsync(`unzip "${tempZipPath}"`, { cwd: folderPath })

        // Initialize git repository
        if (!fs.existsSync(path.join(folderPath, ".git"))) await execAsync(`git init; git add .; git commit -m "Initial import from zip file"`, { cwd: folderPath })

        // Add to story and update caches
        this.addStory(req, `created ${folderName} from zip file`)
        this.updateFolderAndBuildList(folderName)

        // Build the folder
        await this.buildFolder(folderName)

        // Redirect to editor
        res.send(folderName)
      } catch (error) {
        console.error(`Error creating folder from zip:`, error)
        res.status(500).send(`An error occurred while creating folder from zip: ${error.toString().replace(/</g, "&lt;")}`)
      } finally {
        // Clean up temp directory
        try {
          await fsp.rm(tempPath, { recursive: true, force: true })
        } catch (cleanupError) {
          console.error("Error cleaning up temp directory:", cleanupError)
        }
      }
    })

    app.post("/echo.htm", checkWritePermissions, async (req, res) => {
      res.setHeader("Content-Type", "text/plain")
      res.send(req.body)
    })

    app.post("/insert.htm", checkWritePermissions, async (req, res) => {
      const folderName = this.getFolderName(req)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      // Which file to insert data to
      const fileName = sanitizeFileName(req.query.fileName)

      const line = parseInt(req.query.line)
      let particles = req.body.particles

      if (!particles) return res.status(400).send("No particles provided")

      if (!fileName) return res.status(400).send("No filename provided")

      const folderPath = path.join(rootFolder, folderName)
      const filePath = path.join(folderPath, fileName)

      particles = "\n" + particles // add a new line before new particles
      try {
        // Default is append
        if (req.query.line === undefined) {
          await fsp.appendFile(filePath, particles)
        } else {
          await fsp.access(filePath)
          let content = await fsp.readFile(filePath, "utf8")
          let lines = content.split("\n")
          lines.splice(line - 1, 0, particles)
          content = lines.join("\n")
          await fsp.writeFile(filePath, content, "utf8")
        }

        // Run git commands
        await execAsync(`git add "${fileName}"; git commit ${this.getCommitAuthor(req)} -m 'Inserted particles into ${fileName}'`, { cwd: folderPath })

        this.addStory(req, `inserted particles into ${folderPath}/${fileName}`)
        this.buildFolder(folderName)
        res.redirect(req.query.redirect)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        if (error.code === "ENOENT") {
          res.status(404).send("File not found")
        } else {
          console.error(error)
          res.status(500).send(`An error occurred while inserting the particles:\n ${error.toString().replace(/</g, "&lt;")}`)
        }
      }
    })

    app.post("/deleteFile.htm", checkWritePermissions, async (req, res) => {
      const folderName = this.getFolderName(req)
      const filePath = path.join(rootFolder, folderName, req.body.filePath)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      try {
        const fileExists = await exists(filePath)
        if (!fileExists) return res.status(404).send(`File '${filePath}' not found`)

        const fileName = path.basename(filePath)
        const folderPath = path.dirname(filePath)

        await fsp.unlink(filePath)
        await execAsync(`git rm ${fileName}; git commit -m 'Deleted ${fileName}' ${this.getCommitAuthor(req)}`, { cwd: folderPath })

        res.send("File deleted successfully")
        this.addStory(req, `deleted ${fileName} in ${folderName}`)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while deleting the file:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/trashFolder.htm", checkWritePermissions, async (req, res) => {
      const { trashFolder } = this
      const folderName = req.body.folderName
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const sourcePath = path.join(rootFolder, folderName)
      const timestamp = Date.now()
      const destinationPath = path.join(trashFolder, `${folderName}-${timestamp}`)

      try {
        // Move the folder to trash
        await fsp.rename(sourcePath, destinationPath)

        // Remove the folder from the cache
        delete folderCache[folderName]

        // Rebuild the list file
        this.buildListFile()

        this.addStory(req, `trashed ${folderName}`)

        res.send("Folder moved to trash successfully")
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while moving the folder to trash:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/renameFile.htm", checkWritePermissions, async (req, res) => {
      const folderName = req.body.folderName
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const oldFileName = req.body.oldFileName
      const newFileName = sanitizeFileName(req.body.newFileName)

      const folderPath = path.join(rootFolder, folderName)
      const oldFilePath = path.join(folderPath, oldFileName)
      const newFilePath = path.join(folderPath, newFileName)

      try {
        // Check if the old file exists
        await fsp.access(oldFilePath)

        // Run git commands
        await execAsync(`git mv -f ${oldFileName} ${newFileName}; git commit ${this.getCommitAuthor(req)} -m 'Renamed ${oldFileName} to ${newFileName}'`, { cwd: folderPath })
        this.addStory(req, `renamed ${oldFileName} to ${newFileName} in ${folderName}`)
        res.send("File renamed successfully")
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while renaming the file:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/mv.htm", checkWritePermissions, async (req, res) => {
      const oldFolderName = req.body.oldFolderName
      const newFolderName = req.body.newFolderName

      // Validate old folder exists
      if (!folderCache[oldFolderName]) return res.status(404).send("Source folder not found")

      // Validate new folder name
      if (!this.isValidFolderName(newFolderName)) return res.status(400).send(`Invalid folder name "${newFolderName}". Folder names must start with a letter a-z, be more than 1 character, and not end in a common file extension.`)

      // Check if new folder name already exists
      if (folderCache[newFolderName]) return res.status(409).send(`A folder named "${newFolderName}" already exists`)

      const oldPath = path.join(rootFolder, oldFolderName)
      const newPath = path.join(rootFolder, newFolderName)

      try {
        // Rename the folder
        await fsp.rename(oldPath, newPath)

        // Remove from cache
        delete folderCache[oldFolderName]

        // Update folder cache with new name
        await this.folderIndex.updateFolder(newFolderName)

        // Rebuild the list file
        this.buildListFile()

        this.addStory(req, `renamed folder ${oldFolderName} to ${newFolderName}`)

        res.send("Folder renamed successfully")
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while renaming the folder:\n ${error.toString().replace(/</g, "&lt;")}`)

        // Try to revert if there was an error
        try {
          if (
            await fsp
              .access(newPath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fsp.rename(newPath, oldPath)
          }
        } catch (revertError) {
          console.error("Error reverting failed rename:", revertError)
        }
      }
    })
  }

  getCpuUsagePercent() {
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage)
    const currentTime = Date.now()
    const timeDiff = currentTime - this.lastCpuCheck

    // Calculate CPU usage percentage
    const totalTicks = (currentCpuUsage.user + currentCpuUsage.system) / 1000 // Convert to microseconds
    const cpuPercent = (totalTicks / timeDiff) * 100

    // Update tracking variables
    this.lastCpuUsage = process.cpuUsage()
    this.lastCpuCheck = currentTime

    return Math.min(100, cpuPercent.toFixed(1))
  }

  async fetchARecordIpsForDomainFromDns(domain) {
    try {
      return await dns.resolve4(domain)
    } catch (error) {
      return [] // Domain doesn't exist or other DNS error
    }
  }

  async findAvailableFolderName(prefix = "files") {
    const { folderCache } = this
    let counter = 1
    let folderName
    do {
      folderName = `${prefix}${counter}`
      counter++
    } while (folderCache[folderName])
    return folderName
  }

  initCommandRoutes() {
    const { app } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)

    app.get("/edit/:folderName", async (req, res) => {
      res.redirect("/edit.html?folderName=" + req.params.folderName)
    })

    app.get("/edit", async (req, res) => {
      res.redirect("/edit.html")
    })

    app.get("/dns.htm", async (req, res) => {
      const domain = req.query.domain
      const aRecordIps = await this.fetchARecordIpsForDomainFromDns(domain)
      const html = await ScrollToHtml(`Server IPS: ${this.serverIps.join(" ")}

A Record IPS for *${domain}*: ${aRecordIps.join(" ")}`)
      res.send(html)
    })

    app.get("/test/:folderName", checkWritePermissions, async (req, res) => {
      await this.runScrollCommand(req, res, "test")
    })

    // Add the status route (in initCommandRoutes or as a separate method)
    app.get("/status.htm", async (req, res) => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000)
      const memUsage = process.memoryUsage()
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const cpuUsage = this.getCpuUsagePercent()
      const loadAvg = os.loadavg()
      const { serverIps, version, startTime, hostname } = this

      const status = {
        server: {
          version,
          serverIps,
          uptime: {
            seconds: uptime,
            formatted: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
          },
          startTime: new Date(startTime).toISOString(),
          hostname,
          platform: process.platform,
          nodeVersion: process.version
        },
        performance: {
          cpu: {
            usage: `${cpuUsage}%`,
            cores: os.cpus().length,
            loadAverage: {
              "1m": loadAvg[0].toFixed(2),
              "5m": loadAvg[1].toFixed(2),
              "15m": loadAvg[2].toFixed(2)
            }
          },
          memory: {
            total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
            free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
            used: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(2)} GB`,
            process: {
              heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
              heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
              rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`
            }
          }
        },
        activity: {
          requestsServed: this.requestsServed,
          requestsPerSecond: (this.requestsServed / uptime).toFixed(2),
          activeFolders: Object.keys(this.folderCache).length,
          buildRequests: Object.keys(this.buildRequests).length,
          sseClients: this.sseClients.size
        }
      }

      const particle = new Particle(status)
      particle.topDownArray.forEach(particle => particle.setCue("- " + particle.cue))
      const html = await ScrollToHtml(particle.toString())

      res.send(html)
    })

    const buildFolder = async (req, res) => {
      const now = Date.now()
      const folderName = this.getFolderName(req)
      if (!this.folderCache[folderName]) return res.status(404).send("Folder not found")
      const error = await this.buildFolder(folderName)
      if (error) return res.status(500).send("Build failed with error" + error.message)
      res.send((Date.now() - now).toString())
      this.updateFolderAndBuildList(folderName)
    }

    app.get("/build/:folderName", checkWritePermissions, buildFolder)
    app.post("/build.htm", checkWritePermissions, buildFolder)

    app.get("/building.htm", async (req, res) => res.send(JSON.stringify(this.buildRequests)))

    app.get("/format/:folderName", checkWritePermissions, async (req, res) => {
      await this.runScrollCommand(req, res, "format")
      this.updateFolderAndBuildList(this.getFolderName(req))
    })

    app.get("/list/:folderName", checkWritePermissions, async (req, res) => {
      await this.runCommand(req, res, "scroll list")
    })

    app.get("/status/:folderName", checkWritePermissions, async (req, res) => {
      await this.runCommand(req, res, "git status")
    })

    app.get("/blame.htm", checkWritePermissions, async (req, res) => {
      const fileName = req.query.fileName.replace(/[^a-zA-Z0-9\/_.-]/g, "")
      await this.runCommand(req, res, "git blame " + fileName)
    })

    app.get("/search.htm", async (req, res) => {
      const folderName = this.getFolderName(req)
      const { query } = req.query

      if (!query) return res.status(400).send("Search query is required")

      const { rootFolder, folderCache } = this

      // If folder specified, search only that folder
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const searchPath = path.join(rootFolder, folderName)
      res.setHeader("Content-Type", "text/plain")

      try {
        // Sanitize the search query to prevent command injection
        const sanitizedQuery = query.replace(/[;&|`$]/g, "")

        // Create a transform stream to modify the output
        const transform = new require("stream").Transform({
          transform(chunk, encoding, callback) {
            let line = chunk.toString()
            // Replace the full path with the relative path
            line = line.replace(searchPath + "/", "")
            callback(null, line)
          }
        })

        // Construct and execute the ripgrep command
        const rgCommand = `rg -i --line-number --color never "${sanitizedQuery}" ${searchPath}`

        const child = spawn(rgCommand, [], {
          shell: true,
          cwd: searchPath
        })

        // Pipe through transform stream to modify paths
        child.stdout.pipe(transform).pipe(res)
        child.stderr.pipe(res)

        await new Promise((resolve, reject) => {
          child.on("close", code => {
            if (code === 0 || code === 1)
              resolve() // rg returns 1 when no matches found
            else reject(new Error(`Search failed with code ${code}`))
          })
          child.on("error", reject)
        })
      } catch (error) {
        console.error(`Error running search:`, error)
        res.end(`\nError: ${error.message}`)
      }
    })
  }

  async runScrollCommand(req, res, command) {
    await this.runCommand(req, res, `scroll list | scroll ${command}`)
  }

  async runCommand(req, res, command) {
    const folderName = this.getFolderName(req)
    const { rootFolder, folderCache } = this

    if (!folderCache[folderName]) return res.status(404).send("Folder not found")

    const folderPath = path.join(rootFolder, folderName)
    res.setHeader("Content-Type", "text/plain")

    try {
      const child = spawn(command, [], {
        shell: true,
        cwd: folderPath
      })

      child.stdout.pipe(res)
      child.stderr.pipe(res)

      await new Promise((resolve, reject) => {
        child.on("close", code => {
          if (code === 0) resolve()
          else reject(new Error(`Command failed with code ${code}`))
        })
        child.on("error", reject)
      })
    } catch (error) {
      console.error(`Error running '${command}' in '${folderName}':`, error)
      // Don't try to send headers again, response stream is already piped
      res.end(`\nError: ${error.message}`)
    }
  }

  initZipRoutes() {
    const { app, folderCache } = this
    app.get("/:folderName.zip", async (req, res) => {
      const folderName = req.params.folderName
      const cacheEntry = folderCache[folderName]
      if (!cacheEntry) return res.status(404).send("Folder not found")

      // Check if the zip is in memory cache
      let zipBuffer = cacheEntry.zip

      if (!zipBuffer) {
        try {
          zipBuffer = await this.zipFolder(folderName)
          if (!zipBuffer) return res.status(404).send("Folder not found or failed to zip")
        } catch (err) {
          console.error("Error zipping folder:", err)
          return res.status(500).send("Error zipping folder")
        }
      }

      // Set headers for zip file
      res.setHeader("Content-Type", "application/zip")
      res.setHeader("Content-Disposition", `attachment; filename=${folderName}.zip`)
      res.send(zipBuffer)
    })
  }

  async zipFolder(folderName) {
    const { rootFolder, folderCache } = this
    const folderPath = path.join(rootFolder, folderName)
    console.log(`Starting zip for folder: '${folderName}'`)

    const zipBuffer = await new Promise((resolve, reject) => {
      const output = []
      let totalSize = 0

      const zip = spawn(
        "zip",
        [
          "-r", // Recursive
          "-q", // Quiet mode (less verbose)
          "-", // Output to stdout
          "." // Current directory
        ],
        {
          cwd: folderPath,
          stdio: ["ignore", "pipe", "pipe"] // Properly configure stdio
        }
      )

      // Handle stdout data
      zip.stdout.on("data", data => {
        output.push(data)
        totalSize += data.length
        // console.log(`Zip progress for ${folderName}: ${totalSize} bytes`)
      })

      // Handle potential stderr messages
      zip.stderr.on("data", data => {
        console.warn(`Zip stderr for ${folderName}:`, data.toString())
      })

      // Handle errors on the process itself
      zip.on("error", err => {
        console.error(`Zip process error for ${folderName}:`, err)
        reject(err)
      })

      // Handle completion
      zip.on("close", code => {
        if (code === 0) {
          console.log(`Successfully zipped ${folderName}: ${totalSize} bytes`)
          resolve(Buffer.concat(output))
        } else {
          const error = new Error(`Zip process failed with code ${code}`)
          console.error(`Failed to zip ${folderName}:`, error)
          reject(error)
        }
      })
    })

    // Only cache if zip was successful
    folderCache[folderName].zip = zipBuffer
    return zipBuffer
  }

  async isScrollFolder(folderName) {
    // We define a Scroll folder as one with at least 1 git commit.
    const folderPath = path.join(this.rootFolder, folderName)
    try {
      if (await exists(this.getStatsPath(folderName))) return true
      const hasGit = await this.hasGit(folderPath)
      if (!hasGit) return false
      // Check if there's at least one commit.
      // todo: why at least 1 commit?
      const { stdout } = await execAsync("git rev-list --count HEAD", { cwd: folderPath })
      return parseInt(stdout.trim(), 10) > 0
    } catch (err) {}
    return false
  }

  getStatsPath(folderName) {
    return path.join(this.rootFolder, folderName, ".stats.json")
  }

  async warmFolderCache() {
    const folders = await fsp.readdir(this.rootFolder)
    const scrollFolders = []
    for (const folder of folders) {
      if (await this.isScrollFolder(folder)) scrollFolders.push(folder)
    }
    console.log(`Loading ${scrollFolders.length} folders.`)
    await Promise.all(scrollFolders.map(this.getFolderStats.bind(this)))
    console.log(`${Object.keys(this.folderCache).length} folders loaded.`)
    await this.buildListFile()
    console.log(`Folder cache warmed. Time: ${(Date.now() - this.startTime) / 1000}s`)
  }

  async getFolderStats(folderName) {
    const statsPath = this.getStatsPath(folderName)
    if (await exists(statsPath)) {
      const entry = await fsp.readFile(statsPath, "utf8")
      const parsed = JSON.parse(entry)
      // If we have a breaking version and need to redo cache, bump this.
      if (parsed.scrollHubVersion && isGreaterOrEqualVersion(parsed.scrollHubVersion, "0.86.0")) {
        this.folderCache[folderName] = parsed
        return
      }
    }
    await this.folderIndex.updateFolder(folderName)
  }

  initVandalProtection() {
    const allowedIpsPath = path.join(this.hubFolder, ".allowedIps.txt")
    const readAllowedIPs = () => {
      if (!fs.existsSync(allowedIpsPath)) return null

      const data = fs.readFileSync(allowedIpsPath, "utf8")
      return new Set(
        data
          .split("\n")
          .map(ip => ip.trim())
          .filter(ip => ip)
      )
    }

    this.allowedIPs = readAllowedIPs()
    this.annoyingIps = new Set(["24.199.111.182", "198.54.134.120"])
    this.writeLimit = 50 // Maximum number of writes per minute
    this.writeWindow = 60 * 1000 // 1 minute in milliseconds
    this.ipWriteOperations = new Map()
    const ipWriteOperations = this.ipWriteOperations

    // Cleanup function to remove old entries from ipWriteOperations
    const cleanupWriteOperations = () => {
      const now = Date.now()
      for (const [ip, times] of ipWriteOperations.entries()) {
        const recentWrites = times.filter(time => now - time < this.writeWindow)
        if (recentWrites.length === 0) {
          ipWriteOperations.delete(ip)
        } else {
          ipWriteOperations.set(ip, recentWrites)
        }
      }
    }

    // Run cleanup every 20 minutes
    setInterval(cleanupWriteOperations, 20 * 60 * 1000)
  }

  checkWritePermissions(req, res, next) {
    let clientIp = req.ip || req.connection.remoteAddress

    clientIp = clientIp.replace(/^::ffff:/, "")

    const msg =
      "Your IP has been temporarily throttled. If this was a mistake, I apologize--please let me know breck7@gmail.com. If not, instead of attacking each other, let's build together. The universe is a vast place. https://github.com/breck7/ScrollHub"

    if (this.annoyingIps.has(clientIp)) return res.status(403).send(msg)

    const now = Date.now()
    const writeTimes = this.ipWriteOperations.get(clientIp) || []
    const recentWrites = writeTimes.filter(time => now - time < this.writeWindow)

    if (recentWrites.length >= this.writeLimit) {
      console.log(`Write limit exceeded for IP: ${clientIp}`)
      this.annoyingIps.add(clientIp)
      return res.status(429).send(msg)
    }

    recentWrites.push(now)
    this.ipWriteOperations.set(clientIp, recentWrites)

    if (this.allowedIPs === null || this.allowedIPs.has(clientIp)) return next()

    res.status(403).send(msg)
  }

  async formatFile(filePath, content) {
    if (!this.shouldFormat(filePath)) return content

    if (filePath.endsWith(".scroll") || filePath.endsWith(".parsers")) {
      try {
        const cli = new ScrollCli().silence()
        await cli.formatCommand(path.dirname(filePath), [filePath])
        return await fsp.readFile(filePath, "utf8")
      } catch (err) {
        console.error(`Error formatting ${filePath}. Continuing on. Error:`, err)
        return content
      }
    }

    // Handle Prettier-supported files
    return new Promise((resolve, reject) => {
      const process = spawn("prettier", ["--write", filePath, "--ignore-path", "/dev/null"])
      // set ignore path to dev/null to tell prettier to ignore .gitignore. todo: better ignore strategy in scroll?
      process.on("close", async code => {
        if (code === 0) {
          const result = await fsp.readFile(filePath, "utf8")
          resolve(result)
        } else {
          console.log(`Error formatting ${filePath}. Continuing on. Error:`, err)
          reject(content)
        }
      })
      process.on("error", reject)
    })
  }

  shouldFormat(filePath) {
    const prettierExtensions = [".js", ".html", ".css", ".json", ".htm", ".mjs"]
    const scrollExtensions = [".scroll", ".parsers"]
    return prettierExtensions.some(ext => filePath.endsWith(ext)) || scrollExtensions.some(ext => filePath.endsWith(ext))
  }

  async writeAndCommitTextFile(req, res, filePath, content, folderName, redirect) {
    // todo: refactor into multiple methods and unit test heavily
    content = content.replace(/\r/g, "")
    const { rootFolder, folderCache } = this
    filePath = path.join(rootFolder, filePath)

    folderName = folderName || this.getFolderName(req)
    const fileName = path.basename(filePath)
    if (!folderCache[folderName]) return res.status(404).send(`Folder '${folderName}' not found`)

    const fileExists = await exists(filePath)
    const action = fileExists ? "updated" : "created"
    const previousVersion = fileExists ? await fsp.readFile(filePath, "utf8") : null

    // Always write to disk.
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, content, "utf8")
      this.addStory(req, `${action} ${filePath}`)
    } catch (err) {
      return res.status(500).send("Failed to save file. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    // If nothing changed, return early.
    if (fileExists && previousVersion === content) return res.send(content)

    const postFormat = await this.formatFile(filePath, content)

    // If nothing changed, early return
    if (fileExists && previousVersion === postFormat) return res.send(postFormat)

    // Commit file
    try {
      const author = this.getCommitAuthor(req)
      const folderPath = path.join(rootFolder, folderName)
      const relativePath = filePath.replace(folderPath, "").substr(1)
      await this.gitCommitFile(folderPath, relativePath, author, action)
    } catch (err) {
      return res.status(500).send("Save ok but git step failed, building aborted. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    try {
      await this.buildFile(filePath)
    } catch (err) {
      return res.status(500).send("Save and git okay but build file did not completely succeed. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    // SUCCESS!!!

    if (redirect) return res.redirect(redirect)

    res.setHeader("Content-Type", "text/plain")
    res.send(postFormat)

    // Update folder metadata
    this.updateFolderAndBuildList(folderName)
  }

  async gitCommitFile(folderPath, relativePath, author, action = "updated") {
    await execAsync(`git add -f ${relativePath}; git commit ${author} -m '${action} ${relativePath}'`, { cwd: folderPath })
  }

  async addStory(req, message) {
    let clientIp = req.ip || req.connection.remoteAddress
    const formattedDate = new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" })
    const storyEntry = `${formattedDate} ${clientIp} ${message}\n`
    // Append the new story entry to the story log file
    fs.appendFile(this.storyLogFile, storyEntry, err => (err ? console.error(err) : ""))
  }

  async ensureInstalled() {
    const { hubFolder, rootFolder, trashFolder, publicFolder } = this
    if (!fs.existsSync(hubFolder)) fs.mkdirSync(hubFolder)
    if (!fs.existsSync(rootFolder)) fs.mkdirSync(rootFolder)
    if (!fs.existsSync(trashFolder)) fs.mkdirSync(trashFolder)
    if (!fs.existsSync(publicFolder)) fs.mkdirSync(publicFolder)
    // copy public folder. even if it exists, to overwrite it.
    execSync(`cp -R ${path.join(__dirname, "public")} ${this.hubFolder}`)
    const hasGit = await this.hasGit(this.hubFolder)
    if (!hasGit) {
      const dotHubGitIgnorePath = path.join(this.hubFolder, ".gitignore")
      fs.writeFileSync(
        dotHubGitIgnorePath,
        `public/*
.*`,
        "utf8"
      )
      execSync(`git init; git add .; git add -f ${dotHubGitIgnorePath}; git commit -m 'initial scrollhub start'`, { cwd: this.hubFolder })
    }
    const configExists = await exists(this.configPath)
    if (!configExists) {
      fs.writeFileSync(this.configPath, sampleConfig, "utf8")
      execSync(`git add ${this.configPath}; git commit -m 'add config'`, { cwd: this.hubFolder })
    }
    const createOptionsPath = path.join(this.hubFolder, "createOptions.scroll")
    const createExists = await exists(createOptionsPath)
    if (!createExists) {
      fs.writeFileSync(createOptionsPath, sampleCreate, "utf8")
      execSync(`git add ${createOptionsPath}; git commit -m 'added create options'`, { cwd: this.hubFolder })
    }
    // If there are no AI options, make blank the default homepage.
    const config = Particle.fromDisk(this.configPath)
    if (!config.has("claude") && !config.has("deepseek")) fs.writeFileSync(path.join(this.publicFolder, "index.scroll"), `blank.scroll`, "utf8")
  }

  async hasGit(folderPath) {
    const gitPath = path.join(folderPath, ".git")
    const pathExists = await exists(gitPath)
    if (!pathExists) return false
    const stats = await fsp.stat(gitPath)
    if (!stats.isDirectory()) return false
    return true
  }

  ensureTemplatesInstalled() {
    const { rootFolder } = this
    const templatesFolder = path.join(__dirname, "public", "templates")
    const templateDirs = fs.readdirSync(templatesFolder)
    const standardGitIgnore = fs.readFileSync(path.join(templatesFolder, "blank_template", ".gitignore"), "utf8")

    for (const dir of templateDirs) {
      const sourcePath = path.join(templatesFolder, dir)
      const destPath = path.join(rootFolder, dir)

      // Check if it's a directory
      const stats = fs.statSync(sourcePath)
      if (!stats.isDirectory()) continue

      if (fs.existsSync(destPath)) return

      // Copy the template folder to the root folder
      execSync(`cp -R ${sourcePath} ${destPath};`, { cwd: rootFolder })

      fs.writeFileSync(path.join(destPath, ".gitignore"), standardGitIgnore, "utf8")

      // Initialize Git repository
      execSync(`git init; git add .; git commit -m 'initial ${dir} template'`, { cwd: destPath })
      this.buildFolderSync(dir)
    }
  }

  async updateFolderAndBuildList(folderName) {
    await this.folderIndex.updateFolder(folderName)
    this.buildListFile()
  }

  async buildFile(filePath) {
    const cli = new ScrollCli().silence()
    await cli.buildCommand(path.dirname(filePath), [filePath])
  }

  buildRequests = {}
  async buildFolder(folderName) {
    if (!this.buildRequests[folderName]) this.buildRequests[folderName] = 1
    else {
      this.buildRequests[folderName]++
      return
    }
    // todo: keep some folders in memory
    try {
      await execAsync(`scroll list | scroll build`, { cwd: path.join(this.rootFolder, folderName) })
      const buildAgain = this.buildRequests[folderName] > 1
      delete this.buildRequests[folderName]
      if (buildAgain) this.buildFolder(folderName)
      return false
    } catch (err) {
      console.error(err)
      delete this.buildRequests[folderName]
      return err
    }
  }

  buildFolderSync(folderName) {
    execSync(`scroll list | scroll build`, { cwd: path.join(this.rootFolder, folderName) })
  }

  getFolderName(req) {
    const folderName = req.body?.folderName || req.query?.folderName || req.params?.folderName
    if (folderName && this.folderCache[folderName]) return folderName

    if (req.hostname && this.folderCache[req.hostname]) return req.hostname

    const folderPart = req.url.split("/")[1]
    if (folderPart && this.folderCache[folderPart]) return folderPart
    return ""
  }

  async buildListFile() {
    const folders = Object.values(this.folderCache).map(folder => folder.stats)
    const particles = new Particle(folders)
    const { publicFolder } = this
    await fsp.writeFile(path.join(publicFolder, "folders.csv"), particles.asCsv, "utf8")
    await fsp.writeFile(path.join(publicFolder, "folders.tsv"), particles.asTsv, "utf8")
    await fsp.writeFile(path.join(publicFolder, "folders.json"), JSON.stringify(folders, null, 2), "utf8")
    const processName = this.hostname + (this.port === 80 ? "" : ":" + this.port)
    const scroll = `settings.scroll
homeButton
buildHtml
metaTags
meta
 name format-detection
 content telephone=no
theme gazette
title Folders

scrollHubStyle.css

container 1000px
# ${processName} is serving ${folders.length} folders in ${this.rootFolder}
 index.html ${processName}
 style font-size: 150%;

center
Traffic Data | ScrollHub Version ${packageJson.version}
 .requests.html Traffic Data
Download folders as JSON | CSV | TSV
 link folders.json JSON
 link folders.csv CSV
 link folders.tsv TSV

folders.csv
 compose links <a href="edit.html?folderName={folder}">edit</a> · <a href="{folder}.zip">zip</a>
  select folder folderLink links revised hash files mb revisions
   compose hashLink commits.htm?folderName={folder}
    orderBy -revised
     rename revised lastRevised
      printTable

endColumns
tableSearch
scrollVersionLink`
    // todo: move these to .hub folder. 1 per process.
    await fsp.writeFile(path.join(publicFolder, "folders.scroll"), scroll, "utf8")
    await fsp.writeFile(path.join(publicFolder, "foldersPublished.html"), `<a id="foldersPublished" class="greyText" href="folders.html">${folders.length} folders</a>`, "utf8")
    await this.buildPublicFolder()
  }

  async buildPublicFolder() {
    await execAsync(`scroll build`, { cwd: this.publicFolder })
  }

  handleCreateError(req, res, params) {
    const url = req.body.source?.includes(".html") ? req.body.source : "index.html"
    res.redirect(`/${url}?${new URLSearchParams(params).toString()}`)
  }

  reservedExtensions = "scroll parsers txt html htm md rb php perl py mjs css json csv tsv psv ssv pdf js jpg jpeg png gif webp svg heic ico mp3 mp4 mov mkv ogg webm ogv woff2 woff ttf otf tiff tif bmp eps git".split(" ")

  isValidFolderName(name) {
    if (name.length < 2) return false

    // dont allow folder names that look like filenames.
    // also, we reserve ".htm" for ScrollHub dynamic routes
    if (name.includes(".")) {
      const ext = path.extname(name).toLowerCase().slice(1)
      if (this.reservedExtensions.includes(ext)) return false
    }
    if (/^[a-z0-9][a-z0-9._]*$/.test(name)) return true
    return false
  }

  makeFolderNameAndTemplateFromInput(rawInput, folderCache) {
    const parts = rawInput.split(" ")
    let template = ""
    let folderName = ""
    // If more than 1 part, try to create from template
    if (parts.length > 1) {
      template = parts.shift()
      if (folderCache[template]) folderName = parts.join("")
      else if (isUrl(template)) folderName = sanitizeFolderName(parts.join(" "))
      else {
        template = "blank_template"
        folderName = sanitizeFolderName(rawInput)
      }
    } else {
      folderName = sanitizeFolderName(rawInput)
      template = isUrl(rawInput) ? rawInput : "blank_template"
    }
    if (!this.isValidFolderName(folderName))
      return {
        errorMessage: `Sorry, your folder name "${folderName}" did not meet our requirements. It should start with a letter or number, be more than 1 character, and not end in a common file extension.`,
        folderName: rawInput
      }
    return {
      folderName,
      template,
      errorMessage: undefined
    }
  }

  async createFolderFromFiles(folderName, files) {
    const folderPath = path.join(this.rootFolder, folderName)
    await fsp.mkdir(folderPath, { recursive: true })
    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(folderPath, filename)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, content, "utf8")
    }
    await execAsync("git init", { cwd: folderPath })
    await execAsync("git add .", { cwd: folderPath })
    await execAsync('git commit -m "Initial commit"', { cwd: folderPath })
    await this.updateFolderAndBuildList(folderName)
  }

  // We support a lot of different strategies for creating a folder. Yeah, its a bit wierd. Probably should clean this up.
  async createFolder(rawInput) {
    const { folderCache } = this
    const { folderName, template, errorMessage } = this.makeFolderNameAndTemplateFromInput(rawInput, folderCache)
    if (errorMessage) return { errorMessage, folderName }

    if (folderCache[folderName]) return { errorMessage: `Sorry a folder named "${folderName}" already exists on this server.`, folderName: rawInput }

    const { rootFolder } = this
    if (isUrl(template)) {
      try {
        new URL(template)
      } catch (err) {
        return { errorMessage: `Invalid template url.`, folderName: rawInput }
      }
      const cloner = new CloneCli()
      await cloner.clone(rootFolder, template, folderName)
      await this.buildFolder(folderName)
    } else {
      await execAsync(`cp -R ${template} ${folderName};`, { cwd: rootFolder })
    }
    await this.updateFolderAndBuildList(folderName)

    return { folderName }
  }

  getCert(certPath) {
    const keyPath = certPath.replace(/\.crt$/, ".key")

    // Check if both cert and key files exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath))
      return {
        cert: fs.readFileSync(certPath, "utf8"),
        key: fs.readFileSync(keyPath, "utf8")
      }

    return false
  }

  getMatchingWildcardCert(hostname) {
    const { wildCardCerts } = this
    // Check for matching wildcard certificate
    for (const wild of wildCardCerts) {
      if (wild.regex.test(hostname)) return wild.cert
    }
  }

  loadCertAndKey(hostname) {
    const { certCache, pendingCerts, folderCache } = this
    const entry = folderCache[hostname]
    if (entry && entry.loadedCert) return entry.loadedCert
    if (certCache.has(hostname)) return certCache.get(hostname) // Return from cache if available
    // Todo: put matching wild in cache as well?
    const wild = this.getMatchingWildcardCert(hostname)
    if (wild) return wild
    if (pendingCerts[hostname]) return
    if (this.folderCache[hostname]) {
      this.makeCert(hostname)
      throw new Error(`SSL certificate or key not found for ${hostname}. Attempting to make cert.`)
    } else {
      throw new Error(`${hostname} requested but no matching folder found.`)
    }
  }

  async loadWildCardCerts() {
    const wildcards = this.config.getParticles("wildcard")
    if (!wildcards.length) return
    wildcards.forEach(wildcardConfig => {
      const [_, pattern, certFile, keyFile] = wildcardConfig.atoms
      const sslOptions = {
        cert: fs.readFileSync(certFile, "utf8"),
        key: fs.readFileSync(keyFile, "utf8")
      }
      // Convert wildcard pattern to regex
      // e.g., "*.example.com" becomes "^[^.]+\.example\.com$"
      const regexPattern = pattern
        .replace(/\./g, "\\.") // Escape dots
        .replace(/\*/g, "[^.]+") // Replace * with regex for non-dot chars
      const regex = new RegExp(`^${regexPattern}$`)

      this.wildCardCerts.push({ regex, pattern, cert: sslOptions })
    })
  }

  async startHttpsServer() {
    const { app, hubFolder } = this
    const tls = require("tls")
    const { CertificateMaker } = require("./CertificateMaker.js")
    const certMaker = new CertificateMaker(app).setupChallengeHandler()

    this.certCache = new Map()
    await this.loadWildCardCerts()

    const crtInHubFolder = (await fsp.readdir(hubFolder)).find(f => f.endsWith(".crt"))
    if (crtInHubFolder) {
      const hostname = crtInHubFolder.substr(1).replace(/\.crt$/, "")
      const sslOptions = this.getCert(path.join(hubFolder, crtInHubFolder))
      if (sslOptions) this.certCache.set(hostname, sslOptions)
    }

    const pendingCerts = {}
    this.pendingCerts = pendingCerts
    this.makeCert = async domain => {
      pendingCerts[domain] = true
      const email = domain + "@hub.scroll.pub"
      await certMaker.makeCertificate(domain, email, path.join(this.rootFolder, domain))
    }

    const that = this
    // Dynamic HTTPS server using SNI (Server Name Indication)
    const httpsServer = https.createServer(
      {
        SNICallback: (hostname, cb) => {
          try {
            const sslOptions = that.loadCertAndKey(hostname.toLowerCase())
            cb(null, tls.createSecureContext(sslOptions))
          } catch (err) {
            console.error(`No cert found for ${hostname}: ${err.message}`)
            cb(err)
          }
        }
      },
      app
    )

    httpsServer.listen(443, () => console.log("HTTPS server running on port 443"))
    return httpsServer
  }

  get isLocalHost() {
    const hostname = require("os").hostname().toLowerCase()
    if (/(localhost|macbook)/.test(hostname)) return true
    return false
  }

  async startHttpServer() {
    const { app } = this
    const startPort = this.port
    const maxPort = startPort + 100
    for (let port = startPort; port <= maxPort; port++) {
      try {
        const httpServer = http.createServer(app)
        await new Promise((resolve, reject) => {
          httpServer.on("error", err => {
            if (err.code === "EADDRINUSE") {
              console.log(`Port ${port} is busy, trying ${port + 1}...`)
              resolve(false)
            } else reject(err)
          })

          httpServer.listen(port, () => {
            console.log(`HTTP server running at http://localhost:${port}`)
            this.port = port // Store the actual bound port
            resolve(true)
          })
        }).then(success => {
          if (success) return httpServer
        })

        if (httpServer.listening) return httpServer
      } catch (err) {
        console.error(`Error trying port ${port}:`, err)
        if (port === maxPort) throw new Error(`Could not find an available port between ${startPort} and ${maxPort}`)
      }
    }
  }

  async stopServers() {
    if (!this.servers) return

    return Promise.all(
      this.servers.map(server => {
        return new Promise((resolve, reject) => {
          server.close(err => {
            if (err) reject(err)
            else resolve()
          })

          // Force-close connections that don't finish after timeout
          setTimeout(() => {
            server.closeAllConnections?.()
          }, 25000)
        })
      })
    )
  }
}

module.exports = { ScrollHub }
