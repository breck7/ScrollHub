// STDLib
const { exec, execSync, spawn } = require("child_process")
const fs = require("fs")
const fsp = require("fs").promises
const os = require("os")
const path = require("path")
const util = require("util")
const execAsync = util.promisify(exec)

// Web server
const express = require("express")
const https = require("https")
const http = require("http")
const fileUpload = require("express-fileupload")
const AnsiToHtml = require("ansi-to-html")

// Git server
const httpBackend = require("git-http-backend")

// PPS
const { Particle } = require("scrollsdk/products/Particle.js")

express.static.mime.define({ "text/plain": ["scroll", "parsers"] })

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

const sanitizeFolderName = name => {
  // if given a url, return the last part
  if (isUrl(name)) name = name.split("/").pop().replace(".git", "")
  return name.toLowerCase().replace(/[^a-z0-9._]/g, "")
}

class ScrollHub {
  constructor() {
    this.app = express()
    const app = this.app
    this.port = 80
    this.maxUploadSize = 100 * 1000 * 1024
    this.allowedExtensions = "scroll parsers txt html htm css json csv tsv psv ssv pdf js jpg jpeg png gif webp svg heic ico mp3 mp4 mkv ogg webm ogv woff2 woff ttf otf tiff tif bmp eps git".split(" ")
    this.hostname = os.hostname()
    this.rootFolder = path.join(__dirname, "folders")
    this.templatesFolder = path.join(__dirname, "templates")
    this.trashFolder = path.join(__dirname, "trash")
    this.folderCache = {}
    this.storyCache = ""
  }

  startAll() {
    this.ensureInstalled()
    this.warmFolderCache()
    this.initVandalProtection()
    this.enableCors()
    this.enableFormParsing()
    this.enableFileUploads()

    this.initAnalytics()
    this.addStory({ ip: "admin" }, "started scrollhub server")

    this.initFileRoutes()
    this.initGitRoutes()
    this.initHistoryRoutes()
    this.initZipRoutes()
    this.initCommandRoutes()

    this.enableStaticFileServing()

    this.initCertRoutes()
    this.init404Routes()
    return this.startServers()
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
    // Serve the folders directory from the root URL
    app.use("/", express.static(rootFolder))

    // Serve the root directory statically
    app.use(express.static(__dirname))

    // New middleware to route domains to the matching folder
    app.use((req, res, next) => {
      const hostname = req.hostname?.toLowerCase()
      if (!hostname || !folderCache[hostname]) return next()

      const folderPath = path.join(rootFolder, hostname)
      express.static(folderPath)(req, res, next)
    })
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

  initAnalytics() {
    this.globalLogFile = path.join(__dirname, "log.txt")
    this.storyLogFile = path.join(__dirname, "now.txt")
    if (!fs.existsSync(this.storyLogFile)) fs.writeFileSync(this.storyLogFile, "", "utf8")
    const { app, folderCache, storyCache } = this
    app.use(this.logRequest.bind(this))
    app.get("/foldersPublished.htm", (req, res) => {
      res.setHeader("Content-Type", "text/plain")
      res.send(Object.values(folderCache).length.toString())
    })

    app.get("/now.htm", (req, res) => {
      res.setHeader("Content-Type", "text/plain")
      res.send(storyCache)
    })

    const { Dashboard } = require("./dashboard.js")
    app.get("/dashboard.csv", async (req, res) => {
      const dashboard = new Dashboard(this.globalLogFile)
      await dashboard.processLogFile()
      const { csv } = dashboard
      res.setHeader("Content-Type", "text/plain")
      res.send(csv)
    })

    app.get("/hostname.htm", (req, res) => res.send(req.hostname))
  }

  async logRequest(req, res, next) {
    const { rootFolder, folderCache, globalLogFile } = this
    const { hostname, method, url, protocol } = req
    const ip = req.ip || req.connection.remoteAddress
    const userAgent = parseUserAgent(req.get("User-Agent") || "Unknown")
    const folderName = this.getFolderName(req)

    const logEntry = `${method === "GET" ? "read" : "write"} ${folderName || hostname} ${protocol}://${hostname}${url} ${Date.now()} ${ip} ${userAgent}\n`

    fs.appendFile(globalLogFile, logEntry, err => {
      if (err) console.error("Failed to log request:", err)
    })

    if (folderName && folderCache[folderName]) {
      const folderPath = path.join(rootFolder, folderName)
      const folderLogFile = path.join(folderPath, "log.txt")
      try {
        await fsp.appendFile(folderLogFile, logEntry)
      } catch (err) {
        console.error(`Failed to log request to folder log (${folderLogFile}):`, err)
      }
    }
    next()
  }

  initGitRoutes() {
    const { app } = this
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
      addStory(req, `cloned ${repo}`)
    })

    // todo: check pw
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
    const { app } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    app.get("/history.htm/:folderName", async (req, res) => {
      const folderName = sanitizeFolderName(req.params.folderName)
      const folderPath = path.join(rootFolder, folderName)
      if (!this.folderCache[folderName]) return res.status(404).send("Folder not found")
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
      if (!this.folderCache[folderName]) return res.status(404).send("Folder not found")
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
  <input type="submit" value="Revert to this commit" onclick="return confirm('Are you sure you want to revert to this commit?');">
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
  <input type="submit" value="Revert to this commit" onclick="return confirm('Are you sure you want to revert to this commit?');">
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

      if (!this.folderCache[folderName]) return res.status(404).send("Folder not found")

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

  initFileRoutes() {
    const { app, rootFolder, folderCache, allowedExtensions } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
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
        const fileExists = await fsp
          .access(filePath)
          .then(() => true)
          .catch(() => false)
        if (!fileExists) return res.status(404).send("File not found")

        const content = await fsp.readFile(filePath, "utf8")
        res.setHeader("Content-Type", "text/plain")
        res.send(content)
      } catch (error) {
        console.error(error)
        res.status(500).send("An error occurred while reading the file")
      }
    })

    app.post("/write.htm", checkWritePermissions, (req, res) => this.writeAndCommitFile(req, res, req.body.filePath, req.body.content))

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
      const fileName = sanitizeFolderName(path.basename(file.name, path.extname(file.name))) + "." + fileExtension
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
      const folderName = sanitizeFolderName(req.query.folderName)
      const fileName = sanitizeFolderName(req.query.fileName)
      const redirectUrl = sanitizeFolderName(req.query.redirect)
      const line = parseInt(req.query.line)
      const particles = req.body.particles

      if (!folderCache[folderName]) {
        return res.status(404).send("Folder not found")
      }

      if (!particles) {
        return res.status(400).send("No particles provided")
      }

      if (!fileName) {
        return res.status(400).send("No filename provided")
      }

      const folderPath = path.join(rootFolder, folderName)
      const filePath = path.join(folderPath, fileName)

      // Check if the file extension is allowed
      if (!extensionOkay(filePath, res)) {
        return
      }

      try {
        // Check if the file exists
        await fsp.access(filePath)

        let content = await fsp.readFile(filePath, "utf8")
        let lines = content.split("\n")

        if (isNaN(line) || line <= 0 || line > lines.length + 1) {
          // Append to the end if line is not provided or invalid
          lines.push(particles)
        } else {
          // Insert at the specified line (adjusting for 0-based array index)
          lines.splice(line - 1, 0, particles)
        }

        content = lines.join("\n")

        await fsp.writeFile(filePath, content, "utf8")

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

      const ok = extensionOkay(filePath, res)
      if (!ok) return

      try {
        const fileExists = await fsp
          .access(filePath)
          .then(() => true)
          .catch(() => false)
        if (!fileExists) return res.status(404).send("File not found")

        const fileName = path.basename(filePath)
        const folderPath = path.dirname(filePath)

        await fsp.unlink(filePath)
        await execAsync(`git rm ${fileName}; git commit -m 'Deleted ${fileName}'`, { cwd: folderPath })
        awaitthis.buildFolder(folderName)

        res.send("File deleted successfully")
        this.addStory(req, `deleted ${fileName} in ${folderName}`)
        this.updateFolderAndBuildList(folderName)
      } catch (error) {
        console.error(error)
        res.status(500).send(`An error occurred while deleting the file:\n ${error.toString().replace(/</g, "&lt;")}`)
      }
    })

    app.post("/trash.htm", checkWritePermissions, async (req, res) => {
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
        zipCache.delete(folderName)

        // Rebuild the list file
        buildListFile()

        addStory(req, `trashed ${folderName}`)

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
      const newFileName = sanitizeFolderName(req.body.newFileName)

      const folderPath = path.join(rootFolder, folderName)
      const oldFilePath = path.join(folderPath, oldFileName)
      const newFilePath = path.join(folderPath, newFileName)

      if (!extensionOkay(oldFilePath, res) || !extensionOkay(newFilePath, res)) return

      try {
        // Check if the old file exists
        await fsp.access(oldFilePath)

        // Rename the file
        await fsp.rename(oldFilePath, newFilePath)

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
  }

  initCommandRoutes() {
    const { app } = this
    const checkWritePermissions = this.checkWritePermissions.bind(this)
    app.get("/build.htm", checkWritePermissions, (req, res) => runCommand(req, res, "build"))
    app.get("/format.htm", checkWritePermissions, (req, res) => runCommand(req, res, "format"))
    app.get("/test.htm", checkWritePermissions, (req, res) => runCommand(req, res, "test"))
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
          zipBuffer = await zipFolder(folderName)
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

      addStory(req, `downloaded ${folderName}.zip`)
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
    this.buildListFile()
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
      res.status(400).send(`Cannot edit a ${fileExtension} file. Only editing of ${allowedExtensions} files is allowed.`)
      return false
    }
    return true
  }

  async writeAndCommitFile(req, res, filePath, content) {
    const { rootFolder } = this
    filePath = path.join(rootFolder, filePath)

    const ok = this.extensionOkay(filePath, res)
    if (!ok) return

    const folderPath = path.dirname(filePath)

    // Check if the folder exists asynchronously
    const folderExists = await fsp
      .access(folderPath)
      .then(() => true)
      .catch(() => false)
    if (!folderExists) return res.status(400).send("Folder does not exist")

    // Extract folder name and file name for the redirect
    const folderName = path.relative(rootFolder, folderPath)
    const fileName = path.basename(filePath)
    const clientIp = req.ip || req.connection.remoteAddress
    const hostname = req.hostname?.toLowerCase()

    try {
      // Write the file content asynchronously
      await fsp.writeFile(filePath, content, "utf8")

      // Run the scroll build and git commands asynchronously
      await execAsync(`scroll list | scroll format; git add -f ${fileName}; git commit --author="${clientIp} <${clientIp}@${hostname}>"  -m 'Updated ${fileName}'`, { cwd: folderPath })
      await this.buildFolder(folderName)

      res.redirect(`/edit.html?folderName=${folderName}&fileName=${fileName}`)
      this.addStory(req, `updated ${folderName}/${fileName}`)
      this.updateFolderAndBuildList(folderName)
    } catch (error) {
      console.error(error)
      res.status(500).send(`An error occurred while writing the file or rebuilding the folder:\n ${error.toString().replace(/</g, "&lt;")}`)
    }
  }

  async addStory(req, message) {
    let clientIp = req.ip || req.connection.remoteAddress
    const formattedDate = new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" })
    const storyEntry = `${formattedDate} ${clientIp} ${message}\n`
    // Append the new story entry to the story log file
    fs.appendFile(this.storyLogFile, storyEntry, err => (err ? console.error(err) : ""))
    this.storyCache = storyEntry + this.storyCache
  }

  ensureInstalled() {
    const { rootFolder, templatesFolder, trashFolder } = this
    if (!fs.existsSync(rootFolder)) execSync(`cp -R ${templatesFolder} ${rootFolder};`)
    if (!fs.existsSync(trashFolder)) fs.mkdirSync(trashFolder)
  }

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

    // Get number of git commits
    let commitCount = 0
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
    } catch (err) {
      console.error(`Error getting git commits for folder: ${folder}`)
    }

    this.folderCache[folder] = {
      folder,
      folderLink: folder + "/",
      created: birthtime || ctime,
      modified: mtime,
      files: fileCount,
      mb: Math.ceil(fileSize / (1024 * 1024)),
      revisions: commitCount
    }
  }

  async updateFolderAndBuildList(folderName) {
    await this.updateFolder(folderName)
    this.buildListFile()
  }

  async buildFolder(folderName) {
    await execAsync(`scroll list | scroll build`, { cwd: path.join(this.rootFolder, folderName) })
  }

  getFolderName(req) {
    const folderName = req.body?.folderName || req.query?.folderName
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

style.css

container 1000px
${this.hostname} serves ${folders.length} folders.
 index.html ${this.hostname}

JSON | CSV | TSV
 link folders.json JSON
 link folders.csv CSV
 link folders.tsv TSV

table folders.csv
 compose links <a href="edit.html?folderName={folder}">edit</a> · <a href="{folder}.zip">zip</a> · <a href="index.html?folderName={folder} ">clone</a> · <a href="diff.htm/{folder}">history</a>
  select folder folderLink links modified files mb revisions
   orderBy -modified
    rename modified updatedtime
     printTable

endColumns
tableSearch
scrollVersionLink`
    await fsp.writeFile(path.join(__dirname, "folders.scroll"), scroll, "utf8")
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
    if (/^[a-z][a-z0-9._]*$/.test(name)) return true
    return false
  }

  async createFolder(rawInput) {
    const { rootFolder, folderCache } = this
    const parts = rawInput.split(" ")
    let template = ""
    let folderName = ""
    if (parts.length > 1) {
      template = parts.shift()
      if (folderCache[template]) {
        folderName = parts.join(" ")
      } else {
        template = "blank"
        folderName = sanitizeFolderName(rawInput)
      }
    } else {
      folderName = sanitizeFolderName(rawInput)
      template = isUrl(rawInput) ? rawInput : "blank"
    }
    if (!this.isValidFolderName(folderName))
      return {
        errorMessage: `Sorry, your folder name "${folderName}" did not meet our requirements. It should start with a letter a-z, be more than 1 character, and not end in a common file extension.`,
        folderName: rawInput
      }

    if (folderCache[folderName]) return { errorMessage: `Sorry a folder named "${folderName}" already exists on this server.`, folderName: rawInput }

    if (isUrl(template)) {
      try {
        new URL(template)
      } catch (err) {
        return { errorMessage: `Invalid template url.`, folderName: rawInput }
      }
      await execAsync(`git clone ${template} ${folderName}`, { cwd: rootFolder })
      await buildFolder(folderName)
    } else {
      await execAsync(`cp -R ${template} ${folderName};`, { cwd: rootFolder })
      this.updateFolderAndBuildList(folderName)
    }

    return { folderName }
  }

  async runCommand(req, res, command) {
    const { rootFolder } = this
    const folderName = sanitizeFolderName(req.query.folderName)
    const folderPath = path.join(rootFolder, folderName)

    if (!this.folderCache[folderName]) return res.status(404).send("Folder not found")

    try {
      const { stdout } = await execAsync(`scroll list | scroll ${command}`, { cwd: folderPath })
      res.send(stdout.toString())
    } catch (error) {
      console.error(`Error running '${command}' in '${folderName}':`, error)
      res.status(500).send(`An error occurred while running '${command}' in '${folderName}'`)
    }
  }

  async initCertRoutes() {
    const { app } = this
    const tls = require("tls")
    const { CertificateMaker } = require("./CertificateMaker.js")
    const certMaker = new CertificateMaker(app).setupChallengeHandler()

    this.pendingCerts = {}
    const makeCert = async domain => {
      pendingCerts[domain] = true
      const email = domain + "@hub.scroll.pub"
      await certMaker.makeCertificate(domain, email, __dirname)
    }

    // Dynamic HTTPS server using SNI (Server Name Indication)
    const httpsServer = https.createServer(
      {
        SNICallback: (hostname, cb) => {
          try {
            const sslOptions = loadCertAndKey(hostname.toLowerCase())
            cb(null, tls.createSecureContext(sslOptions))
          } catch (err) {
            console.error(`Error setting up SSL for ${hostname}: ${err.message}`)
            cb(err)
          }
        }
      },
      app
    )

    httpsServer.listen(443, () => console.log("HTTPS server running on port 443"))
  }

  async startServers() {
    const { app, port, pendingCerts } = this
    const httpServer = http.createServer(app)
    httpServer.listen(port, () => console.log(`HTTP server running at http://localhost:${port}`))

    // In-memory cache for storing certificate and key pairs
    const certCache = new Map()

    // Function to load the certificate and key files (with caching)
    const loadCertAndKey = hostname => {
      if (certCache.has(hostname)) return certCache.get(hostname) // Return from cache if available

      const certPath = path.join(__dirname, `${hostname}.crt`)
      const keyPath = path.join(__dirname, `${hostname}.key`)

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
        makeCert(hostname)
        throw new Error(`SSL certificate or key not found for ${hostname}. Attempting to make cert.`)
      }
    }
  }
}

module.exports = { ScrollHub }
