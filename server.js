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
const rateLimit = require("express-rate-limit")
const fileUpload = require("express-fileupload")

// Git server
const httpBackend = require("git-http-backend")

// PPS
const { Particle } = require("scrollsdk/products/Particle.js")

const app = express()
const port = 80
const rateLimitSeconds = 0.1
const maxSize = 10 * 1000 * 1024
const allowedExtensions = "scroll parsers txt html htm css json csv tsv psv ssv pdf js jpg jpeg png gif webp svg heic ico mp3 mp4 mkv ogg webm ogv woff2 woff ttf otf tiff tif bmp eps".split(" ")
const hostname = os.hostname()
const rootFolder = path.join(__dirname, "folders")

app.use(express.urlencoded({ extended: true }))
app.use(fileUpload({ limits: { fileSize: maxSize } }))
if (!fs.existsSync(rootFolder)) fs.mkdirSync(rootFolder)

const createLimiter = rateLimit({
	windowMs: rateLimit * 1000,
	max: 1,
	message: `Sorry, you exceeded 1 folder every ${rateLimitSeconds} seconds`,
	standardHeaders: true,
	legacyHeaders: false
})

const sanitizeFolderName = name => name.toLowerCase().replace(/[^a-z0-9._]/g, "")

const isValidFolderName = name => /^[a-z][a-z0-9._]*$/.test(name) && name.length > 0

app.get("/foldersPublished", (req, res) => {
	res.setHeader("Content-Type", "text/plain")
	res.send(Object.values(folderCache).length.toString())
})

const updateFolder = async folder => {
	const fullPath = path.join(rootFolder, folder)
	const stats = await fsp.stat(fullPath)

	if (!stats.isDirectory()) return null

	const { ctime, mtime } = stats

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
		editUrl: `edit.html?folderName=${folder}&fileName=index.scroll`,
		ctime,
		mtime,
		files: fileCount,
		MB: (fileSize / (1024 * 1024)).toFixed(3),
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
gazetteCss
title Folders

<link rel="stylesheet" type="text/css" href="style.css" />

wideColumns 1
${hostname} serves ${folders.length} folders.
 link / ${hostname}

table
 orderBy -ctime
  printTable
 data
  ${new Particle(folders).asCsv.replace(/\n/g, "\n  ")}

endColumns
tableSearch
scrollVersionLink`
	await fsp.writeFile(path.join(__dirname, "list.scroll"), scroll, "utf8")
	await execAsync(`scroll build`, { cwd: __dirname })
}

app.get("/createFromForm", (req, res) => res.redirect(`/create/${req.query.folderName}`))

// ideas: single page, blog, knowledge base.
const stamps = {
	bare: `stamp
 header.scroll
  importOnly
  buildHtml
  buildTxt
  metaTags
  gazetteCss
  homeButton
  viewSourceButton
  printTitle
  mediumColumns 1
 index.scroll
  header.scroll
  title Hello world
  
  Welcome to my folder.
  
  scrollVersionLink
 .gitignore
  *.html
  *.txt
  *.xml`
}

const handleCreateError = (res, params) => res.redirect(`/index.html?${new URLSearchParams(params).toString()}`)

app.get("/create/:folderName(*)", createLimiter, async (req, res) => {
	const rawInput = req.params.folderName
	let inputFolderName = rawInput
	let template = ""

	if (rawInput.includes("~")) {
		const particle = new Particle(rawInput.replace(/~/g, "\n"))
		inputFolderName = particle.particleAt(0).getLine()
		template = particle.particleAt(1).getLine()
	}

	const folderName = sanitizeFolderName(inputFolderName)
	const folderPath = path.join(rootFolder, folderName)

	if (!isValidFolderName(folderName))
		return handleCreateError(res, { errorMessage: `Sorry, your folder name "${folderName}" did not meet our requirements. It should start with a letter a-z, be more than 1 character, and pass a few other checks.`, folderName: rawInput })

	if (folderCache[folderName]) return handleCreateError(res, { errorMessage: `Sorry a folder named "${folderName}" already exists on this server.`, folderName: rawInput })

	try {
		if (template) {
			const isUrl = template.startsWith("https") || template.startsWith("http")
			if (isUrl) {
				try {
					new URL(template)
				} catch (err) {
					return handleCreateError(res, { errorMessage: `Invalid template url.`, folderName: rawInput })
				}
				await execAsync(`git clone ${template} ${folderName} && cd ${folderName} && scroll build`, { cwd: rootFolder })
			} else {
				template = sanitizeFolderName(template)
				const templatePath = path.join(rootFolder, template)
				try {
					await fsp.access(templatePath)
				} catch (err) {
					return handleCreateError(res, { errorMessage: `Sorry, template folder "${template}" does not exist.`, folderName: rawInput })
				}
				await execAsync(`cp -R ${templatePath} ${folderPath};`, { cwd: rootFolder })
			}
		} else await execAsync(`mv ${path.join(__dirname, "blankTemplate")} ${folderPath}`)

		res.redirect(`/edit.html?folderName=${folderName}&fileName=index.scroll`)
		prepNext(folderName)
	} catch (error) {
		console.error(error)
		res.status(500).send("Sorry, an error occurred while creating the folder:", error)
	}
})

const updateFolderAndBuildList = async folderName => {
	await updateFolder(folderName)
	buildListFile()
}

const prepNext = async folderName => {
	cookNext()
	updateFolderAndBuildList(folderName)
}

const cookNext = async () => {
	const folderPath = path.join(__dirname, "blankTemplate")
	const folderExists = await fsp
		.access(folderPath)
		.then(() => true)
		.catch(() => false)

	if (folderExists) return

	await fsp.mkdir(folderPath, { recursive: true })

	const stamp = stamps.bare
	await fsp.writeFile(path.join(folderPath, "stamp.scroll"), stamp, "utf8")

	await execAsync("scroll build; rm stamp.scroll; scroll format; git init --initial-branch=main; git add *.scroll; git commit -m 'Initial commit'; scroll build", { cwd: folderPath })
}
cookNext()
app.get("/ls", async (req, res) => {
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

app.get("/build", (req, res) => runCommand(req, res, "build"))
app.get("/format", (req, res) => runCommand(req, res, "format"))
app.get("/test", (req, res) => runCommand(req, res, "test"))

app.get("/git/:repo/*", (req, res) => {
	const repo = req.params.repo
	const repoPath = path.join(rootFolder, repo)

	req.url = "/" + req.url.split("/").slice(3).join("/")

	const handlers = httpBackend(req.url, (err, service) => {
		if (err) return res.end(err + "\n")

		res.setHeader("content-type", service.type)

		const ps = spawn(service.cmd, service.args.concat(repoPath))
		ps.stdout.pipe(service.createStream()).pipe(ps.stdin)
	})

	req.pipe(handlers).pipe(res)
})

// todo: check pw
app.post("/git/:repo/*", async (req, res) => {
	const repo = req.params.repo
	const repoPath = path.join(rootFolder, repo)

	req.url = "/" + req.url.split("/").slice(3).join("/")

	const handlers = httpBackend(req.url, (err, service) => {
		if (err) return res.end(err + "\n")

		res.setHeader("content-type", service.type)

		const ps = spawn(service.cmd, service.args.concat(repoPath))
		ps.stdout.pipe(service.createStream()).pipe(ps.stdin)

		// Handle Git pushes asynchronously and build the scroll
		ps.on("close", async code => {
			if (code === 0 && service.action === "push") {
				await execAsync(`scroll build`, { cwd: repoPath })
				updateFolderAndBuildList(folderName)
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

app.get("/read", async (req, res) => {
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

const writeFile = async (res, filePath, content) => {
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

	try {
		// Write the file content asynchronously
		await fsp.writeFile(filePath, content, "utf8")

		// Run the scroll build and git commands asynchronously
		await execAsync(`scroll format; git add ${fileName}; git commit -m 'Updated ${fileName}'; scroll build`, { cwd: folderPath })

		res.redirect(`/edit.html?folderName=${folderName}&fileName=${fileName}`)
		updateFolderAndBuildList(folderName)
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while writing the file or rebuilding the folder:\n ${error.toString().replace(/</g, "&lt;")}`)
	}
}

app.get("/history/:folderName", async (req, res) => {
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

app.get("/write", (req, res) => writeFile(res, decodeURIComponent(req.query.filePath), decodeURIComponent(req.query.content)))
app.post("/write", (req, res) => writeFile(res, req.body.filePath, req.body.content))

// Add a route for file uploads
app.post("/upload", async (req, res) => {
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

// Serve the folders directory from the root URL
app.use("/", express.static(rootFolder))

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

	// Middleware to redirect HTTP to HTTPS
	app.use((req, res, next) => {
		if (!req.secure) return res.redirect("https://" + req.headers.host + req.url)

		next()
	})

	// Create a simple HTTP server that redirects all traffic to HTTPS
	const httpApp = express()
	httpApp.use((req, res) => res.redirect("https://" + req.headers.host + req.url))

	http.createServer(httpApp).listen(port, () => console.log("HTTP server running, redirecting to HTTPS"))
}

startServers(app)
