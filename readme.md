# ScrollHub

ScrollHub is a super server for publishing websites, scientific articles, blog posts, books, and more. It provides a fast, efficient way to manage and serve content with built-in version control and real-time editing capabilities.

[![Version](https://img.shields.io/badge/version-0.60.0-blue.svg)](https://hub.scroll.surf)

## Features

- 🚀 **Instant Publishing**: The fastest way to publish online
- 📝 **Universal Content Support**: Publish websites, scientific articles, blog posts, books, and more
- 🔄 **Built-in Version Control**: Integrated Git support for versioning and collaboration
- 🎨 **Live Preview**: Real-time editing with instant preview
- 🛠️ **Multiple File Format Support**: Write in Scroll and Parsers, plus HTML, CSS, JavaScript, and more
- 📊 **Traffic Analytics**: Built-in live traffic monitoring and visualization
- 🌐 **Custom Domain Support**: Serve content on your own domain

## Quick Start

Get your own ScrollHub server up and running in 60 seconds:

```bash
apt install -y make zip && git clone https://github.com/tj/n && cd n && make install && n latest && cd && git config --global user.name "ScrollHub" && git config --global user.email "scrollhub@scroll.surf" && git clone https://github.com/breck7/ScrollHub && cd ScrollHub && npm install . && npm install scroll-cli pm2 prettier -g && npm install -g . && git config --global receive.denyCurrentBranch updateInstead && cd && pm2 start ~/ScrollHub/server.js --node-args="--max-old-space-size=4096" --log ~/ScrollHub/pm2.log && pm2 startup && pm2 save
```

Optional: Create a DNS A Record pointing from your domain or subdomain to your new server.

## Development Environment

```bash
git clone https://github.com/breck7/ScrollHub && cd ScrollHub && npm install . && sudo npm install -g .
```

## Features in Detail

### Content Management

- Create and edit content with a powerful built-in editor
- Real-time preview of changes
- Support for multiple file formats
- Automatic formatting for supported file types

### Version Control

- Built-in Git integration
- View file revision history
- Compare changes between versions
- Revert to previous versions

### File Operations

- Upload files via drag-and-drop
- Rename files and folders
- Create new files from templates
- Duplicate existing content
- Delete files and folders with confirmation

### Monitoring

- Real-time traffic monitoring
- Request logging
- Traffic visualization
- Download traffic data in multiple formats

## API Routes

ScrollHub provides several API endpoints for managing content:

- `/readFile.htm` - Read file content
- `/writeFile.htm` - Write file content
- `/uploadFile.htm` - Upload files
- `/build.htm` - Build folder content
- `/format/:folderName` - Format files
- `/status/:folderName` - Get Git status
- And many more...

## Technical Details

- Built with Node.js and Express
- Uses CodeMirror for the editor
- Integrates with Git for version control
- Supports multiple parsers and file formats
- Real-time server-sent events for updates
- PM2 process management

## Latest Updates

🎉 Version 0.60.0 (12/20/2024)

- Run unlimited ScrollHub processes on one machine
- Each process independently serves its own root folder
- Custom port support

See [Release Notes](https://hub.scroll.surf/releaseNotes.html) for full changelog.

## Public Domain

ScrollHub is public domain.

## Try It Online

Visit [https://hub.scroll.surf](https://hub.scroll.surf) to try ScrollHub without installation.

---

For more information, visit the [ScrollHub Documentation](https://hub.scroll.surf).
