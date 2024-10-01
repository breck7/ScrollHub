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

// Git server
const httpBackend = require("git-http-backend")

// PPS
const { Particle } = require("scrollsdk/products/Particle.js")
const hotTemplatesPath = path.join(__dirname, "hotTemplates")
const templatesFolder = path.join(__dirname, "templates")
const templates = new Set(fs.readdirSync(templatesFolder).filter(file => fs.statSync(path.join(templatesFolder, file)).isDirectory()))

const app = express()
const port = 80
const maxSize = 10 * 1000 * 1024
const allowedExtensions = "scroll parsers txt html htm css json csv tsv psv ssv pdf js jpg jpeg png gif webp svg heic ico mp3 mp4 mkv ogg webm ogv woff2 woff ttf otf tiff tif bmp eps git".split(" ")
const hostname = os.hostname()
const rootFolder = path.join(__dirname, "folders")

const logFile = path.join(__dirname, "log.txt")

const logRequest = (req, res, next) => {
	const ip = req.ip || req.connection.remoteAddress
	const userAgent = req.get("User-Agent") || "Unknown"
	const log = `${new Date().toISOString()} ${ip} "${req.method} ${req.url}" "${userAgent}"\n`

	fs.appendFile(logFile, log, err => {
		if (err) console.error("Failed to log request:", err)
	})
	next()
}
app.use(logRequest)

app.use(express.urlencoded({ extended: true }))
app.use(fileUpload({ limits: { fileSize: maxSize } }))
if (!fs.existsSync(rootFolder)) fs.mkdirSync(rootFolder)

// Refresh hot templates path
if (fs.existsSync(hotTemplatesPath)) fs.rmSync(hotTemplatesPath, { recursive: true, force: true })
fs.mkdirSync(hotTemplatesPath)

const isUrl = str => str.startsWith("http://") || str.startsWith("https://")

const sanitizeFolderName = name => {
	// if given a url, return the last part
	if (isUrl(name)) name = name.split("/").pop().replace(".git", "")
	return name.toLowerCase().replace(/[^a-z0-9._]/g, "")
}

const isValidFolderName = name => {
	if (name.length < 2) return false

	// dont allow folder names that look like filenames.
	// also, we reserve ".htm" for ScrollHub dynamic routes
	if (name.includes(".")) {
		const ext = path.extname(name).toLowerCase().slice(1)
		if (allowedExtensions.includes(ext)) return false
	}
	if (/^[a-z][a-z0-9._]*$/.test(name)) return true
	return false
}

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

const allowedIPs = readAllowedIPs()
const annoyingIps = new Set(["24.199.111.182", "198.54.134.120"])
const writeLimit = 30 // Maximum number of writes per minute
const writeWindow = 60 * 1000 // 1 minute in milliseconds
const ipWriteOperations = new Map()

const checkWritePermissions = (req, res, next) => {
	let clientIp = req.ip || req.connection.remoteAddress

	clientIp = clientIp.replace(/^::ffff:/, "")

	const msg =
		"Your IP has been temporarily throttled. If this was a mistake, I apologize--please let me know breck7@gmail.com. If not, instead of attacking each other, let's build together. The universe is a vast place. https://github.com/breck7/ScrollHub"

	if (annoyingIps.has(clientIp)) return res.status(403).send(msg)

	const now = Date.now()
	const writeTimes = ipWriteOperations.get(clientIp) || []
	const recentWrites = writeTimes.filter(time => now - time < writeWindow)

	if (recentWrites.length >= writeLimit) {
		console.log(`Write limit exceeded for IP: ${clientIp}`)
		annoyingIps.add(clientIp)
		return res.status(429).send(msg)
	}

	recentWrites.push(now)
	ipWriteOperations.set(clientIp, recentWrites)

	if (allowedIPs === null || allowedIPs.has(clientIp)) return next()

	res.status(403).send(msg)
}

// Cleanup function to remove old entries from ipWriteOperations
const cleanupWriteOperations = () => {
	const now = Date.now()
	for (const [ip, times] of ipWriteOperations.entries()) {
		const recentWrites = times.filter(time => now - time < writeWindow)
		if (recentWrites.length === 0) {
			ipWriteOperations.delete(ip)
		} else {
			ipWriteOperations.set(ip, recentWrites)
		}
	}
}

// Run cleanup every 20 minutes
setInterval(cleanupWriteOperations, 20 * 60 * 1000)

app.get("/foldersPublished.htm", (req, res) => {
	res.setHeader("Content-Type", "text/plain")
	res.send(Object.values(folderCache).length.toString())
})

const updateFolder = async folder => {
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

	folderCache[folder] = {
		folder,
		folderLink: folder + "/",
		created: birthtime || ctime,
		modified: mtime,
		files: fileCount,
		mb: (fileSize / (1024 * 1024)).toFixed(3),
		commits: commitCount
	}
}

const folderCache = {}

const initCache = async () => {
	const folders = await fsp.readdir(rootFolder)
	await Promise.all(folders.map(updateFolder))
	buildListFile()
}
initCache()

const buildListFile = async () => {
	const folders = Object.values(folderCache)
	const scroll = `settings.scroll
homeButton
buildHtml
metaTags
theme gazette
title Folders

style.css

container 1000px
${hostname} serves ${folders.length} folders.
 index.html ${hostname}

table
 compose links <a href="edit.html?folderName={folder}">edit</a> · <a href="{folder}.zip">zip</a> · <a href="index.html?template={folder}">clone</a> · <a href="history.htm/{folder}">history</a>
  select folder folderLink links modified files mb commits
   orderBy -modified
    rename modified updatedtime
     printTable
 data
  ${new Particle(folders).asCsv.replace(/\n/g, "\n  ")}

endColumns
tableSearch
scrollVersionLink`
	await fsp.writeFile(path.join(__dirname, "list.scroll"), scroll, "utf8")
	await execAsync(`scroll build`, { cwd: __dirname })
}

app.get("/createFromForm.htm", (req, res) => res.redirect(`/create.htm/${req.query.folderName || " "}?template=${req.query.template}`))

const handleCreateError = (res, params) => res.redirect(`/index.html?${new URLSearchParams(params).toString()}`)

app.get("/create.htm/:folderName(*)", checkWritePermissions, async (req, res) => {
	const rawInput = req.params.folderName.trim()
	let folderName = sanitizeFolderName(rawInput)
	let template = req.query.template || "blank"
	if (isUrl(rawInput)) {
		const words = rawInput.split(" ")
		template = words[0]
		if (words.length > 1) folderName = sanitizeFolderName(words[1])
	}

	if (!isValidFolderName(folderName))
		return handleCreateError(res, {
			errorMessage: `Sorry, your folder name "${folderName}" did not meet our requirements. It should start with a letter a-z, be more than 1 character, and pass a few other checks.`,
			folderName: rawInput,
			template
		})

	if (folderCache[folderName]) return handleCreateError(res, { errorMessage: `Sorry a folder named "${folderName}" already exists on this server.`, folderName, template })

	try {
		if (isUrl(template)) {
			const aborted = await buildFromUrl(template, folderName, res)
			if (aborted) return aborted
		} else {
			const aborted = await buildFromTemplate(template, folderName, res)
			if (aborted) return aborted
		}

		res.redirect(`/edit.html?folderName=${folderName}`)
		prepNext(folderName, template)
	} catch (error) {
		console.error(error)
		res.status(500).send("Sorry, an error occurred while creating the folder:", error)
	}
})

const buildFromUrl = async (url, folderName, res) => {
	try {
		new URL(url)
	} catch (err) {
		handleCreateError(res, { errorMessage: `Invalid template url.`, folderName, template: url })
		return true
	}
	await execAsync(`git clone ${url} ${folderName} && cd ${folderName} && scroll build`, { cwd: rootFolder })
	return false
}

const buildFromTemplate = async (template, folderName, res) => {
	const folderPath = path.join(rootFolder, folderName)
	if (templates.has(template)) {
		await execAsync(`mv ${path.join(hotTemplatesPath, template)} ${folderPath}`)
		return false
	}

	template = sanitizeFolderName(template)
	const templatePath = path.join(rootFolder, template)
	try {
		await fsp.access(templatePath)
	} catch (err) {
		handleCreateError(res, { errorMessage: `Sorry, template folder "${template}" does not exist.`, folderName, template })
		return true
	}
	await execAsync(`cp -R ${templatePath} ${folderPath};`, { cwd: rootFolder })
	return false
}

const updateFolderAndBuildList = async folderName => {
	await updateFolder(folderName)
	buildListFile()
}

const prepNext = async (folderName, template) => {
	cookNext(template)
	updateFolderAndBuildList(folderName)
}

const cookNext = async templateName => {
	if (!templates.has(templateName)) return
	const folderPath = path.join(hotTemplatesPath, templateName)
	const folderExists = await fsp
		.access(folderPath)
		.then(() => true)
		.catch(() => false)

	if (folderExists) return

	await execAsync(`cp -R ${templatesFolder}/${templateName} ${folderPath};`, { cwd: rootFolder })
	await execAsync(`scroll build; rm stamp.scroll; scroll format; git init --initial-branch=main; git add *.scroll; git commit -m 'Initial commit from ${templateName} template'; scroll build`, { cwd: folderPath })
}
Array.from(templates).map(cookNext)
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

const runCommand = async (req, res, command) => {
	const folderName = sanitizeFolderName(req.query.folderName)
	const folderPath = path.join(rootFolder, folderName)

	if (!folderCache[folderName]) return res.status(404).send("Folder not found")

	try {
		const { stdout } = await execAsync(`scroll ${command}`, { cwd: folderPath })
		res.send(stdout.toString())
	} catch (error) {
		console.error(`Error running '${command}' in '${folderName}':`, error)
		res.status(500).send(`An error occurred while running '${command}' in '${folderName}'`)
	}
}

app.get("/build.htm", checkWritePermissions, (req, res) => runCommand(req, res, "build"))
app.get("/format.htm", checkWritePermissions, (req, res) => runCommand(req, res, "format"))
app.get("/test.htm", checkWritePermissions, (req, res) => runCommand(req, res, "test"))

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
				await execAsync(`scroll build`, { cwd: repoPath })
				updateFolderAndBuildList(repo)
			}
		})
	})
	req.pipe(handlers).pipe(res)
})

const extensionOkay = (filepath, res) => {
	const fileExtension = path.extname(filepath).toLowerCase().slice(1)
	if (!allowedExtensions.includes(fileExtension)) {
		res.status(400).send(`Cannot edit a ${fileExtension} file. Only editing of ${allowedExtensions} files is allowed.`)
		return false
	}
	return true
}

app.get("/read.htm", async (req, res) => {
	const filePath = path.join(rootFolder, decodeURIComponent(req.query.filePath))

	const ok = extensionOkay(filePath, res)
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

const writeAndCommitFile = async (req, res, filePath, content) => {
	filePath = path.join(rootFolder, filePath)

	const ok = extensionOkay(filePath, res)
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
	const hostname = req.hostname

	try {
		// Write the file content asynchronously
		await fsp.writeFile(filePath, content, "utf8")

		// Run the scroll build and git commands asynchronously
		await execAsync(`scroll format; git add ${fileName}; git commit --author="${clientIp} <${clientIp}@${hostname}>"  -m 'Updated ${fileName}'; scroll build`, { cwd: folderPath })

		res.redirect(`/edit.html?folderName=${folderName}&fileName=${fileName}`)
		updateFolderAndBuildList(folderName)
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while writing the file or rebuilding the folder:\n ${error.toString().replace(/</g, "&lt;")}`)
	}
}

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

app.get("/write.htm", checkWritePermissions, (req, res) => writeAndCommitFile(req, res, decodeURIComponent(req.query.filePath), decodeURIComponent(req.query.content)))
app.post("/write.htm", checkWritePermissions, (req, res) => writeAndCommitFile(req, res, req.body.filePath, req.body.content))

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

	if (file.size > maxSize) return res.status(400).send("File size exceeds the maximum limit of 1MB.")

	// Save file to disk
	const fileName = sanitizeFolderName(path.basename(file.name, path.extname(file.name))) + "." + fileExtension
	const filePath = path.join(folderPath, fileName)

	try {
		// Use async `mv` with `await`
		await file.mv(filePath)

		// Run git and scroll commands asynchronously
		await execAsync(`git add ${fileName}; git commit -m 'Added ${fileName}'; scroll build`, { cwd: folderPath })

		res.send("File uploaded successfully")
		updateFolderAndBuildList(folderName)
	} catch (err) {
		console.error(err)
		res.status(500).send("An error occurred while uploading or processing the file.")
	}
})

const zipCache = new Map()
const zipFolder = async folderName => {
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
})

// Silly SSL stuff
const { CertificateMaker } = require("./CertificateMaker.js")
const certMaker = new CertificateMaker(app).setupChallengeHandler()
app.get("/cert.htm", checkWritePermissions, async (req, res) => {
	try {
		const domain = req.query.domain
		if (!domain) return res.status(500).send("No domain provided")
		if (fs.existsSync(`${domain}.crt`)) return res.status(500).send(`Certificate already exists for '${domain}'`)
		const email = domain + "@hub.scroll.pub"
		const { certificate, domainKey } = await certMaker.makeCertificate(domain, email, __dirname)
		res.send("ok")
	} catch (error) {
		console.error("Failed to obtain certificates:", error)
		res.status(500).send("Failed to obtain certificates: " + error)
	}
})

app.delete("/delete.htm", checkWritePermissions, async (req, res) => {
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
		await execAsync(`git rm ${fileName}; git commit -m 'Deleted ${fileName}'; scroll build`, { cwd: folderPath })

		res.send("File deleted successfully")
		updateFolderAndBuildList(folderName)
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while deleting the file:\n ${error.toString().replace(/</g, "&lt;")}`)
	}
})

// Static file serving comes AFTER our routes, so if someone creates a folder with a route name, our route name wont break.
// todo: would be nicer to additionally make those folder names reserved, and provide a clientside script to people
// of what names are taken, for instant feedback.

// Middleware to serve .scroll files as plain text
// This should come BEFORE the static file serving middleware
app.use(async (req, res, next) => {
	if (!req.url.endsWith(".scroll")) return next()

	const filePath = path.join(rootFolder, decodeURIComponent(req.url))

	try {
		await fsp.access(filePath)
		res.setHeader("Content-Type", "text/plain; charset=utf-8")
		res.sendFile(filePath)
	} catch (err) {
		next()
	}
})

// New middleware to route domains to the matching folder
app.use((req, res, next) => {
	const hostname = req.hostname
	if (!folderCache[hostname]) return next()

	const folderPath = path.join(rootFolder, hostname)
	express.static(folderPath)(req, res, next)
})

// Serve the folders directory from the root URL
app.use("/", express.static(rootFolder))

app.get("/hostname.htm", (req, res) => res.send(req.hostname))

// Serve the root directory statically
app.use(express.static(__dirname))

const startServers = app => {
	const filepath = path.join(__dirname, "privkey.pem")
	if (!fs.existsSync(filepath)) {
		http.createServer(app).listen(port, () => console.log(`Server running at http://localhost:${port}`))
		return false
	}

	// Load SSL certificates
	const sslOptions = {
		key: fs.readFileSync("privkey.pem"),
		cert: fs.readFileSync("fullchain.pem")
	}

	// HTTPS server
	https.createServer(sslOptions, app).listen(443, () => console.log("HTTPS server running on port 443"))

	// Use the main app for both HTTP and HTTPS servers
	http.createServer(app).listen(port, () => console.log("HTTP server running on port " + port))
}

startServers(app)
