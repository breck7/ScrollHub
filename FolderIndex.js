const path = require("path")
const { spawn } = require("child_process")
const fsp = require("fs").promises

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
}

module.exports = { FolderIndex }
