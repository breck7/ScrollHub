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
/ls (GET)
 example: ls/folderName
 - This runs "ls *.scroll" in folderName and returns the results as plain text one filename per line


It should also serve this folder statically

*/

const express = require("express")
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const rateLimit = require("express-rate-limit")

const app = express()
const port = 80

// Serve the sites directory from the root URL
app.use("/", express.static(path.join(__dirname, "sites")))

// Serve the root directory statically
app.use(express.static(__dirname))

// Rate limiting middleware
const createLimiter = rateLimit({
	windowMs: 10 * 1000, // 10 seconds
	max: 1, // limit each IP to 1 request per windowMs
	message: "You are creating sites too fast",
	standardHeaders: true,
	legacyHeaders: false,
})

// Sanitize folder name
function sanitizeFolderName(name) {
	return name.toLowerCase().replace(/[^a-z0-9._]/g, "")
}

// Validate folder name
function isValidFolderName(name) {
	return /^[a-z][a-z0-9._]*$/.test(name) && name.length > 0
}

app.get("/createFromForm", (req, res) => {
	const { folderName } = req.query
	res.redirect(`/create/${folderName}`)
})

app.get("/create/:folderName", createLimiter, (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!isValidFolderName(folderName)) {
		return res.status(400).send("Invalid folder name")
	}

	if (fs.existsSync(folderPath)) {
		return res.status(400).send("Folder already exists")
	}

	try {
		fs.mkdirSync(folderPath, { recursive: true })
		execSync("scroll init", { cwd: folderPath })
		execSync("scroll build", { cwd: folderPath })
		res.redirect(`/edit.html?folderName=${folderName}`)
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while creating the site")
	}
})

app.get("/build/:folderName", (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) {
		return res.status(404).send("Folder not found")
	}

	try {
		const output = execSync("scroll build", { cwd: folderPath })
		res.send(output.toString())
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while building the site")
	}
})

app.get("/edit/:folderName", (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) {
		return res.status(404).send("Folder not found")
	}

	res.send(`Editing ${folderName}`)
})

app.get("/format/:folderName", (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) {
		return res.status(404).send("Folder not found")
	}

	try {
		const output = execSync("scroll format", { cwd: folderPath })
		res.send(output.toString())
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while formatting the site")
	}
})

app.get("/test/:folderName", (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) {
		return res.status(404).send("Folder not found")
	}

	try {
		const output = execSync("scroll test", { cwd: folderPath })
		res.send(output.toString())
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while testing the site")
	}
})

app.get("/ls/:folderName", (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) {
		return res.status(404).send("Folder not found")
	}

	try {
		const output = execSync("ls *.scroll", { cwd: folderPath }).toString()
		// Split the output into lines and filter out any empty lines
		const files = output.split("\n").filter((file) => file.trim() !== "")
		res.setHeader("Content-Type", "text/plain")
		res.send(files.join("\n"))
	} catch (error) {
		console.error(error)
		res.status(500).send(
			"An error occurred while listing the .scroll files",
		)
	}
})

app.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`)
})
