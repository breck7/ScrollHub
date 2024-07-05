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

const app = express()
const port = 80

// Serve the sites directory from the root URL
app.use("/", express.static(path.join(__dirname, "sites")))

// Serve the root directory statically
app.use(express.static(__dirname))

// Rate limiting middleware
const createLimiter = rateLimit({
	windowMs: 5 * 1000, // 10 seconds
	max: 1, // limit each IP to 1 request per windowMs
	message: "Sorry, you exceeded 1 site every 5 seconds",
	standardHeaders: true,
	legacyHeaders: false
})

// Sanitize folder name
const sanitizeFolderName = name => name.toLowerCase().replace(/[^a-z0-9._]/g, "")

// Validate folder name
const isValidFolderName = name => /^[a-z][a-z0-9._]*$/.test(name) && name.length > 0

app.get("/createFromForm", (req, res) => res.redirect(`/create/${req.query.folderName}`))

app.get("/create/:folderName(*)", createLimiter, (req, res) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!isValidFolderName(folderName)) return res.status(400).send("Sorry, your folder name did not meet our requirements (sorry!). It should start with a letter a-z and pass a few other checks.")

	if (fs.existsSync(folderPath)) return res.status(400).send("Sorry a folder with that name already exists")

	try {
		fs.mkdirSync(folderPath, { recursive: true })
		execSync("scroll init", { cwd: folderPath })
		execSync("scroll build", { cwd: folderPath })
		res.redirect(`/edit.html?folderName=${folderName}&fileName=helloWorld.scroll`)
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while creating the site")
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
		const files = output.split("\n").filter(file => file.trim() !== "")
		res.setHeader("Content-Type", "text/plain")
		res.send(files.join("\n"))
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while listing the .scroll files")
	}
})

const runCommand = (req, res, command) => {
	const folderName = sanitizeFolderName(req.params.folderName)
	const folderPath = path.join(__dirname, "sites", folderName)

	if (!fs.existsSync(folderPath)) return res.status(404).send("Folder not found")

	try {
		const output = execSync(`scroll ${command}`, { cwd: folderPath })
		res.send(output.toString())
	} catch (error) {
		console.error(error)
		res.status(500).send(`An error occurred while running '${command}' in '${folderName}'`)
	}
}

app.get("/build/:folderName", (req, res) => runCommand(req, res, "build"))
app.get("/format/:folderName", (req, res) => runCommand(req, res, "format"))
app.get("/test/:folderName", (req, res) => runCommand(req, res, "test"))

app.get("/read/:filePath(*)", (req, res) => {
	const filePath = path.join(__dirname, "sites", decodeURIComponent(req.params.filePath))

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

app.get("/write", (req, res) => {
	const filePath = path.join(__dirname, "sites", decodeURIComponent(req.query.filePath))
	const content = decodeURIComponent(req.query.content)

	if (!filePath.endsWith(".scroll")) return res.status(400).send("Invalid file type. Only editing of .scroll files is allowed.")

	const folderPath = path.dirname(filePath)
	if (!fs.existsSync(folderPath)) return res.status(400).send("Folder does not exist")

	// Extract folder name and file name for the redirect
	const folderName = path.relative(path.join(__dirname, "sites"), folderPath)
	const fileName = path.basename(filePath)

	try {
		fs.writeFileSync(filePath, content, "utf8")

		// Run scroll build on the folder
		execSync("scroll build", { cwd: folderPath })

		res.redirect(`/edit.html?folderName=${folderName}&fileName=${fileName}`)
	} catch (error) {
		console.error(error)
		res.status(500).send("An error occurred while writing the file or rebuilding the site")
	}
})

app.listen(port, () => console.log(`Server running at http://localhost:${port}`))
