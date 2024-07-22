#! /usr/bin/env node
const { ScrollCli } = require("scroll-cli")
const { SiteImporter } = require("./SiteImporter.js")
const fs = require("fs")
const path = require("path")

const cases = `https://juliagalef.com/feed/
http://www.aaronsw.com/2002/feeds/pgessays.rss
https://fs.blog/feed/
https://sive.rs/podcast.rss
https://lrb.co.uk/feeds/rss
https://believermag.com/feed/
https://waitbutwhy.com/feed
https://xkcd.com/rss.xml
https://torrentfreak.com/feed/
https://blogmaverick.com/feed/
https://vitalik.ca/feed.xml
https://worksinprogress.co/feed/
https://meyerweb.com/eric/thoughts/feed/`.split("\n")

const rootFolder = path.join(__dirname, "sites")

try {
	fs.mkdirSync(rootFolder)
} catch (err) {
	console.error(err)
}
cases.forEach(async url => {
	const { hostname } = new URL(url)
	const folder = path.join(rootFolder, hostname)
	try {
		if (!fs.existsSync(folder)) fs.mkdirSync(folder)
		await new SiteImporter().importSite(url, folder)
		new ScrollCli().buildCommand(folder)
	} catch (err) {
		console.error(err)
	}
})