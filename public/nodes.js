class Node {
  constructor(folderData, x, y) {
    this.x = x
    this.y = y
    this.vx = ((Math.random() > 0.5 ? 1 : -1) * Math.log10(folderData.revisions)) / 10
    this.vy = ((Math.random() > 0.5 ? 1 : -1) * Math.log10(folderData.revisions)) / 10
    //this.radius = Math.min(folderData.revisions, 1)
    this.radius = Math.max(Math.log2(folderData.revisions), 3)
    this.folder = folderData.folder
    this.folderLink = folderData.folderLink
    this.created = new Date(folderData.created)
    this.isHovered = false
  }
  update(width, height) {
    this.x += this.vx
    this.y += this.vy
    if (this.x < this.radius || this.x > width - this.radius) this.vx *= -1
    if (this.y < this.radius || this.y > height - this.radius) this.vy *= -1
  }
  isPointInside(x, y) {
    const dx = this.x - x
    const dy = this.y - y
    return Math.sqrt(dx * dx + dy * dy) < this.radius + 10
  }
}
class NodesAnimation {
  constructor() {
    this.canvas = document.getElementById("nodesCanvas")
    this.ctx = this.canvas.getContext("2d")
    this.nodes = []
    this.mouse = { x: 0, y: 0 }
    this.hoveredNode = null
    this.connectionDistance = 150
    this.init()
  }
  async init() {
    this.resize()
    await this.loadFolders()
    this.bindEvents()
    this.animate()
  }
  async loadFolders() {
    /* Example entry of folders.json:
  [{
    "folder": "22",
    "folderLink": "https://hub.scroll.pub/22",
    "created": "2024-12-20T16:01:16.000Z",
    "revised": "2024-12-20T16:01:16.000Z",
    "files": 1,
    "mb": 1,
    "revisions": 2,
    "hash": "e70c801c22"
  },] */
    try {
      const response = await fetch("folders.json")
      const folders = await response.json()
      // Sort folders by revised date, newest first
      const sortedFolders = folders.sort((a, b) => new Date(b.revised) - new Date(a.revised))
      // Take only the first 100 folders
      const limitedFolders = sortedFolders.slice(0, 100)
      this.createNodes(limitedFolders)
    } catch (error) {
      console.error("Error loading folders:", error)
    }
  }
  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = this.width * window.devicePixelRatio
    this.canvas.height = this.height * window.devicePixelRatio
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  }
  createNodes(folders) {
    folders.forEach(folder => {
      this.nodes.push(new Node(folder, Math.random() * this.width, Math.random() * this.height))
    })
  }
  bindEvents() {
    window.addEventListener("resize", () => this.resize())
    document.body.addEventListener("mousemove", e => {
      const rect = this.canvas.getBoundingClientRect()
      this.mouse.x = e.clientX - rect.left
      this.mouse.y = e.clientY - rect.top
      this.hoveredNode = this.nodes.find(node => node.isPointInside(this.mouse.x, this.mouse.y))
      this.canvas.style.cursor = this.hoveredNode ? "pointer" : "default"
      this.canvas.style.zIndex = this.hoveredNode ? 2 : -1
    })
    this.canvas.addEventListener("click", () => {
      if (this.hoveredNode) {
        window.open(this.hoveredNode.folderLink, "_blank")
      }
    })
  }
  drawConnections() {
    this.ctx.beginPath()
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)"
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].x - this.nodes[j].x
        const dy = this.nodes[i].y - this.nodes[j].y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < this.connectionDistance) {
          const opacity = 1 - distance / this.connectionDistance
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.15})`
          this.ctx.beginPath()
          this.ctx.moveTo(this.nodes[i].x, this.nodes[i].y)
          this.ctx.lineTo(this.nodes[j].x, this.nodes[j].y)
          this.ctx.stroke()
        }
      }
    }
  }
  drawNode(node) {
    this.ctx.beginPath()
    this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
    if (node === this.hoveredNode) {
      this.ctx.shadowColor = "rgba(255, 255, 255, 0.8)"
      this.ctx.shadowBlur = 15
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
      this.ctx.font = "14px Arial"
      this.ctx.fillStyle = "white"
      this.ctx.textAlign = "center"
      this.ctx.fillText(node.folder, node.x, node.y - node.radius - 10)
    } else {
      this.ctx.shadowBlur = 0
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
    }
    this.ctx.fill()
    this.ctx.shadowBlur = 0
  }
  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height)
    this.nodes.forEach(node => {
      if (this.hoveredNode !== node) node.update(this.width, this.height)
      this.drawNode(node)
    })
    // this.drawConnections()
    requestAnimationFrame(() => this.animate())
  }
}
document.addEventListener("DOMContentLoaded", () => {
  new NodesAnimation()
})
