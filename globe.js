class Globe {
  constructor() {
    this.renderer = null
    this.scene = null
    this.camera = null
    this.earth = null
    this.spikes = []
    this.animationId = null
    this.stars = null

    // Mouse control properties
    this.isDragging = false
    this.previousMousePosition = {
      x: 0,
      y: 0
    }
    this.rotation = {
      x: 0,
      y: 0
    }

    // Zoom properties
    this.minZoom = 0.8
    this.maxZoom = 3
    this.currentZoom = 1
    this.zoomSpeed = 0.01
  }

  createStarField() {
    const starsGeometry = new THREE.BufferGeometry()
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.02,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    })

    const starsVertices = []
    const radius = 10 // Radius of our star sphere
    const starsCount = 2000 // Number of stars

    for (let i = 0; i < starsCount; i++) {
      // Create random spherical coordinates
      const theta = 2 * Math.PI * Math.random()
      const phi = Math.acos(2 * Math.random() - 1)
      const x = radius * Math.sin(phi) * Math.cos(theta)
      const y = radius * Math.sin(phi) * Math.sin(theta)
      const z = radius * Math.cos(phi)

      starsVertices.push(x, y, z)
    }

    starsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starsVertices, 3))

    this.stars = new THREE.Points(starsGeometry, starsMaterial)
    this.scene.add(this.stars)
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

    // Create starry background
    this.createStarField()

    // Create Earth
    const geometry = new THREE.SphereGeometry(0.5, 32, 32)
    const texture = new THREE.TextureLoader().load("earth_atmos_2048.jpg")
    const material = new THREE.MeshBasicMaterial({ map: texture })
    this.earth = new THREE.Mesh(geometry, material)
    this.scene.add(this.earth)

    // Add mouse and zoom controls
    this.setupMouseControls()
    this.setupZoomControls()

    // Start the animation loop
    this.animate()

    return this
  }

  setupZoomControls() {
    const canvas = this.renderer.domElement

    // Mouse wheel zoom
    canvas.addEventListener("wheel", e => {
      e.preventDefault()

      // Determine zoom direction
      const zoomDelta = e.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed

      // Update zoom level
      this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom + zoomDelta))

      // Update camera position
      this.camera.position.z = 1 / this.currentZoom
    })

    // Touch pinch zoom
    let touchDistance = 0

    canvas.addEventListener("touchstart", e => {
      if (e.touches.length === 2) {
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        touchDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      }
    })

    canvas.addEventListener("touchmove", e => {
      if (e.touches.length === 2) {
        e.preventDefault()

        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        const newDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)

        const delta = newDistance - touchDistance
        const zoomDelta = delta * 0.01 * this.zoomSpeed

        this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom + zoomDelta))

        this.camera.position.z = 1 / this.currentZoom
        touchDistance = newDistance
      }
    })
  }

  setupMouseControls() {
    const canvas = this.renderer.domElement

    canvas.addEventListener("mousedown", e => {
      this.isDragging = true
      this.previousMousePosition = {
        x: e.clientX,
        y: e.clientY
      }
    })

    canvas.addEventListener("mousemove", e => {
      if (!this.isDragging) return

      const deltaMove = {
        x: e.clientX - this.previousMousePosition.x,
        y: e.clientY - this.previousMousePosition.y
      }

      // Adjust rotation speed based on movement and zoom level
      const rotationSpeed = 0.005 * this.currentZoom

      // Update rotation based on mouse movement
      this.rotation.x += deltaMove.y * rotationSpeed
      this.rotation.y += deltaMove.x * rotationSpeed

      // Limit vertical rotation to prevent flipping
      this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x))

      // Apply rotation to earth
      this.earth.rotation.x = this.rotation.x
      this.earth.rotation.y = this.rotation.y

      this.previousMousePosition = {
        x: e.clientX,
        y: e.clientY
      }
    })

    window.addEventListener("mouseup", () => {
      this.isDragging = false
    })

    // Prevent text selection while dragging
    canvas.addEventListener("selectstart", e => {
      e.preventDefault()
    })
  }

  removeGlobe() {
    // Cancel the previous animation frame to stop multiple animations
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }

    // Remove event listeners if they exist
    if (this.renderer) {
      const canvas = this.renderer.domElement
      canvas.removeEventListener("mousedown", this.onMouseDown)
      canvas.removeEventListener("mousemove", this.onMouseMove)
      canvas.removeEventListener("wheel", this.onWheel)
      canvas.removeEventListener("touchstart", this.onTouchStart)
      canvas.removeEventListener("touchmove", this.onTouchMove)
      canvas.removeEventListener("selectstart", this.onSelectStart)
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

  animate() {
    if (!this.earth) return

    const { earth, spikes, renderer, scene, camera } = this

    // Store the animation frame ID so we can cancel it if needed
    this.animationId = requestAnimationFrame(this.animate.bind(this))

    // Auto-rotate only when not dragging and shouldRotate is true
    if (this.shouldRotate && !this.isDragging) {
      earth.rotation.y += 0.001
      // Update our stored rotation value to match
      this.rotation.y += 0.001
    }

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

  bindToSSE() {
    const logContainer = document.getElementById("log-container")
    const urlParams = new URLSearchParams(window.location.search)
    const folderName = urlParams.get("folderName")
    const queryString = folderName ? `?folderName=${folderName}` : ""
    if (folderName) document.querySelector("#summaryLink").href = "summarizeRequests.htm?folderName=" + folderName
    else document.querySelector("#summaryLink").href = "requests.html"
    const eventSource = new EventSource(`/requests.htm${queryString}`)
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
