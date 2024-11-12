# ScrollHub: The fastest way to publish

ScrollHub is a super server for publishing websites, scientific articles, blog posts, books, and more. It provides a seamless platform for content creation and distribution.

Try it yourself at: [https://hub.scroll.pub](https://hub.scroll.pub)

## 🚀 Quick Start: Run your own ScrollHub in 60 seconds

Launch a new Ubuntu Droplet on [Digital Ocean](https://www.digitalocean.com) (or your cloud provider of choice), then SSH into your server and run this oneliner:

```bash
apt install make zip && git clone https://github.com/tj/n && cd n && make install && n latest && cd && git config --global user.name "ScrollHub" && git config --global user.email "scrollhub@scroll.pub" && git clone https://github.com/breck7/ScrollHub && cd ScrollHub && npm install . && npm install scroll-cli pm2 prettier -g && git config --global receive.denyCurrentBranch updateInstead && pm2 start server.js --node-args="--max-old-space-size=4096" --log ~/ScrollHub/pm2.log && pm2 startup && pm2 save
```

### Optional Steps:

1. Create a DNS A Record pointing from your domain or subdomain to your new server
2. Torify your site with an onion domain using [Tor Project](https://www.torproject.org/about/history/):

```bash
sudo apt update && sudo apt install -y tor && echo -e "HiddenServiceDir /var/lib/tor/hidden_service/\nHiddenServicePort 80 127.0.0.1:3000" | sudo tee -a /etc/tor/torrc && sudo systemctl restart tor && sudo cat /var/lib/tor/hidden_service/hostname
```

## 🛠️ Development Environment Setup

### Helpful Aliases

Add these to your shell configuration for a smoother workflow:

```bash
# Scroll
alias sb="scroll build"

# Npm
alias x="npm run"

# ScrollHub
alias hub="hub start"

# Git
alias gs="git status"
alias ga="git add ."
alias gc="git commit --allow-empty-message -m ''"
alias acp="git add . && git commit --allow-empty-message -m '' && git push"
```

Note: Make sure server-side `.gitignore` includes all log and frequently changed files to avoid local push conflicts.

## 🔧 Git Troubleshooting

ScrollHub uses git for versioning files. If you're developing locally and encounter merge conflicts:

1. Check the git status for a folder by visiting: `https://hub.scroll.pub/status/[folderName]`
2. It's recommended to prevent force pushes on your server with:

```bash
git config --system receive.denyNonFastForwards true
```

## 📦 Release Notes

The complete release history is available in multiple formats:

- [CSV format](releaseNotes.csv)
- [TSV format](releaseNotes.tsv)
- [JSON format](releaseNotes.json)

View the full changelog with detailed release notes at [Release Notes](https://scroll.pub/releaseNotes.html).

## 📄 Public Domain

ScrollHub is released into the public domain.
