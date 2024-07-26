// To use:
// npm install rss-parser got cheerio
const Parser = require("rss-parser")
const { Disk } = require("scrollsdk/products/Disk.node.js")
const { Utils } = require("scrollsdk/products/Utils.js")
const path = require("path")
const fs = require("fs")
const ky = require("./ky.js")
const cheerio = require("cheerio")
const { execSync } = require("child_process")

const removeReturnCharsAndRightShift = (str, numSpaces) => str.replace(/\r/g, "").replace(/\n/g, "\n" + " ".repeat(numSpaces))

const SCROLL_FILE_EXTENSION = ".scroll"

class RssImporter {
	constructor(path) {
		this.path = path
	}
	path = ""

	savePost(item, content, destinationFolder) {
		const { title, pubDate, isoDate } = item
		const date = pubDate || isoDate ? `date ${pubDate || isoDate}` : ""
		const scrollFile = `title ${title}
${date}
tags All

${removeReturnCharsAndRightShift(content, 1)}
`
		Disk.write(path.join(destinationFolder, Utils.stringToPermalink(title) + SCROLL_FILE_EXTENSION), scrollFile)

		// Build incrementally
		execSync("scroll build", { cwd: destinationFolder })
	}

	async downloadFilesTo(destinationFolder) {
		const parser = new Parser()
		console.log(`⏳ downloading '${this.path}'`)
		const feed = await parser.parseURL(this.path)

		await Promise.all(
			feed.items.map(async item => {
				if (item.content) return this.savePost(item, item.content, destinationFolder)

				try {
					console.log(`⏳ downloading '${item.link}'`)
					const response = await ky.get(item.link)
					const html = response.body
					const dom = cheerio.load(html)
					this.savePost(item, dom.text(), destinationFolder)
				} catch (err) {
					console.error(err)
					console.log(`❌ downloading '${item.link}'`)
				}
			})
		)
	}
}

class SiteImporter {
	// rss, twitter, hn, reddit, pinterest, instagram, tiktok, youtube?
	async importSite(importFrom, destination) {
		// A loose check for now to catch things like "format=rss"
		if (importFrom.includes("rss") || importFrom.includes("feed")) {
			const importer = new RssImporter(importFrom)
			return await importer.downloadFilesTo(destination)
		}

		return `❌ Scroll wasn't sure how to import '${importFrom}'.\n💡 You can open an issue here: https://github.com/breck7/scroll/issues`
	}

	async importFromUrl(url, rootFolder) {
		const { hostname } = new URL(url)
		const folder = path.join(rootFolder, hostname)
		try {
			if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
			execSync("scroll init; git init; git add *.scroll; git commit -m 'Initial commit'; scroll build", { cwd: folder })
			await this.importSite(url, folder)
			execSync("scroll build", { cwd: folder })
		} catch (err) {
			console.error(err)
		}
	}
}

module.exports = { SiteImporter }
