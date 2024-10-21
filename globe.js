class Globe {
  constructor() {
    this.renderer = null
    this.scene = null
    this.camera = null
    this.earth = null
    this.spikes = []
    this.animationId = null // To store the current animation frame ID
  }

  createGlobe() {
    // Ensure any previous globe and animation is removed
    this.removeGlobe()

    // Initialize scene, camera, renderer, etc.
    this.scene = new THREE.Scene()
    const height = window.innerHeight - 100
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / height, 0.1, 1000)
    this.camera.position.z = 1
    this.renderer = new THREE.WebGLRenderer()
    this.renderer.setSize(window.innerWidth, height)
    document.body.prepend(this.renderer.domElement)

    // Create Earth
    const geometry = new THREE.SphereGeometry(0.5, 32, 32)
    const texture = new THREE.TextureLoader().load("earth_atmos_2048.jpg")
    const material = new THREE.MeshBasicMaterial({ map: texture })
    this.earth = new THREE.Mesh(geometry, material)
    this.scene.add(this.earth)

    // Start the animation loop
    this.animate()

    return this
  }

  removeGlobe() {
    // Cancel the previous animation frame to stop multiple animations
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }

    // Dispose of the renderer, scene, and event listeners
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
    if (this.scene) {
      while (this.scene.children.length > 0) {
        const object = this.scene.children[0]
        if (object.geometry) object.geometry.dispose()
        if (object.material) object.material.dispose()
        this.scene.remove(object)
      }
    }
    this.spikes = []
    this.renderer = null
    this.scene = null
    this.earth = null
  }

  listenToResize() {
    window.addEventListener("resize", () => {
      this.createGlobe() // Recreate the globe on resize
    })
    return this
  }

  listenForClicks() {
    document.body.addEventListener("dblclick", () => {
      if (!document.fullscreenElement) {
        document.body.requestFullscreen().catch(err => {
          console.log(`Error trying to go fullscreen: ${err.message} (${err.name})`)
        })
      } else {
        document.exitFullscreen()
      }
    })

    // Pause/Resume on single-click
    document.body.addEventListener("click", () => (this.shouldRotate = !this.shouldRotate))
    return this
  }

  shouldRotate = true

  animate() {
    if (!this.earth) return

    const { earth, spikes, renderer, scene, camera } = this

    // Store the animation frame ID so we can cancel it if needed
    this.animationId = requestAnimationFrame(this.animate.bind(this))

    // Rotate Earth
    if (this.shouldRotate) earth.rotation.y += 0.001

    // Update spikes
    spikes.forEach((spike, index) => {
      spike.scale.y *= 0.95
      if (spike.scale.y < 0.01) {
        earth.remove(spike)
        spikes.splice(index, 1)
      }
    })

    // Render the scene
    renderer.render(scene, camera)
  }

  latLongToVector3(lat, lon) {
    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lon + 180) * (Math.PI / 180)
    const x = -0.5 * Math.sin(phi) * Math.cos(theta)
    const y = 0.5 * Math.cos(phi)
    const z = 0.5 * Math.sin(phi) * Math.sin(theta)
    return new THREE.Vector3(x, y, z)
  }

  visualizeHit(request) {
    const { lat, long, type } = request
    const position = this.latLongToVector3(lat, long)

    const spikeGeometry = new THREE.ConeGeometry(0.005, 0.3, 8)
    spikeGeometry.translate(0, 0.05, 0)
    spikeGeometry.rotateX(Math.PI / 2)

    const color = type === "read" ? 0xffffff : 0x00ff00
    const spikeMaterial = new THREE.MeshBasicMaterial({ color })

    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial)
    spike.position.set(position.x, position.y, position.z)
    spike.lookAt(new THREE.Vector3(0, 0, 0))

    this.earth.add(spike) // Add spike to earth instead of scene
    this.spikes.push(spike)
  }

  bindToSSE() {
    const logContainer = document.getElementById("log-container")
    const eventSource = new EventSource("/requests.htm")
    eventSource.onmessage = event => {
      const data = JSON.parse(event.data)
      const logEntry = document.createElement("div")
      logEntry.textContent = data.log
      logContainer.appendChild(logEntry)
      logContainer.scrollTop = logContainer.scrollHeight

      const parts = data.log.split(" ")
      const long = parseFloat(parts.pop())
      const lat = parseFloat(parts.pop())
      const type = parts.shift()
      const page = parts.shift()

      const request = {
        lat,
        long,
        type,
        page
      }
      this.visualizeHit(request)
    }

    eventSource.onerror = error => {
      console.error("EventSource failed:", error)
      eventSource.close()
    }

    eventSource.onopen = event => {
      console.log("SSE connection opened")
    }

    return this
  }
}

window.globe = new Globe().createGlobe().bindToSSE().listenToResize().listenForClicks()
