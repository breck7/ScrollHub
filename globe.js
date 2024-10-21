class Globe {
  constructor() {}
  main() {
    let scene, camera, renderer, earth
    const spikes = []

    function init() {
      scene = new THREE.Scene()

      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
      camera.position.z = 2

      renderer = new THREE.WebGLRenderer()
      renderer.setSize(window.innerWidth, window.innerHeight)
      document.body.prepend(renderer.domElement)

      const geometry = new THREE.SphereGeometry(0.5, 32, 32)
      const texture = new THREE.TextureLoader().load("earth_atmos_2048.jpg")
      const material = new THREE.MeshBasicMaterial({ map: texture })
      earth = new THREE.Mesh(geometry, material)
      scene.add(earth)

      animate()
    }

    function animate() {
      requestAnimationFrame(animate)

      earth.rotation.y += 0.001

      spikes.forEach((spike, index) => {
        spike.scale.y *= 0.95
        if (spike.scale.y < 0.01) {
          earth.remove(spike)
          spikes.splice(index, 1)
        }
      })

      renderer.render(scene, camera)
    }

    function latLongToVector3(lat, lon) {
      const phi = (90 - lat) * (Math.PI / 180)
      const theta = (lon + 180) * (Math.PI / 180)
      const x = -0.5 * Math.sin(phi) * Math.cos(theta)
      const y = 0.5 * Math.cos(phi)
      const z = 0.5 * Math.sin(phi) * Math.sin(theta)
      return new THREE.Vector3(x, y, z)
    }

    function visualizeHit(request) {
      console.log(request)
      const { lat, long, type, page } = request
      const position = latLongToVector3(lat, long)

      const spikeGeometry = new THREE.ConeGeometry(0.005, 0.2, 8)
      spikeGeometry.translate(0, 0.05, 0)
      spikeGeometry.rotateX(Math.PI / 2)

      const color = type === "read" ? 0xffffff : 0x00ff00
      const spikeMaterial = new THREE.MeshBasicMaterial({ color })

      const spike = new THREE.Mesh(spikeGeometry, spikeMaterial)
      spike.position.set(position.x, position.y, position.z)
      spike.lookAt(new THREE.Vector3(0, 0, 0))

      earth.add(spike) // Add spike to earth instead of scene
      spikes.push(spike)
    }

    init()

    const logContainer = document.getElementById("log-container")
    const eventSource = new EventSource("/requests.htm")
    eventSource.onmessage = function (event) {
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
      visualizeHit(request)
    }
    eventSource.onerror = function (error) {
      console.error("EventSource failed:", error)
      eventSource.close()
    }
    // Log when the connection is opened
    eventSource.onopen = function (event) {
      console.log(event)
      console.log("SSE connection opened")
    }
  }
}

window.globe = new Globe()
globe.main()
