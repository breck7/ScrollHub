// STDLib
const { exec, execSync, spawn } = require("child_process")
const fs = require("fs")
const v8 = require("v8")
const fsp = require("fs").promises
const os = require("os")
const path = require("path")
const util = require("util")
const execAsync = util.promisify(exec)

// Web server
const express = require("express")
const compression = require("compression")
const https = require("https")
const http = require("http")
const fileUpload = require("express-fileupload")
const AnsiToHtml = require("ansi-to-html")

// Git server
const httpBackend = require("git-http-backend")

// PPS
const { Particle } = require("scrollsdk/products/Particle.js")
const { ScrollFile, ScrollFileSystem } = require("scroll-cli/scroll.js")
const { CloneCli } = require("scroll-cli/clone.js")
const packageJson = require("./package.json")
const scrollFs = new ScrollFileSystem()

// This
const { Dashboard } = require("./dashboard.js")

const exists = async filePath => {
  const fileExists = await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false)
  return fileExists
}

const getBaseUrlForFolder = (folderName, hostname, protocol) => {
  const isLocalHost = hostname.includes("local")
  // if localhost, no custom domains
  if (isLocalHost) return "http://localhost/" + folderName

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName
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

button Refresh
 link /summarizeRequests.htm?folderName=${folderName}
 post
  // Anything

requests.csv
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

const sanitizeFileName = name => name.replace(/[^a-zA-Z0-9._]/g, "")

class ScrollHub {
  constructor() {
    this.app = express()
    const app = this.app
    this.port = 80
    this.maxUploadSize = 100 * 1000 * 1024
    this.allowedExtensions = "scroll parsers txt html htm css json csv tsv psv ssv pdf js jpg jpeg png gif webp svg heic ico mp3 mp4 mov mkv ogg webm ogv woff2 woff ttf otf tiff tif bmp eps git".split(" ")
    this.hostname = os.hostname()
    this.rootFolder = path.join(os.homedir(), "folders")
    this.templatesFolder = path.join(__dirname, "templates")
    this.trashFolder = path.join(__dirname, "trash")
    this.certsFolder = path.join(__dirname, "certs")
    this.folderCache = {}
    this.sseClients = new Set()
    this.globalLogFile = path.join(__dirname, "log.txt")
    this.storyLogFile = path.join(__dirname, "writes.txt")
    this.dashboard = new Dashboard(this.globalLogFile)
  }

  startAll() {
    this.startTime = Date.now()
    this.ensureInstalled()
    this.ensureTemplatesInstalled()
    this.warmFolderCache()
    this.initVandalProtection()
    this.enableCompression()
    this.enableCors()
    this.enableFormParsing()
    this.enableFileUploads()

    this.initAnalytics()
    this.addStory({ ip: "admin" }, `started ScrollHub v${packageJson.version}`)
    console.log(`ScrollHub version: ${packageJson.version}`)
    console.log(`Max memory: ${v8.getHeapStatistics().heap_size_limit / 1024 / 1024} MB`)

    this.initFileRoutes()
    this.initGitRoutes()
    this.initHistoryRoutes()
    this.initZipRoutes()
    this.initCommandRoutes()
    this.initSSERoute()

    this.enableStaticFileServing()

    this.servers = [this.startHttpsServer(), this.startHttpServer()]
    this.init404Routes()
    return this
  }

  initSSERoute() {
    const { app, globalLogFile } = this
    app.get("/requests.htm", (req, res) => {
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
    const geo = await this.dashboard.ipToGeo(ip === "::1" ? "98.150.188.43" : ip)
    const name = (geo.regionName + "/" + geo.country).replace(/ /g, "")
    log = [log.trim(), name, geo.lat, geo.lon].join(" ")
    this.sseClients.forEach(client => {
      if (!client.folderName || client.folderName === folderName) client.res.write(`data: ${JSON.stringify({ log })}\n\n`)
    })
  }

  enableCompression() {
    this.app.use(compression())
  }

  enableCors() {
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      next()
    })
  }

  enableFormParsing() {
    this.app.use(express.urlencoded({ extended: true }))
  }

  enableFileUploads() {
    this.app.use(fileUpload({ limits: { fileSize: this.maxUploadSize } }))
  }

  enableStaticFileServing() {
    const { app, folderCache, rootFolder } = this
    // New middleware to route domains to the matching folder
    app.use((req, res, next) => {
      const hostname = req.hostname?.toLowerCase()
      if (!hostname || !folderCache[hostname]) return next()

      const folderPath = path.join(rootFolder, hostname)
      express.static(folderPath)(req, res, next)
    })

    // Serve the folders directory from the root URL
    app.use("/", express.static(rootFolder))

    // Serve the root directory statically
    app.use(express.static(__dirname))
  }

  init404Routes() {
    const { app, rootFolder } = this
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
          res.status(404).sendFile(path.join(__dirname, "404.html"))
        })
    })
  }

  isSummarizing = {}
  async buildRequestsSummary(folder = "") {
    const { rootFolder, folderCache } = this
    if (this.isSummarizing[folder]) return
    this.isSummarizing[folder] = true
    if (folder && !folderCache[folder]) return
    const logFile = folder ? this.getFolderLogFile(folder) : this.globalLogFile
    const outputPath = folder ? path.join(rootFolder, folder) : path.join(__dirname)
    const dashboard = new Dashboard(logFile)
    await dashboard.processLogFile()
    const content = folder ? dashboard.csv : dashboard.csvTotal
    await fsp.writeFile(path.join(outputPath, "requests.csv"), content, "utf8")
    if (folder) {
      const reqFile = path.join(outputPath, "requests.scroll")
      await fsp.writeFile(reqFile, requestsFile(folder), "utf8")
      await new ScrollFile(undefined, reqFile, new ScrollFileSystem()).buildAll()
    } else await this.buildScrollHubPages()
    this.isSummarizing[folder] = false
  }

  initAnalytics() {
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    if (!fs.existsSync(this.storyLogFile)) fs.writeFileSync(this.storyLogFile, "", "utf8")
    const { app, folderCache } = this
    app.use(this.logRequest.bind(this))

    app.use("/summarizeRequests.htm", checkWritePermissions, async (req, res) => {
      const folderName = this.getFolderName(req)
      if (folderName) {
        await this.buildRequestsSummary(folderName)
        if (req.body.particle) return res.send("Done.")
        return res.redirect(folderName + "/requests.html")
      }
      await this.buildRequestsSummary()
      res.send(`Done.`)
    })

    app.get("/hostname.htm", (req, res) => res.send(req.hostname))
  }

  async logRequest(req, res, next) {
    const { rootFolder, folderCache, globalLogFile } = this
    const { hostname, method, url, protocol } = req
    const ip = req.ip || req.connection.remoteAddress
    const userAgent = parseUserAgent(req.get("User-Agent") || "Unknown")
    const folderName = this.getFolderName(req)

    // todo: log after request? save status response, etc? flag bots?
    const logEntry = `${method === "GET" ? "read" : "write"} ${folderName || hostname} ${protocol}://${hostname}${url} ${Date.now()} ${ip} ${userAgent}\n`

    fs.appendFile(globalLogFile, logEntry, err => {
      if (err) console.error("Failed to log request:", err)
    })

    this.broadCastMessage(folderName, logEntry, ip)

    if (folderName && folderCache[folderName]) {
      const folderLogFile = this.getFolderLogFile(folderName)
      try {
        await fsp.appendFile(folderLogFile, logEntry)
      } catch (err) {
        console.error(`Failed to log request to folder log (${folderLogFile}):`, err)
      }
    }
    next()
  }

  getFolderLogFile(folderName) {
    const { rootFolder } = this
    const folderPath = path.join(rootFolder, folderName)
    return path.join(folderPath, "log.txt")
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
    const { app, rootFolder, folderCache } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    app.get("/history.htm/:folderName", async (req, res) => {
      const folderName = sanitizeFolderName(req.params.folderName)
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
    app.get("/diff.htm/:folderName", async (req, res) => {
      const folderName = sanitizeFolderName(req.params.folderName)
      const folderPath = path.join(rootFolder, folderName)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")
      const count = req.query.count || 10

      try {
        // Check if there are any commits
        const gitRevListProcess = spawn("git", ["rev-list", "--count", "HEAD"], { cwd: folderPath })
        let commitCountData = ""

        gitRevListProcess.stdout.on("data", data => {
          commitCountData += data.toString()
        })

        gitRevListProcess.stderr.on("data", data => {
          console.error(`git rev-list stderr: ${data}`)
        })

        gitRevListProcess.on("close", code => {
          if (code !== 0) {
            res.status(500).send("An error occurred while checking commit count")
            return
          }

          const numCommits = parseInt(commitCountData.trim(), 10)
          if (numCommits === 0) {
            res.status(200).send("No commits available.")
            return
          }

          // Now spawn git log process
          const gitLogProcess = spawn("git", ["log", "-p", `-${count}`, "--color=always"], { cwd: folderPath })
          const convert = new AnsiToHtml({ escapeXML: true })

          res.setHeader("Content-Type", "text/html; charset=utf-8")
          res.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Last 10 Commits for ${folderName}</title>
  <style>
    body { font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 5px; }
    h2 { color: #333; }
    .commit { border-bottom: 1px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
    .commit-message { font-weight: bold; color: #005cc5; }
    input[type="submit"] { font-size: 0.8em; padding: 2px 5px; margin-left: 10px; }
  </style>
</head>
<body>
`)

          let buffer = ""
          gitLogProcess.stdout.on("data", data => {
            buffer += data.toString()
            // Process complete lines
            let lines = buffer.split("\n")
            buffer = lines.pop() // Keep incomplete line in buffer

            lines = lines.map(line => {
              // Convert ANSI to HTML
              line = convert.toHtml(line)
              // Replace commit hashes with forms
              line = line.replace(/(commit\s)([0-9a-f]{40})/, (match, prefix, hash) => {
                return `${"-".repeat(60)}<br>
${prefix}${hash}<br>
<form method="POST" action="/revert.htm/${folderName}" style="display:inline;">
  <input type="hidden" name="hash" value="${hash}">
  <input type="submit" value="Restore this version" onclick="return confirm('Restore this version?');">
</form>`
              })
              return line
            })

            res.write(lines.join("\n") + "\n")
          })

          gitLogProcess.stderr.on("data", data => {
            console.error(`git log stderr: ${data}`)
          })

          gitLogProcess.on("close", code => {
            if (code !== 0) {
              console.error(`git log process exited with code ${code}`)
              res.status(500).end("An error occurred while fetching the git log")
            } else {
              // Process any remaining buffered data
              if (buffer.length > 0) {
                buffer = convert.toHtml(buffer)
                buffer = buffer.replace(/(commit\s)([0-9a-f]{40})/, (match, prefix, hash) => {
                  return `${"-".repeat(60)}<br>
${prefix}${hash}<br>
<form method="POST" action="/revert.htm/${folderName}" style="display:inline;">
  <input type="hidden" name="hash" value="${hash}">
  <input type="submit" value="Restore this version" onclick="return confirm('Restore this version?');">
</form>`
                })
                res.write(buffer)
              }
              res.end("</body></html>")
            }
          })
        })
      } catch (error) {
        console.error(error)
        res.status(500).send("An error occurred while fetching the git log")
      }
    })

    app.post("/revert.htm/:folderName", checkWritePermissions, async (req, res) => {
      const folderName = sanitizeFolderName(req.params.folderName)
      const targetHash = req.body.hash
      const folderPath = path.join(rootFolder, folderName)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      if (!targetHash || !/^[0-9a-f]{40}$/i.test(targetHash)) return res.status(400).send("Invalid target hash provided")

      try {
        // Perform the revert
        const clientIp = req.ip || req.connection.remoteAddress
        const hostname = req.hostname?.toLowerCase()
        await execAsync(`git checkout ${targetHash} . && git add . && git commit --author="${clientIp} <${clientIp}@${hostname}>" -m "Reverted to ${targetHash}" --allow-empty`, { cwd: folderPath })

        this.addStory(req, `reverted ${folderName}`)

        await this.buildFolder(folderName)

        res.redirect("/diff.htm/" + folderName)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while reverting the repository:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })
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

  initFileRoutes() {
    const { app, rootFolder, folderCache, allowedExtensions } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)

    app.get("/e/:folderName", async (req, res) => {
      res.redirect("/edit.html?folderName=" + req.params.folderName)
    })

    app.post("/create.htm", checkWritePermissions, async (req, res) => {
      try {
        const result = await this.createFolder(req.body.folderName)
        if (result.errorMessage) return this.handleCreateError(res, result)
        const { folderName } = result
        this.addStory(req, `created ${folderName}`)
        res.redirect(`/edit.html?folderName=${folderName}`)
      } catch (error) {
        console.error(error)
        res.status(500).send("Sorry, an error occurred while creating the folder:", error)
      }
    })

    app.post("/clone.htm", checkWritePermissions, async (req, res) => {
      try {
        const sourceFolderName = req.body.folderName || (req.body.particle ? new Particle(req.body.particle).get("folderName") : "")
        if (!sourceFolderName) return res.status(500).send("No folder name provided")
        const cloneName = this.getCloneName(sourceFolderName)
        const result = await this.createFolder(sourceFolderName + " " + cloneName)
        if (result.errorMessage) return this.handleCreateError(res, result)
        const { folderName } = result
        this.addStory(req, `cloned ${sourceFolderName} to ${cloneName}`)
        if (req.body.redirect === "false") return res.send(cloneName)
        res.redirect(`/edit.html?folderName=${cloneName}`)
      } catch (error) {
        console.error(error)
        res.status(500).send("Sorry, an error occurred while cloning the folder:", error)
      }
    })

    app.get("/ls.htm", async (req, res) => {
      const folderName = sanitizeFolderName(req.query.folderName)
      const folderPath = path.join(rootFolder, folderName)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const files = (await fsp.readdir(folderPath)).filter(file => {
        const ext = path.extname(file).toLowerCase().slice(1)
        return allowedExtensions.includes(ext)
      })

      res.setHeader("Content-Type", "text/plain")
      res.send(files.join("\n"))
    })

    app.get("/read.htm", async (req, res) => {
      const filePath = path.join(rootFolder, decodeURIComponent(req.query.filePath))

      const ok = this.extensionOkay(filePath, res)
      if (!ok) return

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

    app.post("/write.htm", checkWritePermissions, (req, res) => this.writeAndCommitTextFile(req, res, req.body.filePath, req.body.content))

    // Add a route for file uploads
    app.post("/upload.htm", checkWritePermissions, async (req, res) => {
      if (!req.files || Object.keys(req.files).length === 0) return res.status(400).send("No files were uploaded.")

      const file = req.files.file
      const folderName = req.body.folderName
      const folderPath = path.join(rootFolder, sanitizeFolderName(folderName))

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      // Check file extension
      const fileExtension = path.extname(file.name).toLowerCase().slice(1)
      if (!allowedExtensions.includes(fileExtension)) return res.status(400).send(`Invalid file type. Only ${allowedExtensions.join(" ")} files are allowed.`)

      if (file.size > this.maxUploadSize) return res.status(400).send("File size exceeds the maximum limit of 1MB.")

      // Save file to disk
      const fileName = sanitizeFileName(path.basename(file.name, path.extname(file.name))) + "." + fileExtension
      const filePath = path.join(folderPath, fileName)

      try {
        // Use async `mv` with `await`
        await file.mv(filePath)

        // Run git and scroll commands asynchronously
        await execAsync(`git add -f ${fileName}; git commit -m 'Added ${fileName}'`, { cwd: folderPath })
        await this.buildFolder(folderName)

        this.addStory(req, `uploaded ${fileName} to ${folderName}`)
        res.send("File uploaded successfully")
        this.updateFolderAndBuildList(folderName)
      } catch (err) {
        console.error(err)
        res.status(500).send("An error occurred while uploading or processing the file.")
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

      // Where to redirect after success
      const redirectUrl = sanitizeFileName(req.query.redirect)
      const line = parseInt(req.query.line)
      let particles = req.body.particles

      if (!particles) return res.status(400).send("No particles provided")

      if (!fileName) return res.status(400).send("No filename provided")

      const folderPath = path.join(rootFolder, folderName)
      const filePath = path.join(folderPath, fileName)

      // Check if the file extension is allowed
      if (!this.extensionOkay(filePath, res)) return

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
        const clientIp = req.ip || req.connection.remoteAddress
        const hostname = req.hostname?.toLowerCase()
        await execAsync(`git add "${fileName}"; git commit --author="${clientIp} <${clientIp}@${hostname}>" -m 'Inserted particles into ${fileName}'`, { cwd: folderPath })
        await this.buildFolder(folderName)

        this.addStory(req, `inserted particles into ${folderPath}/${fileName}`)

        res.redirect(redirectUrl)
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

    app.post("/delete.htm", checkWritePermissions, async (req, res) => {
      const filePath = path.join(rootFolder, decodeURIComponent(req.query.filePath))
      const folderName = path.dirname(filePath).split(path.sep).pop()

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const ok = this.extensionOkay(filePath, res)
      if (!ok) return

      try {
        const fileExists = await exists(filePath)
        if (!fileExists) return res.status(404).send("File not found")

        const fileName = path.basename(filePath)
        const folderPath = path.dirname(filePath)

        await fsp.unlink(filePath)
        await execAsync(`git rm ${fileName}; git commit -m 'Deleted ${fileName}'`, { cwd: folderPath })
        await this.buildFolder(folderName)

        res.send("File deleted successfully")
        this.addStory(req, `deleted ${fileName} in ${folderName}`)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while deleting the file:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/trash.htm", checkWritePermissions, async (req, res) => {
      const { trashFolder } = this
      const folderName = sanitizeFolderName(req.body.folderName)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const sourcePath = path.join(rootFolder, folderName)
      const timestamp = Date.now()
      const destinationPath = path.join(trashFolder, `${folderName}-${timestamp}`)

      try {
        // Move the folder to trash
        await fsp.rename(sourcePath, destinationPath)

        // Remove the folder from the cache
        delete folderCache[folderName]

        // Remove the zip file from cache if it exists
        this.zipCache.delete(folderName)

        // Rebuild the list file
        this.buildListFile()

        this.addStory(req, `trashed ${folderName}`)

        res.send("Folder moved to trash successfully")
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while moving the folder to trash:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/rename.htm", checkWritePermissions, async (req, res) => {
      const folderName = sanitizeFolderName(req.body.folderName)
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const oldFileName = req.body.oldFileName
      const newFileName = sanitizeFileName(req.body.newFileName)

      const folderPath = path.join(rootFolder, folderName)
      const oldFilePath = path.join(folderPath, oldFileName)
      const newFilePath = path.join(folderPath, newFileName)

      if (!this.extensionOkay(oldFilePath, res) || !this.extensionOkay(newFilePath, res)) return

      try {
        // Check if the old file exists
        await fsp.access(oldFilePath)

        // Run git commands
        const clientIp = req.ip || req.connection.remoteAddress
        const hostname = req.hostname?.toLowerCase()
        await execAsync(`git mv ${oldFileName} ${newFileName}; git commit --author="${clientIp} <${clientIp}@${hostname}>" -m 'Renamed ${oldFileName} to ${newFileName}'`, { cwd: folderPath })
        await this.buildFolder(folderName)

        this.addStory(req, `renamed ${oldFileName} to ${newFileName} in ${folderName}`)
        res.send("File renamed successfully")
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while renaming the file:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/mv.htm", checkWritePermissions, async (req, res) => {
      const oldFolderName = sanitizeFolderName(req.body.oldFolderName)
      const newFolderName = sanitizeFolderName(req.body.newFolderName)

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
        this.zipCache.delete(oldFolderName)

        // Update folder cache with new name
        await this.updateFolder(newFolderName)

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

  initCommandRoutes() {
    const { app } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)

    app.get("/t/:folderName", checkWritePermissions, async (req, res) => {
      await this.runCommand(req, res, "test")
    })

    app.get("/b/:folderName", checkWritePermissions, async (req, res) => {
      await this.runCommand(req, res, "build")
    })

    app.get("/f/:folderName", checkWritePermissions, async (req, res) => {
      await this.runCommand(req, res, "format")
    })
  }

  async runCommand(req, res, command) {
    const folderName = this.getFolderName(req)
    const { rootFolder, folderCache } = this

    if (!folderCache[folderName]) return res.status(404).send("Folder not found")

    try {
      const folderPath = path.join(rootFolder, folderName)
      const { stdout } = await execAsync(`scroll list | scroll ${command}`, { cwd: folderPath })
      res.setHeader("Content-Type", "text/plain")
      res.send(stdout.toString())
      if (command !== "test") this.updateFolderAndBuildList(folderName)
    } catch (error) {
      console.error(`Error running '${command}' in '${folderName}':`, error)
      res.status(500).send(`An error occurred while running '${command}' in '${folderName}'`)
    }
  }

  initZipRoutes() {
    const { app, folderCache } = this
    const zipCache = new Map()
    this.zipCache = zipCache

    app.get("/:folderName.zip", async (req, res) => {
      const folderName = sanitizeFolderName(req.params.folderName)

      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      // Check if the zip is in memory cache
      let zipBuffer = zipCache.get(folderName)

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
    const { rootFolder, zipCache } = this
    const folderPath = path.join(rootFolder, folderName)
    const zipBuffer = await new Promise((resolve, reject) => {
      const output = []
      const zip = spawn("zip", ["-r", "-", "."], { cwd: folderPath })

      zip.stdout.on("data", data => output.push(data))
      zip.on("close", code => {
        if (code === 0) resolve(Buffer.concat(output))
        else reject(new Error("Error creating zip file"))
      })
    })
    zipCache.set(folderName, zipBuffer)
    return zipBuffer
  }

  async warmFolderCache() {
    const folders = await fsp.readdir(this.rootFolder)
    await Promise.all(folders.map(this.updateFolder.bind(this)))
    await this.buildListFile()
    console.log(`Folder cache warmed. Time: ${(Date.now() - this.startTime) / 1000}s`)
  }

  initVandalProtection() {
    const allowedIpsPath = path.join(__dirname, "allowedIps.txt")
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
    this.writeLimit = 30 // Maximum number of writes per minute
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

  extensionOkay(filepath, res) {
    const { allowedExtensions } = this
    const fileExtension = path.extname(filepath).toLowerCase().slice(1)
    if (!allowedExtensions.includes(fileExtension)) {
      res.status(400).send(`Editing '${fileExtension}' files not yet supported. Only editing of ${allowedExtensions} files is allowed.`)
      return false
    }
    return true
  }

  async writeAndCommitTextFile(req, res, filePath, content) {
    content = content.replace(/\r/g, "")
    const { rootFolder, folderCache } = this
    filePath = path.join(rootFolder, filePath)

    const ok = this.extensionOkay(filePath, res)
    if (!ok) return

    const folderPath = path.dirname(filePath)
    const folderName = this.getFolderName(req)

    if (!folderCache[folderName]) return res.status(404).send(`Folder '${folderName}' not found`)

    const fileName = path.basename(filePath)
    const clientIp = req.ip || req.connection.remoteAddress
    const hostname = req.hostname?.toLowerCase()

    const fileExists = await exists(filePath)
    const currentVersion = fileExists ? await fsp.readFile(filePath, "utf8") : null
    try {
      await fsp.writeFile(filePath, content, "utf8")
      this.addStory(req, `updated ${folderName}/${fileName}`)
    } catch (err) {
      return res.status(500).send("Failed to save file. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    if (fileExists && currentVersion === content) return res.send(`Unchanged.`)

    // todo: prettify js, html, and css
    const shouldFormat = filePath.endsWith(".scroll") || filePath.endsWith(".parsers")
    if (shouldFormat) {
      try {
        const formatted = new ScrollFile(content, filePath, scrollFs).formatted // todo: do we need to pass in file path?
        await fsp.writeFile(filePath, formatted, "utf8")
      } catch (err) {
        console.log("Error formatting. Continuing on. Error:", err)
      }
    }

    // Run the scroll build and git commands asynchronously
    try {
      await execAsync(`git add -f ${fileName}; git commit --author="${clientIp} <${clientIp}@${hostname}>"  -m 'Updated ${fileName}'`, { cwd: folderPath })
    } catch (err) {
      return res.status(500).send("Save ok but git step failed, building aborted. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    try {
      await this.buildFolder(folderName, fileName)
    } catch (err) {
      return res.status(500).send("Save and git okay but build did not completely succeed. Error: " + err.toString().replace(/</g, "&lt;"))
    }

    res.send(`Ok`)
    this.updateFolderAndBuildList(folderName)
  }

  async addStory(req, message) {
    let clientIp = req.ip || req.connection.remoteAddress
    const formattedDate = new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" })
    const storyEntry = `${formattedDate} ${clientIp} ${message}\n`
    // Append the new story entry to the story log file
    fs.appendFile(this.storyLogFile, storyEntry, err => (err ? console.error(err) : ""))
  }

  ensureInstalled() {
    const { rootFolder, trashFolder, certsFolder } = this
    if (!fs.existsSync(rootFolder)) fs.mkdirSync(rootFolder)
    if (!fs.existsSync(certsFolder)) fs.mkdirSync(certsFolder)
    if (!fs.existsSync(trashFolder)) fs.mkdirSync(trashFolder)
  }

  ensureTemplatesInstalled() {
    const { rootFolder, templatesFolder } = this
    const templateDirs = fs.readdirSync(templatesFolder)

    for (const dir of templateDirs) {
      const sourcePath = path.join(templatesFolder, dir)
      const destPath = path.join(rootFolder, dir)

      // Check if it's a directory
      const stats = fs.statSync(sourcePath)
      if (!stats.isDirectory()) continue

      if (fs.existsSync(destPath)) return

      // Copy the template folder to the root folder
      execSync(`cp -R ${sourcePath} ${destPath};`, { cwd: rootFolder })

      // Initialize Git repository
      execSync(`git init; git add .; git commit -m 'initial ${dir} template'`, { cwd: destPath })
      this.buildFolderSync(dir)
    }
  }

  // todo: speed this up. throttle?
  async updateFolder(folder) {
    const { rootFolder } = this
    const fullPath = path.join(rootFolder, folder)
    const stats = await fsp.stat(fullPath)

    if (!stats.isDirectory()) return null

    const { ctime, mtime, birthtime } = stats

    // Get number of files and total size
    let fileSize = 0
    let fileCount = 0
    const files = await fsp.readdir(fullPath)

    await Promise.all(
      files.map(async file => {
        const filePath = path.join(fullPath, file)
        const fileStats = await fsp.stat(filePath)
        if (fileStats.isFile()) {
          fileSize += fileStats.size
          fileCount++
        }
      })
    )
    // Get number of git commits, last commit hash, and last commit timestamp
    let commitCount = 0
    let lastCommitHash = ""
    let lastCommitTimestamp = null
    try {
      const gitCommits = await new Promise((resolve, reject) => {
        const gitProcess = spawn("git", ["rev-list", "--count", "HEAD"], { cwd: fullPath })
        let result = ""
        gitProcess.stdout.on("data", data => {
          result += data.toString()
        })
        gitProcess.on("close", code => {
          if (code === 0) {
            resolve(result.trim())
          } else {
            reject(new Error(`git process exited with code ${code}`))
          }
        })
      })
      commitCount = parseInt(gitCommits, 10)

      // Get last commit hash
      lastCommitHash = await new Promise((resolve, reject) => {
        const gitProcess = spawn("git", ["rev-parse", "HEAD"], { cwd: fullPath })
        let result = ""
        gitProcess.stdout.on("data", data => {
          result += data.toString()
        })
        gitProcess.on("close", code => {
          if (code === 0) {
            resolve(result.trim())
          } else {
            reject(new Error(`git process exited with code ${code}`))
          }
        })
      })

      // Get last commit timestamp
      lastCommitTimestamp = await new Promise((resolve, reject) => {
        const gitProcess = spawn("git", ["log", "-1", "--format=%ct"], { cwd: fullPath })
        let result = ""
        gitProcess.stdout.on("data", data => {
          result += data.toString()
        })
        gitProcess.on("close", code => {
          if (code === 0) {
            resolve(new Date(parseInt(result.trim(), 10) * 1000))
          } else {
            reject(new Error(`git process exited with code ${code}`))
          }
        })
      })
    } catch (err) {
      console.error(`Error getting git information for folder: ${folder}`)
    }
    this.folderCache[folder] = {
      folder,
      folderLink: getBaseUrlForFolder(folder, this.hostname, "https:"),
      created: birthtime || ctime,
      revised: lastCommitTimestamp,
      files: fileCount,
      mb: Math.ceil(fileSize / (1024 * 1024)),
      revisions: commitCount,
      hash: lastCommitHash.substr(0, 10)
    }
  }

  async updateFolderAndBuildList(folderName) {
    await this.updateFolder(folderName)
    this.buildListFile()
  }

  async buildFolder(folderName, filePath) {
    const folder = this.folderCache[folderName]
    const scrollFs = new ScrollFileSystem()
    // if fileName and a large folder do a fast build. todo: figure this out better. add dep graph to scrollsdk?
    if (filePath && folder.revisions > 500) {
      const file = new ScrollFile(undefined, filePath, scrollFs)
      await file.buildAll()
      return
    }
    await execAsync(`scroll list | scroll build`, { cwd: path.join(this.rootFolder, folderName) })
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
    const folders = Object.values(this.folderCache)
    const particles = new Particle(folders)
    await fsp.writeFile(path.join(__dirname, "folders.csv"), particles.asCsv, "utf8")
    await fsp.writeFile(path.join(__dirname, "folders.tsv"), particles.asTsv, "utf8")
    await fsp.writeFile(path.join(__dirname, "folders.json"), JSON.stringify(folders, null, 2), "utf8")
    const scroll = `settings.scroll
homeButton
buildHtml
metaTags
theme gazette
title Folders

scrollHubStyle.css

container 1000px
# ${this.hostname} serves ${folders.length} folders.
 index.html ${this.hostname}
 style font-size: 150%;

center
Traffic Data | ScrollHub Version ${packageJson.version}
 requests.html Traffic Data
Download folders as JSON | CSV | TSV
 link folders.json JSON
 link folders.csv CSV
 link folders.tsv TSV

table folders.csv
 compose links <a href="edit.html?folderName={folder}">edit</a> · <a href="{folder}.zip">zip</a>
  select folder folderLink links revised hash files mb revisions
   compose hashLink diff.htm/{folder}
    orderBy -revised
     rename revised lastRevised
      printTable

endColumns
tableSearch
scrollVersionLink`
    await fsp.writeFile(path.join(__dirname, "folders.scroll"), scroll, "utf8")
    await fsp.writeFile(path.join(__dirname, "foldersPublished.html"), `<a id="foldersPublished" class="greyText" href="folders.html">${folders.length} folders</a>`, "utf8")
    await this.buildScrollHubPages()
  }

  async buildScrollHubPages() {
    await execAsync(`scroll build`, { cwd: __dirname })
  }

  handleCreateError(res, params) {
    res.redirect(`/index.html?${new URLSearchParams(params).toString()}`)
  }

  isValidFolderName(name) {
    if (name.length < 2) return false

    // dont allow folder names that look like filenames.
    // also, we reserve ".htm" for ScrollHub dynamic routes
    if (name.includes(".")) {
      const ext = path.extname(name).toLowerCase().slice(1)
      if (this.allowedExtensions.includes(ext)) return false
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
    this.updateFolderAndBuildList(folderName)

    return { folderName }
  }

  loadCertAndKey(hostname) {
    const { certCache, pendingCerts, certsFolder } = this
    if (certCache.has(hostname)) return certCache.get(hostname) // Return from cache if available

    const certPath = path.join(certsFolder, `${hostname}.crt`)
    const keyPath = path.join(certsFolder, `${hostname}.key`)

    // Check if both cert and key files exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const sslOptions = {
        cert: fs.readFileSync(certPath, "utf8"),
        key: fs.readFileSync(keyPath, "utf8")
      }
      certCache.set(hostname, sslOptions) // Cache the cert and key
      return sslOptions
    } else {
      if (pendingCerts[hostname]) return
      this.makeCert(hostname)
      throw new Error(`SSL certificate or key not found for ${hostname}. Attempting to make cert.`)
    }
  }

  async startHttpsServer() {
    const { app, certsFolder } = this
    const tls = require("tls")
    const { CertificateMaker } = require("./CertificateMaker.js")
    const certMaker = new CertificateMaker(app).setupChallengeHandler()

    this.certCache = new Map()
    const pendingCerts = {}
    this.pendingCerts = pendingCerts
    this.makeCert = async domain => {
      pendingCerts[domain] = true
      const email = domain + "@hub.scroll.pub"
      await certMaker.makeCertificate(domain, email, certsFolder)
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

  async startHttpServer() {
    const { app, port } = this
    const httpServer = http.createServer(app)
    httpServer.listen(port, () => console.log(`HTTP server running at http://localhost:${port}`))
    return httpServer
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
