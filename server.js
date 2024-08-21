/*

ServerJS has these routes:

/createFromForm (GET)
 params: folderName
 redirects to GET: create/[FolderName]
/create (GET)
 example: create/breckyunits.com
 parameters: folderName
 Takes a foldername and creates a site in this folder on the server.
 - First it sanitizes the name, allowing only a-z and 0-9, all lowercase, and periods and underscores.
  - Folders cannot start with numbers or periods or underscores
  - it rate limits to 1 site per IP per 10 seconds
   - if someone creates sites too fast, it says "You are creating sites too fast"
  - If the sanitized name already exists, or is less than 1 character, display an error message and return HTTP server error.
 - Then it runs mkdir
  - Then it runs, through exec sync, "scroll init" in that folder
   - Then it runs, scroll build
 - Then it redirects user to /edit/folderName
/build (GET)
 example: build/breckyunits.com
  - This runs "scroll build" on the folder name provided, using execSync, if the folder exists
/edit (GET)
 example: edit/folderName 
/format (GET)
 example: format/folderName
 - This runs "scroll format" on the folder name provided, using execSync, if the folder exists and dumps the results to user
/test (GET)
 example: test/folderName
 - This runs "scroll test" on the folder name provided, using execSync, if the folder exists, and dumps the results to user
/siteCounter (GET)
 - returns number of sites created
/ls (GET)
 example: ls/folderName
 - This runs "ls *.scroll" in folderName and returns the results as plain text one filename per line
/read (GET)
 example: read/{filePath}
 - This takes filePath param, which can be a deep multipart path, and returns the contents of the file as plain text
 - Verify the provided path ends with .scroll.
/write (GET)
 example: write?filePath=${filePath}&content=${content}
  - This takes filepath param, which can be a deep multpart path, and writes the content in content to disk.
  - Verify the file ends with .scroll
  - It vierfies the folder exists
  - It then runs scroll build on the folder provided
  - It uri decodes the filePath and content params first.



It should also serve this folder statically

*/

const express = require("express")
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const rateLimit = require("express-rate-limit")
const httpBackend = require("git-http-backend")
const { spawn } = require("child_process")
const { TreeNode } = require("scrollsdk/products/TreeNode.js")

const app = express()
const port = 80

// Middleware to parse URL-encoded bodies (form data)
app.use(express.urlencoded({ extended: true }))

const sitesFolder = path.join(__dirname, "sites")
if (!fs.existsSync(sitesFolder)) fs.mkdirSync(sitesFolder)

// Rate limiting middleware
const rateLimitSeconds = 0.1
const createLimiter = rateLimit({
	windowMs: rateLimit * 1000, // 10 seconds
	max: 1, // limit each IP to 1 request per windowMs
	message: `Sorry, you exceeded 1 site every ${rateLimitSeconds} seconds`,
	standardHeaders: true,
	legacyHeaders: false
})

// Sanitize folder name
const sanitizeFolderName = name => name.toLowerCase().replace(/[^a-z0-9._]/g, "")

// Validate folder name
const isValidFolderName = name => /^[a-z][a-z0-9._]*$/.test(name) && name.length > 0

app.get("/foldersPublished", (req, res) => {
	res.setHeader("Content-Type", "text/plain")
	res.send(allFolders.length.toString())
})

const getFolders = () => {
	const all = fs.readdirSync(sitesFolder).map(folder => {
		const fullPath = path.join(sitesFolder, folder)
		const stats = fs.statSync(fullPath)
		if (!stats.isDirectory()) return null
		const { ctime, mtime } = stats
		return {
			folder,
			folderLink: folder + "/",
			created: new Date(ctime).toLocaleString()
		}
	})
	return all.filter(i => i)
}

let allFolders
const updateList = () => {
	allFolders = getFolders()
	const scroll = `import settings.scroll
homeButton
buildHtml
metaTags
gazetteCss
title Folders

<link rel="stylesheet" type="text/css" href="style.css" />

mediumColumns 1
${allFolders.length} published folders on this server

table
 printTable
 data
  ${new TreeNode(allFolders).asCsv.replace(/\n/g, "\n  ")}

endColumns
tableSearch
scrollVersionLink`
	fs.writeFileSync(path.join(__dirname, "list.scroll"), scroll, "utf8")
	execSync(`scroll build`, { cwd: __dirname })
}

updateList()

app.get("/createFromForm", (req, res) => res.redirect(`/create/${req.query.folderName}`))

// ideas: single page, blog, knowledge base.
const stamps = {
	bare: `stamp
 header.scroll
  buildHtml
  buildTxt
  metaTags
  gazetteCss
  homeButton
  viewSourceButton
  printTitle
  mediumColumns 1
 index.scroll
  import header.scroll
  title Hello world
  
  Welcome to my website.
  
  scrollVersionLink
 .gitignore
  *.html
  *.txt
  *.xml`
}

const handleCreateError = (res, params) => res.redirect(`/index.html?${new URLSearchParams(params).toString()}`)

app.get("/create/:folderName(*)", createLimiter, (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(sitesFolder, folderName)

	if (!isValidFolderName(folderName)) return handleCreateError(res, { errorMessage: `Sorry, your folder name "${folderName}" did not meet our requirements. It should start with a letter a-z and pass a few other checks.`, folderName })

	if (fs.existsSync(folderPath)) return handleCreateError(res, { errorMessage: `Sorry a folder named "${folderName}" already exists on this server.`, folderName })

	try {
		fs.mkdirSync(folderPath, { recursive: true })
		const stamp = stamps.bare
		fs.writeFileSync(path.join(folderPath, "stamp.scroll"), stamp, "utf8")
		execSync("scroll build; rm stamp.scroll; scroll format; git init; git add *.scroll; git commit -m 'Initial commit'; scroll build", { cwd: folderPath })
		updateList()
		res.redirect(`/edit.html?folderName=${folderName}&fileName=index.scroll`)
	} catch (error) {
		console.error(error)
		res.status(500).send("Sorry, an error occurred while creating the site:", error)
	}
})

app.get("/ls", (req, res) => {
	const folderName = sanitizeFolderName(req.query.folderName)
	const folderPath = path.join(sitesFolder, folderName)

	if (!fs.existsSync(folderPath)) return res.status(404).send("Folder not found")

	try {
		const output = execSync("ls *.scroll", { cwd: folderPath }).toString()
		// Split the output into lines and filter out any empty lines
		const files = output.split("\n").filter(file => file.trim() !== "")
		res.setHeader("Content-Type", "text/plain")
		res.send(files.join("\n"))
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while listing the .scroll files")
	}
})

const runCommand = (req, res, command) => {
	const folderName = sanitizeFolderName(req.query.folderName)
	const folderPath = path.join(sitesFolder, folderName)

	if (!fs.existsSync(folderPath)) return res.status(404).send("Folder not found")

	try {
		const output = execSync(`scroll ${command}`, { cwd: folderPath })
		res.send(output.toString())
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while running '${command}' in '${folderName}'`)
	}
}

app.get("/build", (req, res) => runCommand(req, res, "build"))
app.get("/format", (req, res) => runCommand(req, res, "format"))
app.get("/test", (req, res) => runCommand(req, res, "test"))

app.get("/git/:repo/*", (req, res) => {
	const repo = req.params.repo
	const repoPath = path.join(sitesFolder, repo)

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
app.post("/git/:repo/*", (req, res) => {
	const repo = req.params.repo
	const repoPath = path.join(sitesFolder, repo)

	req.url = "/" + req.url.split("/").slice(3).join("/")

	const handlers = httpBackend(req.url, (err, service) => {
		if (err) return res.end(err + "\n")

		res.setHeader("content-type", service.type)

		const ps = spawn(service.cmd, service.args.concat(repoPath))
		ps.stdout.pipe(service.createStream()).pipe(ps.stdin)

		// Log successful Git pushes
		ps.on("close", code => {
			if (code === 0 && service.action === "push") {
				execSync(`scroll build`, { cwd: repoPath })
			}
		})
	})

	req.pipe(handlers).pipe(res)
})

app.get("/read", (req, res) => {
	const filePath = path.join(sitesFolder, decodeURIComponent(req.query.filePath))

	if (!filePath.endsWith(".scroll")) return res.status(400).send("Invalid file type. Only editing of .scroll files is allowed.")

	if (!fs.existsSync(filePath)) return res.status(404).send("File not found")

	try {
		const content = fs.readFileSync(filePath, "utf8")
		res.setHeader("Content-Type", "text/plain")
		res.send(content)
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while reading the file")
	}
})

const writeFile = (res, filePath, content) => {
	filePath = path.join(sitesFolder, filePath)

	if (!filePath.endsWith(".scroll")) return res.status(400).send("Invalid file type. Only editing of .scroll files is allowed.")

	const folderPath = path.dirname(filePath)
	if (!fs.existsSync(folderPath)) return res.status(400).send("Folder does not exist")

	// Extract folder name and file name for the redirect
	const folderName = path.relative(sitesFolder, folderPath)
	const fileName = path.basename(filePath)

	try {
		fs.writeFileSync(filePath, content, "utf8")

		// Run scroll build on the folder
		execSync(`scroll format; git add ${fileName}; git commit -m 'Updated ${fileName}'; scroll build`, { cwd: folderPath })

		res.redirect(`/edit.html?folderName=${folderName}&fileName=${fileName}`)
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while writing the file or rebuilding the site:\n ${error.toString().replace(/</g, "&lt;")}`)
	}
}

app.get("/write", (req, res) => writeFile(res, decodeURIComponent(req.query.filePath), decodeURIComponent(req.query.content)))
app.post("/write", (req, res) => writeFile(res, req.body.filePath, req.body.content))

// Static file serving comes AFTER our routes, so if someone creates a site with a route name, our route name wont break.
// todo: would be nicer to additionally make those folder names reserved, and provide a clientside script to people
// of what names are taken, for instant feedback.

// Middleware to serve .scroll files as plain text
// This should come BEFORE the static file serving middleware
app.use((req, res, next) => {
	if (!req.url.endsWith(".scroll")) return next()
	const filePath = path.join(sitesFolder, decodeURIComponent(req.url))
	if (fs.existsSync(filePath)) {
		res.setHeader("Content-Type", "text/plain; charset=utf-8")
		res.sendFile(filePath)
	} else next()
})

// Serve the sites directory from the root URL
app.use("/", express.static(sitesFolder))

// Serve the root directory statically
app.use(express.static(__dirname))

app.listen(port, () => console.log(`Server running at http://localhost:${port}`))
