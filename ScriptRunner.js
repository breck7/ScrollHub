const { spawn } = require("child_process")
const fsp = require("fs").promises
const path = require("path")

// Map of file extensions to their interpreters
const interpreterMap = {
  php: "php",
  py: "python3",
  rb: "ruby",
  pl: "perl"
}

const TIMEOUT = 20000

class ScriptRunner {
  constructor(hub) {
    this.hub = hub
  }

  init() {
    const { hub } = this
    const { app, rootFolder, folderCache } = hub
    const scriptExtensions = Object.keys(interpreterMap).join("|")
    const scriptPattern = new RegExp(`.*\.(${scriptExtensions})$`)

    // Handle both GET and POST requests
    app.all(scriptPattern, async (req, res) => {
      const folderName = hub.getFolderName(req)

      // Check if folder exists
      if (!folderCache[folderName]) return res.status(404).send("Folder not found")

      const folderPath = path.join(rootFolder, folderName)
      const filePath = path.join(folderPath, path.basename(req.path))

      // Ensure the file path is within the folder (prevent directory traversal)
      if (!filePath.startsWith(folderPath)) return res.status(403).send("Access denied")

      const ext = path.extname(filePath).slice(1)
      const interpreter = interpreterMap[ext]

      try {
        // Check if file exists
        const fileExists = await fsp
          .access(filePath)
          .then(() => true)
          .catch(() => false)

        if (!fileExists) return res.status(404).send("Script not found")

        // Prepare environment variables with request data
        const env = {
          ...process.env,
          FOLDER_NAME: folderName,
          REQUEST_METHOD: req.method,
          REQUEST_BODY: JSON.stringify(req.body),
          QUERY_STRING: new URLSearchParams(req.query).toString(),
          CONTENT_TYPE: req.get("content-type") || "",
          CONTENT_LENGTH: req.get("content-length") || "0",
          HTTP_HOST: req.get("host") || "",
          HTTP_USER_AGENT: req.get("user-agent") || "",
          REMOTE_ADDR: req.ip || req.connection.remoteAddress,
          SCRIPT_FILENAME: filePath,
          SCRIPT_NAME: req.path,
          DOCUMENT_ROOT: folderPath,
          // Add more CGI-like environment variables
          PATH_INFO: filePath,
          SERVER_NAME: req.hostname,
          SERVER_PORT: req.protocol === "https" ? "443" : "80",
          SERVER_PROTOCOL: "HTTP/" + req.httpVersion,
          SERVER_SOFTWARE: "ScrollHub"
        }

        // Add all HTTP headers as environment variables
        Object.entries(req.headers).forEach(([key, value]) => {
          env["HTTP_" + key.toUpperCase().replace("-", "_")] = value
        })

        // Spawn the interpreter process
        const spawnedProcess = spawn(interpreter, [filePath], {
          env,
          cwd: folderPath, // Set working directory to the folder
          stdio: ["pipe", "pipe", "pipe"]
        })

        // Send POST data to script's stdin if present
        if (req.method === "POST") {
          const postData = req.body
          if (typeof postData === "string") {
            spawnedProcess.stdin.write(postData)
          } else if (Buffer.isBuffer(postData)) {
            spawnedProcess.stdin.write(postData)
          } else {
            spawnedProcess.stdin.write(JSON.stringify(postData))
          }
          spawnedProcess.stdin.end()
        }

        let output = ""
        let errorOutput = ""

        spawnedProcess.stdout.on("data", data => {
          output += data.toString()
        })

        spawnedProcess.stderr.on("data", data => {
          errorOutput += data.toString()
        })

        // Set timeout for script execution (e.g., 30 seconds)
        const timeout = setTimeout(() => {
          spawnedProcess.kill()
          res.status(504).send("Script execution timed out")
        }, TIMEOUT)

        spawnedProcess.on("close", code => {
          clearTimeout(timeout)

          if (code === 0) {
            // Parse output for headers and body
            const parts = output.split("\r\n\r\n")
            if (parts.length > 1) {
              // Script provided headers
              const headers = parts[0].split("\r\n")
              const body = parts.slice(1).join("\r\n\r\n")

              headers.forEach(header => {
                const [name, ...value] = header.split(":")
                if (name && value) {
                  res.setHeader(name.trim(), value.join(":").trim())
                }
              })
              res.send(body)
            } else {
              // No headers provided, send as plain text
              res.setHeader("Content-Type", "text/plain")
              res.send(output)
            }
          } else {
            console.error(`Script execution error in ${filePath} (${code}):`, errorOutput)
            res.status(500).send("Script execution failed")
          }
        })

        // Handle process errors
        spawnedProcess.on("error", err => {
          clearTimeout(timeout)
          console.error(`Failed to start script process in ${folderName}:`, err)
          res.status(500).send("Failed to execute script")
        })
      } catch (error) {
        console.error(`Script execution error in ${folderName}:`, error)
        res.status(500).send("Internal server error")
      }
    })
  }
}

module.exports = { ScriptRunner }
