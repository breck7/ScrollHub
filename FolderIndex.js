const path = require("path")
const { spawn } = require("child_process")
const fsp = require("fs").promises
const AnsiToHtml = require("ansi-to-html")

const getBaseUrlForFolder = (folderName, hostname, protocol, isLocalHost) => {
  // if localhost, no custom domains
  if (isLocalHost) return `/${folderName}`

  if (!folderName.includes(".")) return protocol + "//" + hostname + "/" + folderName

  // now it might be a custom domain, serve it as if it is
  // of course, sometimes it would not be
  return protocol + "//" + folderName
}

class FolderIndex {
  constructor(scrollHub) {
    this.scrollHub = scrollHub
  }

  // todo: speed this up. throttle?
  async updateFolder(folder) {
    const { scrollHub } = this
    const { rootFolder } = scrollHub
    const fullPath = path.join(rootFolder, folder)

    // Get list of files tracked by git and their sizes
    let fileCount = 0
    let fileSize = 0
    try {
      // Get list of tracked files with their sizes
      const gitLsFiles = await new Promise((resolve, reject) => {
        const gitProcess = spawn("git", ["ls-files", "-z", "--with-tree=HEAD"], { cwd: fullPath })
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

      // Split by null character and filter empty entries
      const fileList = gitLsFiles.split("\0").filter(Boolean)
      fileCount = fileList.length
      const files = {}

      // Get size of each tracked file
      await Promise.all(
        fileList.map(async file => {
          const filePath = path.join(fullPath, file)
          try {
            if (!(await scrollHub.exists(filePath))) return
            const fileStats = await fsp.stat(filePath)
            fileSize += fileStats.size
            files[file] = {
              versioned: true,
              file,
              size: fileStats.size,
              mtime: fileStats.mtime,
              ctime: fileStats.ctime
            }
          } catch (err) {
            console.error(`Error getting stats for file: ${file}`, err)
          }
        })
      )

      // Get number of git commits
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
      const commitCount = parseInt(gitCommits, 10)

      // Get last commit hash
      const lastCommitHash = await new Promise((resolve, reject) => {
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
      const lastCommitTimestamp = await new Promise((resolve, reject) => {
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

      // Get folder creation time from git
      const firstCommitTimestamp = await new Promise((resolve, reject) => {
        const gitProcess = spawn("git", ["log", "--reverse", "--format=%ct", "--max-count=1"], { cwd: fullPath })
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

      const hasSslCert = await scrollHub.doesHaveSslCert(folder)
      const folderLink = getBaseUrlForFolder(folder, scrollHub.hostname, hasSslCert ? "https:" : "http:", scrollHub.isLocalHost)

      const entry = {
        files,
        hasSslCert,
        scrollHubVersion: scrollHub.version,
        stats: {
          folder,
          folderLink,
          created: firstCommitTimestamp,
          revised: lastCommitTimestamp,
          files: fileCount,
          mb: Math.ceil(fileSize / (1024 * 1024)),
          revisions: commitCount,
          hash: lastCommitHash.substr(0, 10)
        },
        zip: undefined
      }
      scrollHub.folderCache[folder] = entry
      await fsp.writeFile(scrollHub.getStatsPath(folder), JSON.stringify(entry, null, 2), "utf8")
    } catch (err) {
      console.error(`Error getting git information for folder: ${folder}`, err)
      return null
    }
  }

  async getCommits(folderName, count) {
    const { scrollHub } = this
    const { rootFolder } = scrollHub
    const folderPath = path.join(rootFolder, folderName)

    try {
      // Check if there are any commits
      const commitCountData = await new Promise((resolve, reject) => {
        const gitRevListProcess = spawn("git", ["rev-list", "--count", "HEAD"], { cwd: folderPath })
        let data = ""

        gitRevListProcess.stdout.on("data", chunk => {
          data += chunk.toString()
        })

        gitRevListProcess.on("close", code => {
          if (code === 0) {
            resolve(data.trim())
          } else {
            reject(new Error("Failed to get commit count"))
          }
        })
      })

      const numCommits = parseInt(commitCountData, 10)
      if (numCommits === 0) {
        return []
      }

      // Get detailed commit information with a specific format
      const logOutput = await new Promise((resolve, reject) => {
        const gitLogProcess = spawn("git", ["log", `-${count}`, "--color=always", "--date=iso", "--format=commit %H%nAuthor: %an <%ae>%nDate: %ad%nSubject: %s%n%n%b%n", "-p"], { cwd: folderPath })

        let output = ""
        gitLogProcess.stdout.on("data", data => {
          output += data.toString()
        })

        gitLogProcess.on("close", code => {
          if (code === 0) {
            resolve(output)
          } else {
            reject(new Error("Failed to get commit information"))
          }
        })
      })

      // Parse the git log output into structured data
      const commits = []
      const commitChunks = logOutput.split(/(?=commit [0-9a-f]{40}\n)/)

      for (const chunk of commitChunks) {
        if (!chunk.trim()) continue

        const commitMatch = chunk.match(/commit (\w+)\n/)
        const authorMatch = chunk.match(/Author: ([^<]+)<([^>]+)>/)
        const dateMatch = chunk.match(/Date:\s+(.+)\n/)
        const messageMatch = chunk.match(/\n\n\s+(.+?)\n/)
        const diffContent = chunk.split(/\n\n/)[2] || ""

        if (commitMatch && authorMatch && dateMatch) {
          commits.push({
            id: commitMatch[1],
            name: authorMatch[1].trim(),
            email: authorMatch[2].trim(),
            time: new Date(dateMatch[1]),
            message: messageMatch ? messageMatch[1].trim() : "",
            diff: diffContent,
            rawOutput: chunk // Keep raw output for HTML generation
          })
        }
      }

      return commits
    } catch (error) {
      console.error(`Error in getCommits: ${error.message}`)
      throw error
    }
  }

  async sendCommits(folderName, count, res) {
    try {
      const commits = await this.getCommits(folderName, count)

      if (commits.length === 0) {
        res.status(200).send(`No commits available for ${folderName}.`)
        return
      }

      const convert = new AnsiToHtml({ escapeXML: true })

      // Send HTML header
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Last ${count} Commits for ${folderName}</title>
  <style>
    body { font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 5px; }
    h2 { color: #333; }
    .aCommit {background-color: rgba(238, 238, 238, 0.8); padding: 8px; border-radius: 3px; margin-bottom: 10px;}
    .commit { border-bottom: 1px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
    .commit-message { font-weight: bold; color: #005cc5; }
    input[type="submit"] { font-size: 0.8em; padding: 2px 5px; margin-left: 10px; }
  </style>
</head>
<body>
`)

      // Process each commit
      for (const commit of commits) {
        let output = commit.rawOutput
        // Convert ANSI color codes to HTML
        output = convert.toHtml(output)
        // Add restore version button
        output = output.replace(/(commit\s)([0-9a-f]{40})/, (match, prefix, hash) => {
          return `<div class="aCommit">
${prefix}${hash}
<form method="POST" action="/revert.htm/${folderName}" style="display:inline;">
  <input type="hidden" name="hash" value="${hash}">
  <input type="submit" value="Restore this version" onclick="return confirm('Restore this version?');">
</form>`
        })
        res.write(output + "</div>\n")
      }

      res.end("</body></html>")
    } catch (error) {
      console.error(`Error in sendCommits: ${error.message}`)
      res.status(500).send("An error occurred while fetching the git log")
    }
  }
}

module.exports = { FolderIndex }
