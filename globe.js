class Globe {
  constructor() {
    this.renderer = null
    this.scene = null
    this.camera = null
    this.earth = null
    this.spikes = []
    this.animationId = null
    this.stars = null

    // Camera control properties
    this.isDragging = false
    this.previousMousePosition = {
      x: 0,
      y: 0
    }

    // Camera orbit properties
    this.cameraDistance = 1
    this.cameraRotation = {
      x: Math.PI * 0.1, // slightly above equator
      y: Math.PI * 0.6 // west of prime meridian
    }

    // Zoom properties
    this.minZoom = 0.1
    this.maxZoom = 10
    this.currentZoom = 1
    this.zoomSpeed = 0.02
  }

  updateCameraPosition() {
    // Convert spherical coordinates to Cartesian
    const phi = this.cameraRotation.x // vertical angle
    const theta = this.cameraRotation.y // horizontal angle
    const radius = this.cameraDistance / this.currentZoom

    this.camera.position.x = radius * Math.cos(phi) * Math.cos(theta)
    this.camera.position.y = radius * Math.sin(phi)
    this.camera.position.z = radius * Math.cos(phi) * Math.sin(theta)

    // Always look at the center
    this.camera.lookAt(0, 0, 0)
    this.camera.up.set(0, 1, 0) // Keep "up" direction consistent
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

    // Set initial camera position
    this.cameraDistance = 1
    this.updateCameraPosition()

    // Set up renderer with alpha and better quality
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, height)
    this.renderer.setClearColor(0x000000) // Set background to black
    document.body.prepend(this.renderer.domElement)

    // Create starry background
    this.createStarField()

    // Create Earth with better lighting
    const geometry = new THREE.SphereGeometry(0.5, 32, 32)
    const texture = new THREE.TextureLoader().load("earth_atmos_2048.jpg")

    // Use PhongMaterial for better lighting
    const material = new THREE.MeshPhongMaterial({
      map: texture,
      specular: 0x333333,
      shininess: 5
    })

    this.earth = new THREE.Mesh(geometry, material)
    this.scene.add(this.earth)

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xfffffff)
    this.scene.add(ambientLight)

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4)
    directionalLight.position.set(5, 3, 5)
    this.scene.add(directionalLight)

    // Add mouse and zoom controls
    this.setupMouseControls()
    this.setupZoomControls()

    // Start the animation loop
    this.animate()

    return this
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

      // Adjust rotation speed based on movement
      const rotationSpeed = 0.005

      // Update camera orbit angles
      this.cameraRotation.y += deltaMove.x * rotationSpeed
      this.cameraRotation.x += deltaMove.y * rotationSpeed

      // Limit vertical rotation to prevent flipping
      this.cameraRotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraRotation.x))

      // Update camera position
      this.updateCameraPosition()

      this.previousMousePosition = {
        x: e.clientX,
        y: e.clientY
      }
    })

    window.addEventListener("mouseup", () => {
      this.isDragging = false
    })

    canvas.addEventListener("selectstart", e => {
      e.preventDefault()
    })
  }

  setupZoomControls() {
    const canvas = this.renderer.domElement

    canvas.addEventListener("wheel", e => {
      e.preventDefault()

      const zoomDelta = e.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed

      this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom + zoomDelta))

      this.updateCameraPosition()
    })

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

        this.updateCameraPosition()
        touchDistance = newDistance
      }
    })
  }

  animate() {
    if (!this.earth) return

    const { earth, spikes, renderer, scene, camera } = this

    this.animationId = requestAnimationFrame(this.animate.bind(this))

    const AUTO_ROTATE_SPEED = 0.0003

    // Auto-rotate camera when not dragging
    if (this.shouldRotate && !this.isDragging) {
      this.cameraRotation.y += AUTO_ROTATE_SPEED
      this.updateCameraPosition()
    }

    // Update spikes
    spikes.forEach((spike, index) => {
      spike.scale.y *= 0.95
      if (spike.scale.y < 0.01) {
        earth.remove(spike)
        spikes.splice(index, 1)
      }
    })

    renderer.render(scene, camera)
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
