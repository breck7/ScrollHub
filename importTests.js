#! /usr/bin/env node
const { SiteImporter } = require("./SiteImporter.js")
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
https://paulgraham.com/articles.html
https://blogmaverick.com/feed/
https://vitalik.ca/feed.xml
https://worksinprogress.co/feed/
https://meyerweb.com/eric/thoughts/feed/`.split("\n")

const rootFolder = path.join(__dirname, "sites")
cases.forEach(async url => new SiteImporter().importFromUrl(url, rootFolder))
