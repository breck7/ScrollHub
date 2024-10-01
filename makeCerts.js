const acme = require("acme-client")

const challenges = {}

const addCertRoutes = app => {
  // Route to handle ACME HTTP-01 challenges
  app.get("/.well-known/acme-challenge/:token", (req, res) => {
    const token = req.params.token
    const challengeData = challenges[token]

    if (challengeData) {
      res.setHeader("Content-Type", "text/plain")
      res.send(challengeData.keyAuthorization)
      console.log(`Served key authorization for token: ${token}, domain: ${challengeData.domain}`)
    } else res.status(404).send("Not found")
  })
}

/**
 * Generates SSL certificates using ACME protocol.
 *
 * @param {string} email - The email address for registration.
 * @param {string} domain - The domain name to issue the certificate for.
 * @returns {Object} An object containing the certificate and domain key.
 */
const makeCerts = async (email, domain) => {
  try {
    // Create account key
    const accountKey = await acme.crypto.createPrivateKey()

    // Create ACME client
    const client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: accountKey,
      backoffAttempts: 5,
      backoffMin: 5000,
      debug: true // Enable debug mode
    })

    // Register account
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`]
    })

    // Create domain private key and CSR
    const domainKey = await acme.crypto.createPrivateKey()
    const [csr, csrPem] = await acme.crypto.createCsr(
      {
        commonName: domain,
        altNames: [] // Add any additional domain names here
      },
      domainKey
    )

    // Create order
    let order = await client.createOrder({
      identifiers: [{ type: "dns", value: domain }]
    })

    // Get authorizations
    const authorizations = await client.getAuthorizations(order)

    // Process each authorization
    for (const authorization of authorizations) {
      const httpChallenge = authorization.challenges.find(challenge => challenge.type === "http-01")

      const keyAuthorization = await client.getChallengeKeyAuthorization(httpChallenge)
      const token = httpChallenge.token

      // Store the token, keyAuthorization, and domain in the challenges store
      challenges[token] = {
        keyAuthorization,
        domain
      }

      try {
        // Notify ACME provider that challenge is ready
        await client.completeChallenge(httpChallenge)

        // Wait for challenge to be validated
        await client.waitForValidStatus(httpChallenge)

        console.log("Challenge validated")
      } catch (e) {
        // Fetch the updated challenge status for more details
        const updatedChallengeResponse = await acme.axios.get(httpChallenge.url)
        const updatedChallenge = updatedChallengeResponse.data
        console.error("Error during challenge validation:", updatedChallenge.error || e)
        throw e
      } finally {
        // Remove the token and keyAuthorization from the challenges store
        delete challenges[token]
      }

      // Fetch updated authorization
      let authzStatus = "pending"
      while (authzStatus !== "valid") {
        const updatedAuthorizationResponse = await acme.axios.get(authorization.url)
        const updatedAuthorization = updatedAuthorizationResponse.data
        authzStatus = updatedAuthorization.status

        console.log(`Authorization status is "${authzStatus}"`)

        if (authzStatus === "invalid") {
          throw new Error("Authorization has become invalid.")
        } else if (authzStatus === "pending") {
          // Wait a bit before checking again
          await new Promise(resolve => setTimeout(resolve, 2000))
        } else if (authzStatus !== "valid") {
          throw new Error(`Authorization status is "${authzStatus}", expected "valid".`)
        }
      }
    }

    // Wait for the order to be "ready" before finalization
    let orderStatus = order.status

    while (orderStatus !== "ready") {
      if (orderStatus === "invalid") {
        throw new Error("Order has become invalid.")
      }
      console.log(`Order status is "${orderStatus}", waiting to become "ready"...`)
      await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds
      console.log(order, JSON.stringify(order))
      const orderResponse = await acme.axios.get(order.location)
      order = orderResponse.data
      orderStatus = order.status
    }

    // Finalize order
    await client.finalizeOrder(order, csr)

    // Wait for the order to be "valid" (certificate issued)
    while (order.status !== "valid") {
      if (order.status === "invalid") {
        throw new Error("Order has become invalid after finalization.")
      }
      console.log(`Order status is "${order.status}", waiting to become "valid"...`)
      await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds
      const orderResponse = await acme.axios.get(order.location)
      order = orderResponse.data
    }

    // Get certificate
    const certificate = await client.getCertificate(order)

    console.log("Certificate and key have been obtained.")
    return {
      certificate,
      domainKey
    }
  } catch (error) {
    console.error("An error occurred during certificate generation:", error.message)
    throw error
  }
}

module.exports = { addCertRoutes, makeCerts }
