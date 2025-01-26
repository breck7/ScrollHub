const path = require("path")
const { spawn } = require("child_process")
const fsp = require("fs").promises

const cssStyles = `:root {
  --color-bg: #ffffff;
  --color-text: #24292f;
  --color-border: #d0d7de;
  --color-addition-bg: #e6ffec;
  --color-deletion-bg: #ffebe9;
  --color-info-bg: #f6f8fa;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0d1117;
    --color-text: #c9d1d9;
    --color-border: #30363d;
    --color-addition-bg: #0f2f1a;
    --color-deletion-bg: #2d1214;
    --color-info-bg: #161b22;
  }
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color: var(--color-text);
  background: var(--color-bg);
  margin: 0;
  padding: 20px;
}

.container {
  max-width: 900px;
  margin: 0 auto;
}

.header {
  margin-bottom: 30px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}

.header h1 {
  font-size: 24px;
  margin: 0;
}

.header h1 a{
  color: var(--color-text);
  text-decoration-color: transparent;
}

.header h1 a:hover{
  color: var(--color-text);
  text-decoration-color: var(--color-text);
}

.commit {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 24px;
  overflow: hidden;
}

.commit-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
}

.commit-author {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.author-name {
  font-weight: 600;
}

.commit-time {
  color: #57606a;
  font-size: 12px;
}

.restore-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.restore-button:hover {
  background: var(--color-info-bg);
}

.commit-message {
  padding: 16px;
  font-size: 14px;
  border-bottom: 1px solid var(--color-border);
}

.commit-details {
  padding: 16px;
}

.file-change {
  margin-bottom: 24px;
}

.file-change:last-child {
  margin-bottom: 0;
}

.filename {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  margin-bottom: 8px;
}

.changes {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.line {
  padding: 4px 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.addition {
  background: var(--color-addition-bg);
}

.deletion {
  background: var(--color-deletion-bg);
}

.change-info {
  padding: 4px 8px;
  background: var(--color-info-bg);
  color: #57606a;
  font-size: 12px;
  border-bottom: 1px solid var(--color-border);
}

@media (max-width: 600px) {
  .commit-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .restore-button {
    width: 100%;
    justify-content: center;
  }
}`

class FolderIndex {
  constructor(scrollHub) {
    this.scrollHub = scrollHub
  }

  // todo: speed this up. throttle?
  async updateFolder(folder) {
    const { scrollHub } = this
    const { rootFolder } = scrollHub
    const fullPath = path.join(rootFolder, folder)
    const currentEntry = scrollHub.folderCache[folder]

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
      const folderLink = scrollHub.getBaseUrlForFolder(folder, scrollHub.hostname, hasSslCert ? "https:" : "http:", scrollHub.isLocalHost)

      // Check DNS if folder is a domain
      let ips = []
      if (folder.includes(".")) {
        // If we've already fetched IPs for this domain, dont fetch again.
        // For now, to clear cache, simply delete the .stats.json file in the folder.
        if (currentEntry?.ips?.length) ips = currentEntry.ips
        else ips = await this.scrollHub.fetchIpsForDomainFromDns(folder)
      }

      const entry = {
        files,
        hasSslCert,
        ips,
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

      // Get detailed commit information with a custom format that's easier to parse
      const logOutput = await new Promise((resolve, reject) => {
        const gitLogProcess = spawn("git", ["log", `-${count}`, "--color=always", "--date=iso", "--format=COMMIT_START%n%H%n%an%n%ae%n%ad%n%B%nCOMMIT_DIFF_START%n", "-p"], { cwd: folderPath })

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
      const commitChunks = logOutput.split("COMMIT_START\n").filter(Boolean)

      for (const chunk of commitChunks) {
        const [commitInfo, ...diffParts] = chunk.split("COMMIT_DIFF_START\n")
        const [hash, name, email, date, ...messageLines] = commitInfo.split("\n")

        // Remove any trailing empty lines from the message
        while (messageLines.length > 0 && messageLines[messageLines.length - 1].trim() === "") {
          messageLines.pop()
        }

        // Join the message lines back together to preserve formatting
        const message = messageLines.join("\n").trim()
        const diff = diffParts.join("COMMIT_DIFF_START\n") // Restore any split diff parts

        commits.push({
          id: hash,
          name: name.trim(),
          email: email.trim(),
          time: new Date(date),
          message,
          diff
        })
      }

      return commits
    } catch (error) {
      console.error(`Error in getCommits: ${error.message}`)
      throw error
    }
  }

  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const years = Math.floor(months / 12)

    if (years > 0) return `${years} ${years === 1 ? "year" : "years"} ago`
    if (months > 0) return `${months} ${months === 1 ? "month" : "months"} ago`
    if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ago`
    if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
    if (minutes > 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`
  }

  stripAnsi(text) {
    // Remove ANSI escape codes
    return text
      .replace(/\u001b\[\d+m/g, "")
      .replace(/\u001b\[m/g, "")
      .replace(/\[\d+m/g, "")
      .replace(/\[m/g, "")
  }

  parseDiff(diffText) {
    const files = []
    let currentFile = null

    // Clean the diff text of ANSI codes first
    const cleanDiff = this.stripAnsi(diffText)
    const lines = cleanDiff.split("\n")

    for (const line of lines) {
      const cleanLine = line.trim()
      if (!cleanLine) continue

      if (cleanLine.startsWith("diff --git")) {
        if (currentFile) files.push(currentFile)
        const fileMatch = cleanLine.match(/b\/(.*?)(\s+|$)/)
        const filename = fileMatch ? fileMatch[1] : "unknown file"
        currentFile = { filename, changes: [] }
      } else if (cleanLine.startsWith("+++") || cleanLine.startsWith("---") || cleanLine.startsWith("index")) {
        continue // Skip these technical git lines
      } else if (cleanLine.startsWith("+") && !cleanLine.startsWith("+++")) {
        currentFile?.changes.push({ type: "addition", content: cleanLine.substring(1) })
      } else if (cleanLine.startsWith("-") && !cleanLine.startsWith("---")) {
        currentFile?.changes.push({ type: "deletion", content: cleanLine.substring(1) })
      } else if (cleanLine.startsWith("@@")) {
        const match = cleanLine.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)/)
        if (match) {
          const contextInfo = match[3].trim()
          currentFile?.changes.push({
            type: "info",
            content: contextInfo ? `Changed around line ${match[2]}: ${contextInfo}` : `Changed around line ${match[2]}`
          })
        }
      }
    }
    if (currentFile) files.push(currentFile)
    return files
  }

  commitToHtml(commit, folderName) {
    const timeAgo = this.formatTimeAgo(commit.time)
    const files = this.parseDiff(commit.diff)

    let html = `
      <div class="commit">
        <div class="commit-header">
          <div class="commit-author">
            <img src="https://www.gravatar.com/avatar/${commit.email
              .trim()
              .toLowerCase()
              .split("")
              .reduce((hash, char) => {
                const chr = char.charCodeAt(0)
                return ((hash << 5) - hash + chr) >>> 0
              }, 0)}?s=40&d=identicon" alt="${commit.name}" class="avatar">
            <div class="author-info">
              <div class="author-name">${commit.name}</div>
              <div class="commit-time">${timeAgo}</div>
            </div>
          </div>
          <div class="commit-actions">
            <form method="POST" action="/revert.htm/${folderName}">
              <input type="hidden" name="hash" value="${commit.id}">
              <button type="submit" class="restore-button" onclick="return confirm('Are you sure you want to restore this version? This will undo all changes made after this point.')">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3L4 7L8 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M4 7H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Restore this version
              </button>
            </form>
          </div>
        </div>
        
        <div class="commit-message">${commit.message}</div>
        
        <div class="commit-details">
    `

    for (const file of files) {
      html += `
        <div class="file-change">
          <div class="filename">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 14V2C3 1.44772 3.44772 1 4 1H9.17157C9.43679 1 9.69114 1.10536 9.87868 1.29289L12.7071 4.12132C12.8946 4.30886 13 4.56321 13 4.82843V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14Z" stroke="currentColor"/>
            </svg>
            ${file.filename}
          </div>
          <div class="changes">
      `

      for (const change of file.changes) {
        if (change.type === "info") {
          html += `<div class="change-info">${change.content}</div>`
        } else if (change.type === "addition") {
          html += `<div class="line addition">+ ${change.content}</div>`
        } else if (change.type === "deletion") {
          html += `<div class="line deletion">- ${change.content}</div>`
        }
      }

      html += `
          </div>
        </div>
      `
    }

    html += `
        </div>
      </div>
    `

    return html
  }

  // Add this method to the FolderIndex class
  async getFileHistory(folderName, filePath, count) {
    const { scrollHub } = this
    const { rootFolder } = scrollHub
    const fullFolderPath = path.join(rootFolder, folderName)

    try {
      // Get detailed commit information for the specific file
      const logOutput = await new Promise((resolve, reject) => {
        const gitLogProcess = spawn("git", ["log", `-${count}`, "--color=always", "--date=iso", "--format=COMMIT_START%n%H%n%an%n%ae%n%ad%n%B%nCOMMIT_DIFF_START%n", "-p", "--", filePath], { cwd: fullFolderPath })

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

      // Parse the git log output using existing parsing logic
      const commits = []
      const commitChunks = logOutput.split("COMMIT_START\n").filter(Boolean)

      for (const chunk of commitChunks) {
        const [commitInfo, ...diffParts] = chunk.split("COMMIT_DIFF_START\n")
        const [hash, name, email, date, ...messageLines] = commitInfo.split("\n")

        while (messageLines.length > 0 && messageLines[messageLines.length - 1].trim() === "") {
          messageLines.pop()
        }

        const message = messageLines.join("\n").trim()
        const diff = diffParts.join("COMMIT_DIFF_START\n")

        commits.push({
          id: hash,
          name: name.trim(),
          email: email.trim(),
          time: new Date(date),
          message,
          diff
        })
      }

      return commits
    } catch (error) {
      console.error(`Error in getFileHistory: ${error.message}`)
      throw error
    }
  }

  // Add this method to the FolderIndex class
  async sendFileHistory(folderName, filePath, count, res) {
    try {
      const commits = await this.getFileHistory(folderName, filePath, count)

      if (commits.length === 0) {
        res.status(200).send(`No changes have been made to ${filePath} yet.`)
        return
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>History of ${filePath}</title>
  <style>
    ${cssStyles}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><a href="fileHistory.htm?folderName=${folderName}&filePath=${filePath}&count=100">History of ${filePath}</a></h1>
    </div>
`)

      for (const commit of commits) {
        res.write(this.commitToHtml(commit, folderName))
      }

      res.end(`
  </div>
</body>
</html>`)
    } catch (error) {
      console.error(`Error in sendFileHistory: ${error.message}`)
      res.status(500).send("Sorry, we couldn't load the file history right now. Please try again.")
    }
  }

  async sendCommits(folderName, count, res) {
    try {
      const commits = await this.getCommits(folderName, count)

      if (commits.length === 0) {
        res.status(200).send(`No changes have been made to ${folderName} yet.`)
        return
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Changes to ${folderName}</title>
  <style>
    ${cssStyles}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><a href="commits.htm?folderName=${folderName}&count=100">Changes to ${folderName}</a></h1>
    </div>
`)

      for (const commit of commits) {
        res.write(this.commitToHtml(commit, folderName))
      }

      res.end(`
  </div>
</body>
</html>`)
    } catch (error) {
      console.error(`Error in sendCommits: ${error.message}`)
      res.status(500).send("Sorry, we couldn't load the change history right now. Please try again.")
    }
  }
}
module.exports = { FolderIndex }
